import type { Diagnostic, EdgeFlow } from "~/types/schema";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local types ────────────────────────────────────────────

export interface WiredEdge extends GraphEdge {
  wire?: { maxA?: number };
}

// ── Visitor ────────────────────────────────────────────────

/**
 * Preorder visitor: assigns signed current to each tree edge
 * based on the subtree sums computed by FuseCheckVisitor.
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
    private readonly subtreeA: Map<string, number>,
    private readonly blockedNodes: Set<string>,
    private readonly blownEdges: Set<string>
  ) {}

  prepare() {}

  visit(nodeId: string, parentId: string | null, edge: E | null): void {
    if (!edge || !parentId) return; // root has no parent edge

    if (this.blownEdges.has(edge.id)) {
      this.edgeFlows[edge.id] = { currentA: 0, limitedBy: ["fuseA"] };
      return;
    }

    if (this.blockedNodes.has(nodeId) || this.blockedNodes.has(parentId)) {
      this.edgeFlows[edge.id] = { currentA: 0 };
      return;
    }

    const flowA = this.subtreeA.get(nodeId) ?? 0;
    let signedA: number;

    if (edge.from === parentId && edge.to === nodeId) {
      signedA = flowA;
    } else if (edge.from === nodeId && edge.to === parentId) {
      signedA = -flowA;
    } else {
      this._diagnostics.push({
        severity: "warning",
        code: "EDGE_DIRECTION_MISMATCH",
        message: "Edge direction does not match tree connection; current sign may be wrong.",
        refs: [{ edgeId: edge.id }]
      });
      signedA = flowA;
    }

    const maxA = edge.wire?.maxA;
    const utilization = maxA ? Math.abs(signedA) / maxA : undefined;
    const limitedBy: string[] = [];
    if (maxA && Math.abs(signedA) > maxA + 1e-6) limitedBy.push("wire.maxA");

    this.edgeFlows[edge.id] = {
      currentA: signedA,
      utilization,
      limitedBy: limitedBy.length ? limitedBy : undefined
    };
  }

  diagnostics() {
    return this._diagnostics;
  }
}
