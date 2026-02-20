import type { Diagnostic, NodeFlow, ScenarioInput, NodeType } from "../../types/schema";
import {
  transformSubtreeW,
} from "../flow/current-calculation";
import { solveDemand } from "../flow/demand-solver";
import { reconcilePowerBalance } from "../flow/power-balance-reconciler";
import { solveSupply } from "../flow/supply-solver";
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
 * Postorder visitor that orchestrates demand solving, supply solving, and
 * battery reconciliation.
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

  private readonly demandByNode = new Map<string, number>();
  private readonly supplyCapByNode = new Map<string, number>();
  private solved = false;

  constructor(
    private readonly nodes: DomainNode[],
    private readonly battery: DomainNode,
    private readonly batteryVoltageV: number,
    private readonly scenario: ScenarioInput
  ) {}

  prepare(tree: SpanningTree<E>) {
    this.tree = tree;
  }

  visit(nodeId: string, _parentId: string | null, _parentEdge: E | null, _children: string[]): void {
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
    const demand = solveDemand(this.nodes, this.tree, this.batteryVoltageV);
    const supply = solveSupply(this.nodes, this.tree, this.batteryVoltageV);
    const balanced = reconcilePowerBalance({
      nodes: this.nodes,
      battery: this.battery,
      batteryVoltageV: this.batteryVoltageV,
      scenario: this.scenario,
      demandByNode: demand.demandByNode,
      connectedDemandW: demand.connectedDemandW,
      dispatchableSources: supply.dispatchableSources,
      isNodeConnected: (nodeId) => this.tree.parent.has(nodeId),
    });

    this.totalDemandW = demand.totalDemandW;
    this.totalSupplyW = balanced.totalSupplyW;
    this.hasUnserved = balanced.hasUnserved;

    this.demandByNode.clear();
    demand.demandByNode.forEach((value, key) => this.demandByNode.set(key, value));
    this.supplyCapByNode.clear();
    supply.supplyCapByNode.forEach((value, key) => this.supplyCapByNode.set(key, value));

    this.injectionsW.clear();
    Object.assign(this.nodeFlows, demand.nodeFlows, balanced.nodeFlows);
    balanced.injectionsW.forEach((value, key) => this.injectionsW.set(key, value));
    this._diagnostics.push(...balanced.diagnostics);

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

  diagnostics() {
    return this._diagnostics;
  }
}
