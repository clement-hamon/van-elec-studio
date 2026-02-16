import type { Diagnostic, NodeFlow, ScenarioInput, NodeType  } from "~/types/schema";
import type { GraphEdge, SpanningTree } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local helpers ──────────────────────────────────────────

export interface DomainNode {
  id: string;
  type: NodeType;
  params?: Record<string, unknown>;
}

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

const loadDemandW = (node: DomainNode, V: number) => {
  const watts = numberParam(node.params, "watts");
  const amps = numberParam(node.params, "amps");
  const duty = numberParam(node.params, "dutyCycle") ?? 1;
  const baseW = typeof watts === "number" ? watts : typeof amps === "number" ? amps * V : 0;
  return Math.max(0, baseW) * Math.max(0, duty);
};

const sourceCapW = (node: DomainNode, V: number) => {
  const availableW = numberParam(node.params, "availableW");
  const maxOutA = numberParam(node.params, "maxOutA");
  if (typeof availableW === "number") return Math.max(0, availableW);
  if (typeof maxOutA === "number") return Math.max(0, maxOutA) * V;
  return 0;
};

// ── Visitor ────────────────────────────────────────────────

/**
 * Postorder visitor: gathers per-node demand/supply data during the walk,
 * then solves the global power balance when the root is reached.
 *
 * After the walk, exposes: nodeFlows, injectionsA, totalDemandW,
 * totalSupplyW, hasUnserved.
 */
export class PowerBalanceVisitor<E extends GraphEdge> implements TreeVisitor<E> {
  readonly name = "power-balance";
  readonly order = "postorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];
  private tree!: SpanningTree<E>;

  /** Results — available after the walk */
  readonly nodeFlows: Record<string, NodeFlow> = {};
  readonly injectionsA = new Map<string, number>();
  totalDemandW = 0;
  totalSupplyW = 0;
  hasUnserved = false;

  private readonly demandByNode = new Map<string, number>();
  private readonly supplyCapByNode = new Map<string, number>();
  private connectedDemandW = 0;
  private solved = false;

  constructor(
    private readonly nodes: DomainNode[],
    private readonly battery: DomainNode,
    private readonly V: number,
    private readonly scenario: ScenarioInput
  ) {}

  prepare(tree: SpanningTree<E>) {
    this.tree = tree;
  }

  visit(nodeId: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.type === "load") {
      const demandW = loadDemandW(node, this.V);
      this.demandByNode.set(node.id, demandW);
      this.totalDemandW += demandW;
      if (this.tree.parent.has(node.id)) this.connectedDemandW += demandW;
      this.nodeFlows[node.id] = { demandW };
    }

    if (node.type === "source" && this.tree.parent.has(node.id)) {
      this.supplyCapByNode.set(node.id, sourceCapW(node, this.V));
    }

    // Solve when we reach the root (last node in postorder)
    if (nodeId === this.tree.root && !this.solved) {
      this.solve();
      this.solved = true;
    }
  }

  private solve() {
    const V = this.V;
    const battery = this.battery;

    const maxDischargeA = numberParam(battery.params, "maxDischargeA") ?? Number.POSITIVE_INFINITY;
    const maxChargeA = numberParam(battery.params, "maxChargeA") ?? maxDischargeA;
    const maxDischargeW = maxDischargeA * V;
    const maxChargeW = maxChargeA * V;

    const totalSupplyCapW =
      Array.from(this.supplyCapByNode.values()).reduce((a, b) => a + b, 0) + maxDischargeW;
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
      this.injectionsA.set(node.id, V > 0 ? servedW / V : 0);
      if (servedFactor < 1 && servedW < demandW) {
        this.nodeFlows[node.id] = { ...this.nodeFlows[node.id], clampedBy: ["supply.shortage"] };
      }
    }

    // Dispatch sources
    const supplyBudgetW = servedDemandW + (servedFactor === 1 ? maxChargeW : 0);
    const sources = Array.from(this.supplyCapByNode.entries());
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
        this.injectionsA.set(id, V > 0 ? -use / V : 0);
      }
    } else {
      let remaining = supplyBudgetW;
      for (const [id, cap] of sources) {
        if (remaining <= 1e-6) {
          this.nodeFlows[id] = { supplyW: 0 };
          this.injectionsA.set(id, 0);
          continue;
        }
        const use = Math.min(cap, remaining);
        remaining -= use;
        usedSupplyW += use;
        this.nodeFlows[id] = { supplyW: use };
        this.injectionsA.set(id, V > 0 ? -use / V : 0);
      }
    }

    // Battery balance
    const netFromSourcesW = usedSupplyW - servedDemandW;
    let batteryNetA = 0;
    const batteryFlow: NodeFlow = {};

    if (netFromSourcesW >= 0) {
      const chargeW = Math.min(netFromSourcesW, maxChargeW);
      batteryNetA = V > 0 ? chargeW / V : 0;
      if (netFromSourcesW - chargeW > 1e-6) {
        this._diagnostics.push({
          severity: "warning",
          code: "EXCESS_SUPPLY",
          message: "Supply exceeds load and battery charge limit; excess is unused."
        });
        batteryFlow.clampedBy = ["battery.maxChargeA"];
      }
    } else {
      const dischargeW = Math.min(-netFromSourcesW, maxDischargeW);
      batteryNetA = V > 0 ? -dischargeW / V : 0;
      if (servedFactor === 1 && -netFromSourcesW - dischargeW > 1e-6) {
        this._diagnostics.push({
          severity: "warning",
          code: "UNSERVED_DEMAND",
          message: "Battery discharge limit prevents serving all demand."
        });
        batteryFlow.clampedBy = ["battery.maxDischargeA"];
      }
    }

    this.nodeFlows[battery.id] = {
      netA: batteryNetA,
      state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle",
      ...batteryFlow
    };

    this.hasUnserved = servedFactor < 1;
    this.totalSupplyW = usedSupplyW + Math.max(0, -batteryNetA * V);
  }

  diagnostics() {
    return this._diagnostics;
  }
}
