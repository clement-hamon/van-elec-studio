import type { Diagnostic, EdgeFlow } from "../../types/schema";
import { DEFAULT_DOMAIN_VOLTAGE } from "../flow/voltage-domain";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local types ────────────────────────────────────────────

export interface WiredEdge extends GraphEdge {
  voltageV?: number;
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
    private readonly blockedNodes: Set<string>,
    private readonly blownEdges: Set<string>
  ) {}

  prepare() {}

  visit(nodeId: string, parentId: string | null, parentEdge: E | null): void {
    if (!parentEdge || !parentId) return; // root has no parent edge

    if (this.blownEdges.has(parentEdge.id)) {
      this.edgeFlows[parentEdge.id] = { currentA: 0, limitedBy: ["fuseA"] };
      return;
    }

    if (this.blockedNodes.has(nodeId) || this.blockedNodes.has(parentId)) {
      this.edgeFlows[parentEdge.id] = { currentA: 0 };
      return;
    }

    const flowW = this.subtreeW.get(nodeId) ?? 0;
    const edgeVoltageV =
      parentEdge.voltageV && parentEdge.voltageV > 0 ? parentEdge.voltageV : DEFAULT_DOMAIN_VOLTAGE;
    // Current is derived per edge from power and local voltage.
    // This is what makes one converter path yield different currents
    // on low-voltage and high-voltage sides while preserving power flow.
    const flowA = flowW / edgeVoltageV;
    let signedA: number;

    if (parentEdge.from === parentId && parentEdge.to === nodeId) {
      signedA = flowA;
    } else if (parentEdge.from === nodeId && parentEdge.to === parentId) {
      signedA = -flowA;
    } else {
      this._diagnostics.push({
        severity: "warning",
        code: "EDGE_DIRECTION_MISMATCH",
        message: "Edge direction does not match tree connection; current sign may be wrong.",
        refs: [{ edgeId: parentEdge.id }]
      });
      signedA = flowA;
    }

    const maxA = parentEdge.wire?.maxA;
    const utilization = maxA ? Math.abs(signedA) / maxA : undefined;
    const limitedBy: string[] = [];
    if (maxA && Math.abs(signedA) > maxA + 1e-6) limitedBy.push("wire.maxA");

    this.edgeFlows[parentEdge.id] = {
      currentA: signedA,
      utilization,
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
  }

  diagnostics() {
    return this._diagnostics;
  }
}
