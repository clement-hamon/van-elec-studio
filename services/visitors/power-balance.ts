import type { Diagnostic, NodeFlow, ScenarioInput, NodeType } from "../../types/schema";
import {
  CURRENT_LIMIT_REASONS,
  resolveBatteryPowerCapsW,
  resolveNodeDemandW,
  resolveNodeSupplyCapW,
  transformSubtreeW,
} from "../flow/current-calculation";
import type { GraphEdge, SpanningTree } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local helpers ──────────────────────────────────────────

export interface DomainNode {
  id: string;
  type: NodeType;
  typeId?: string;
  primaryDomain?: string;
  params?: Record<string, unknown>;
}

export interface PowerEdge extends GraphEdge {
  voltageV?: number;
}

// ── Visitor ────────────────────────────────────────────────

/**
 * Role:
 * Postorder visitor that orchestrates power-balance solving using centralized
 * formulas from flow/current-calculation.
 *
 * Input:
 * Graph nodes, tree topology, battery reference, scenario settings.
 *
 * Output:
 * nodeFlows, signed node injections (W), sizing envelopes, total demand/supply,
 * and diagnostics about shortages/limits.
 */
export class PowerBalanceVisitor<E extends PowerEdge> implements TreeVisitor<E> {
  readonly name = "power-balance";
  readonly order = "postorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];
  private tree!: SpanningTree<E>;

  /** Results — available after the walk */
  readonly nodeFlows: Record<string, NodeFlow> = {};
  /**
   * Node injection in watts (+ consumes, - supplies).
   *
   * We intentionally propagate power instead of current because converters
   * change current when voltage changes (I = P / V), while power remains
   * comparable across voltage domains after efficiency is applied.
   */
  readonly injectionsW = new Map<string, number>();
  // Sizing envelopes: max possible demand/supply power crossing the parent edge.
  readonly sizingDemandSubtreeW = new Map<string, number>();
  readonly sizingSupplySubtreeW = new Map<string, number>();
  totalDemandW = 0;
  totalSupplyW = 0;
  hasUnserved = false;

  private readonly nodeById = new Map<string, DomainNode>();
  private readonly demandByNode = new Map<string, number>();
  private readonly supplyCapByNode = new Map<string, number>();
  private connectedDemandW = 0;
  private solved = false;

  constructor(
    private readonly nodes: DomainNode[],
    private readonly battery: DomainNode,
    private readonly batteryVoltageV: number,
    private readonly scenario: ScenarioInput
  ) {
    for (const node of nodes) this.nodeById.set(node.id, node);
  }

  prepare(tree: SpanningTree<E>) {
    this.tree = tree;
  }

  visit(nodeId: string, _parentId: string | null, parentEdge: E | null): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const nodeVoltage = parentEdge?.voltageV && parentEdge.voltageV > 0
      ? parentEdge.voltageV
      : this.batteryVoltageV;

    if (node.type === "load") {
      const demandW = resolveNodeDemandW(node, nodeVoltage);
      this.demandByNode.set(node.id, demandW);
      this.totalDemandW += demandW;
      if (this.tree.parent.has(node.id)) this.connectedDemandW += demandW;
      this.nodeFlows[node.id] = { demandW };
    }

    if (node.type === "source" && this.tree.parent.has(node.id)) {
      this.supplyCapByNode.set(node.id, resolveNodeSupplyCapW(node, nodeVoltage));
    }

