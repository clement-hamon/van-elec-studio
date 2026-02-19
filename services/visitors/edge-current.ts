import type { CurrentComputationMode, Diagnostic, EdgeFlow } from "../../types/schema";
import {
  CURRENT_LIMIT_REASONS,
  resolveCurrentUtilization,
  resolveEdgeVoltageV,
  resolveSimulationLimitReasons,
  resolveSizingFlow,
  powerToCurrentMagnitudeA,
} from "../flow/current-calculation";
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
 * Role:
 * Preorder visitor that converts solved subtree powers into edge currents.
 *
 * Input:
 * Subtree power maps from upstream visitors, edge voltage metadata and
 * current-computation mode.
 *
 * Output:
 * edgeFlows with signed current, utilization and standardized limit reasons.
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

  /**
   * Role:
   * Compute runtime current from solved subtree power.
   *
   * Input:
   * nodeId/parentId relation and parent edge metadata.
   *
   * Output:
   * Signed edge current for simulation mode + wire-limit reason when applicable.
   */
  private computeSimulationFlow(nodeId: string, parentId: string, parentEdge: E): EdgeFlow | null {
    if (this.blownEdges.has(parentEdge.id)) {
      return { currentA: 0, limitedBy: [CURRENT_LIMIT_REASONS.fuseA] };
    }
    if (this.blockedNodes.has(nodeId) || this.blockedNodes.has(parentId)) return { currentA: 0 };

    const edgeVoltageV = resolveEdgeVoltageV(parentEdge.voltageV);
    const flowW = this.subtreeW.get(nodeId) ?? 0;
    const demandA = powerToCurrentMagnitudeA(flowW, edgeVoltageV);
    const signedA = this.resolveSignedCurrent(parentEdge, parentId, nodeId, demandA);
    const maxA = parentEdge.wire?.maxA;
    const limitedBy = resolveSimulationLimitReasons(signedA, maxA);

    return {
      currentA: signedA,
      utilization: resolveCurrentUtilization(signedA, maxA),
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
  }

  /**
   * Role:
   * Compute branch sizing current envelope for cable-sizing mode.
   *
   * Input:
   * Demand/supply subtree power envelopes for the child subtree.
   *
   * Output:
   * Signed design-basis edge current + envelope limiting reason(s).
   */
  private computeCableSizingFlow(nodeId: string, parentId: string, parentEdge: E): EdgeFlow {
    const edgeVoltageV = resolveEdgeVoltageV(parentEdge.voltageV);
    const demandW = this.sizingDemandSubtreeW.get(nodeId) ?? Math.max(0, this.preProtectionSubtreeW.get(nodeId) ?? 0);
    const supplyW = this.sizingSupplySubtreeW.get(nodeId) ?? 0;
    const { flowParentToChildA, limitedBy } = resolveSizingFlow(demandW, supplyW, edgeVoltageV);
    const signedA = this.resolveSignedCurrent(parentEdge, parentId, nodeId, flowParentToChildA);
    const maxA = parentEdge.wire?.maxA;
    return {
      currentA: signedA,
      utilization: resolveCurrentUtilization(signedA, maxA),
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
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
}
