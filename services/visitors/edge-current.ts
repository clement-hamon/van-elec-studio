import type { CurrentComputationMode, Diagnostic, EdgeFlow } from "../../types/schema";
import { DEFAULT_DOMAIN_VOLTAGE } from "../flow/voltage-domain";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local types ────────────────────────────────────────────

export interface WiredEdge extends GraphEdge {
  voltageV?: number;
  fuseA?: number;
  wire?: { maxA?: number };
}

// ── Visitor ────────────────────────────────────────────────

/**
 * Preorder visitor: assigns signed current to each tree edge
 * based on the subtree power sums computed by FuseCheckVisitor.
 *
 * Must run AFTER FuseCheckVisitor.
 *
 * After the walk, exposes: edgeFlows.
 */
export class EdgeCurrentVisitor<E extends WiredEdge> implements TreeVisitor<E> {
  readonly name = "edge-current";
  readonly order = "preorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];

  /** Result: edge id → flow */
  readonly edgeFlows: Record<string, EdgeFlow> = {};

  constructor(
    private readonly subtreeW: Map<string, number>,
    private readonly preProtectionSubtreeW: Map<string, number>,
    private readonly sizingDemandSubtreeW: Map<string, number>,
    private readonly sizingSupplySubtreeW: Map<string, number>,
    private readonly blockedNodes: Set<string>,
    private readonly blownEdges: Set<string>,
    private readonly currentComputationMode: CurrentComputationMode = "load_simulation"
  ) {}

  prepare() {}

  visit(nodeId: string, parentId: string | null, parentEdge: E | null): void {
    if (!parentEdge || !parentId) return; // root has no parent edge
    const edgeFlow = this.currentComputationMode === "cable_sizing"
      ? this.computeCableSizingFlow(nodeId, parentId, parentEdge)
      : this.computeSimulationFlow(nodeId, parentId, parentEdge);
    if (edgeFlow) this.edgeFlows[parentEdge.id] = edgeFlow;
  }

  diagnostics() {
    return this._diagnostics;
  }

  private computeSimulationFlow(nodeId: string, parentId: string, parentEdge: E): EdgeFlow | null {
    if (this.blownEdges.has(parentEdge.id)) return { currentA: 0, limitedBy: ["fuseA"] };
    if (this.blockedNodes.has(nodeId) || this.blockedNodes.has(parentId)) return { currentA: 0 };

    const edgeVoltageV = this.resolveEdgeVoltage(parentEdge);
    const flowW = this.subtreeW.get(nodeId) ?? 0;
    const demandA = Math.abs(flowW) / edgeVoltageV;
    const signedA = this.resolveSignedCurrent(parentEdge, parentId, nodeId, demandA);
    const maxA = parentEdge.wire?.maxA;

    const limitedBy: string[] = [];
    if (maxA && Math.abs(signedA) > maxA + 1e-6) limitedBy.push("wire.maxA");

    return {
      currentA: signedA,
      utilization: maxA ? Math.abs(signedA) / maxA : undefined,
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
  }

  private computeCableSizingFlow(nodeId: string, parentId: string, parentEdge: E): EdgeFlow {
    const edgeVoltageV = this.resolveEdgeVoltage(parentEdge);
    const demandW = this.sizingDemandSubtreeW.get(nodeId) ?? Math.max(0, this.preProtectionSubtreeW.get(nodeId) ?? 0);
    const supplyW = this.sizingSupplySubtreeW.get(nodeId) ?? 0;
    const demandA = demandW / edgeVoltageV;
    const supplyA = supplyW / edgeVoltageV;
    const sizedA = Math.max(demandA, supplyA);
    const flowParentToChildA = demandA >= supplyA ? sizedA : -sizedA;
    const signedA = this.resolveSignedCurrent(parentEdge, parentId, nodeId, flowParentToChildA);
    const maxA = parentEdge.wire?.maxA;
    const limitedBy = this.sizingLimitedBy(demandA, supplyA);
    return {
      currentA: signedA,
      utilization: maxA ? Math.abs(signedA) / maxA : undefined,
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
  }

  private resolveEdgeVoltage(parentEdge: E) {
    return parentEdge.voltageV && parentEdge.voltageV > 0 ? parentEdge.voltageV : DEFAULT_DOMAIN_VOLTAGE;
  }

  private resolveSignedCurrent(parentEdge: E, parentId: string, nodeId: string, flowParentToChildA: number) {
    if (parentEdge.from === parentId && parentEdge.to === nodeId) return flowParentToChildA;
    if (parentEdge.from === nodeId && parentEdge.to === parentId) return -flowParentToChildA;

    this._diagnostics.push({
      severity: "warning",
      code: "EDGE_DIRECTION_MISMATCH",
      message: "Edge direction does not match tree connection; current sign may be wrong.",
      refs: [{ edgeId: parentEdge.id }]
    });
    return flowParentToChildA;
  }

  private sizingLimitedBy(demandA: number, supplyA: number) {
    const limitedBy: string[] = [];
    const epsilon = 1e-6;
    if (Math.abs(demandA - supplyA) <= epsilon && Math.max(demandA, supplyA) > epsilon) {
      limitedBy.push("load.maxDemandA", "source.maxSupplyA");
      return limitedBy;
    }
    if (demandA > supplyA + epsilon) limitedBy.push("load.maxDemandA");
    if (supplyA > demandA + epsilon) limitedBy.push("source.maxSupplyA");
    return limitedBy;
  }
}