    // Solve when we reach the root (last node in postorder)
    if (nodeId === this.tree.root && !this.solved) {
      this.solve();
      this.solved = true;
    }
  }

  /**
   * Role:
   * Solve served demand, source dispatch, and battery charge/discharge state.
   *
   * Input:
   * Connected demand, source capacities, battery caps and scenario dispatch policy.
   *
   * Output:
   * Filled injectionsW/nodeFlows plus shortage/limit diagnostics.
   */
  private solve() {
    const batteryVoltageV = this.batteryVoltageV;
    const battery = this.battery;

    const { maxChargeW, maxDischargeW } = resolveBatteryPowerCapsW(battery, batteryVoltageV);

    const dispatchableSources = Array.from(this.supplyCapByNode.entries()).map(([sourceId, sourceCapW]) => {
      return [sourceId, this.resolveSourceDeliverableToRootW(sourceId, sourceCapW)] as const;
    });

    const totalSupplyCapW =
      dispatchableSources.reduce((sum, [, capW]) => sum + capW, 0) + maxDischargeW;
    const servedFactor =
      this.connectedDemandW > 0 ? Math.min(1, totalSupplyCapW / this.connectedDemandW) : 1;
    const servedDemandW = this.connectedDemandW * servedFactor;

    if (servedFactor < 1) {
      this._diagnostics.push({
        severity: "warning",
        code: "UNSERVED_DEMAND",
        message: "Demand exceeds available supply; loads scaled proportionally."
      });
    }

    // Set load injections
    for (const node of this.nodes) {
      if (node.type !== "load") continue;
      const demandW = this.demandByNode.get(node.id) ?? 0;
      const servedW = this.tree.parent.has(node.id) ? demandW * servedFactor : 0;
      // Positive injection means "this node consumes this many watts".
      this.injectionsW.set(node.id, servedW);
      if (servedFactor < 1 && servedW < demandW) {
        this.nodeFlows[node.id] = {
          ...this.nodeFlows[node.id],
          clampedBy: [CURRENT_LIMIT_REASONS.supplyShortage],
        };
      }
    }

    // Dispatch sources
    const supplyBudgetW = servedDemandW + (servedFactor === 1 ? maxChargeW : 0);
    const sources = [...dispatchableSources];
    const dispatchPolicy = this.scenario.dispatchPolicy ?? "priority_order";
    const priority = this.scenario.sourcePriority ?? [];

    if (dispatchPolicy === "priority_order" && priority.length > 0) {
      const rank = new Map<string, number>(priority.map((id: string, idx: number) => [id, idx] as [string, number]));
      sources.sort((a, b) => (rank.get(a[0]) ?? 999999) - (rank.get(b[0]) ?? 999999));
    }

    let usedSupplyW = 0;
    if (dispatchPolicy === "share_proportionally") {
      const totalCap = sources.reduce((a, [, cap]) => a + cap, 0);
      for (const [id, cap] of sources) {
        const use = totalCap > 0 ? Math.min(cap, (cap / totalCap) * supplyBudgetW) : 0;
        usedSupplyW += use;
        this.nodeFlows[id] = { supplyW: use };
        // Negative injection means "this node provides this many watts".
        this.injectionsW.set(id, -use);
      }
    } else {
      let remaining = supplyBudgetW;
      for (const [id, cap] of sources) {
        if (remaining <= 1e-6) {
          this.nodeFlows[id] = { supplyW: 0 };
          this.injectionsW.set(id, 0);
          continue;
        }
        const use = Math.min(cap, remaining);
        remaining -= use;
        usedSupplyW += use;
        this.nodeFlows[id] = { supplyW: use };
        this.injectionsW.set(id, -use);
      }
    }

    // Battery balance
    const netFromSourcesW = usedSupplyW - servedDemandW;
    let batteryNetA = 0;
    const batteryFlow: NodeFlow = {};

    if (netFromSourcesW >= 0) {
      const chargeW = Math.min(netFromSourcesW, maxChargeW);
      batteryNetA = batteryVoltageV > 0 ? chargeW / batteryVoltageV : 0;
      if (netFromSourcesW - chargeW > 1e-6) {
        this._diagnostics.push({
          severity: "warning",
          code: "EXCESS_SUPPLY",
          message: "Supply exceeds load and battery charge limit; excess is unused."
        });
        batteryFlow.clampedBy = [CURRENT_LIMIT_REASONS.batteryMaxChargeA];
      }
    } else {
      const dischargeW = Math.min(-netFromSourcesW, maxDischargeW);
      batteryNetA = batteryVoltageV > 0 ? -dischargeW / batteryVoltageV : 0;
      if (servedFactor === 1 && -netFromSourcesW - dischargeW > 1e-6) {
        this._diagnostics.push({
          severity: "warning",
          code: "UNSERVED_DEMAND",
          message: "Battery discharge limit prevents serving all demand."
        });
        batteryFlow.clampedBy = [CURRENT_LIMIT_REASONS.batteryMaxDischargeA];
      }
    }

    this.nodeFlows[battery.id] = {
      netA: batteryNetA,
      state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle",
      ...batteryFlow
    };
    // Keep battery represented in the same power-sign convention.
    this.injectionsW.set(battery.id, -batteryNetA * batteryVoltageV);

    this.hasUnserved = servedFactor < 1;
    this.totalSupplyW = usedSupplyW + Math.max(0, -batteryNetA * batteryVoltageV);
    this.computeSizingEnvelopes();
  }

  private computeSizingEnvelopes() {
    for (const nodeId of this.tree.postorder) {
      const node = this.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      let demandW = this.demandByNode.get(nodeId) ?? 0;
      let supplyW = this.supplyCapByNode.get(nodeId) ?? 0;

      for (const childId of this.tree.children.get(nodeId) ?? []) {
        demandW += this.sizingDemandSubtreeW.get(childId) ?? 0;
        supplyW += this.sizingSupplySubtreeW.get(childId) ?? 0;
      }

      const upstreamDemandW = transformSubtreeW(node, demandW);
      const upstreamSupplyW = Math.abs(transformSubtreeW(node, -supplyW));

      this.sizingDemandSubtreeW.set(nodeId, Math.max(0, upstreamDemandW));
      this.sizingSupplySubtreeW.set(nodeId, Math.max(0, upstreamSupplyW));
    }
  }

  private resolveSourceDeliverableToRootW(sourceId: string, sourceCapW: number) {
    let deliverableW = sourceCapW;
    let cursor = sourceId;

    while (true) {
      const parentId = this.tree.parent.get(cursor);
      if (parentId === undefined || parentId === null) return deliverableW;
      const parentNode = this.nodeById.get(parentId);
      if (!parentNode) return deliverableW;

      // Propagate supply through each ancestor so converter output caps are enforced.
      deliverableW = Math.abs(transformSubtreeW(parentNode, -deliverableW));
      cursor = parentId;
    }
  }

  diagnostics() {
    return this._diagnostics;
  }
}
