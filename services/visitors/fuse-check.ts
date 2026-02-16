import type { Diagnostic } from "~/types/schema";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local helpers ──────────────────────────────────────────

export interface FuseEdge extends GraphEdge {
  fuseA?: number;
}

export interface FuseNode {
  id: string;
  type: string;
  params?: Record<string, unknown>;
}

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

// ── Visitor ────────────────────────────────────────────────

/**
 * Postorder visitor: accumulates subtree current sums and opens fuses
 * when the sum exceeds the rating.
 *
 * Must run AFTER PowerBalanceVisitor (needs injectionsA).
 *
 * After the walk, exposes: subtreeA, blockedNodes, blownEdges.
 */
export class FuseCheckVisitor<E extends FuseEdge> implements TreeVisitor<E> {
  readonly name = "fuse-check";
  readonly order = "postorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];

  /** Subtree current sum per node (mutated when fuses blow) */
  readonly subtreeA = new Map<string, number>();

  /** Nodes in each node's subtree */
  private readonly subtreeMembers = new Map<string, Set<string>>();

  /** Nodes downstream of a blown fuse */
  readonly blockedNodes = new Set<string>();

  /** Edges where the fuse blew */
  readonly blownEdges = new Set<string>();

  readonly unprotectedEdges = new Set<string>();

  constructor(
    private readonly nodes: FuseNode[],
    private readonly injectionsA: Map<string, number>
  ) {}

  prepare() {
    // Seed each node with its own injection
    for (const node of this.nodes) {
      this.subtreeA.set(node.id, this.injectionsA.get(node.id) ?? 0);
      this.subtreeMembers.set(node.id, new Set([node.id]));
    }
  }

  visit(nodeId: string, _parentId: string | null, edge: E | null, children: string[]): void {
    let sum = this.subtreeA.get(nodeId) ?? 0;
    const members = this.subtreeMembers.get(nodeId) ?? new Set([nodeId]);

    // Accumulate children
    for (const child of children) {
      sum += this.subtreeA.get(child) ?? 0;
      const childMembers = this.subtreeMembers.get(child);
      if (childMembers) childMembers.forEach((id) => members.add(id));
    }

    // Check fuse
    const node = this.nodes.find((n) => n.id === nodeId);
    const nodeFuseA = numberParam(node?.params, "ratingA");
    const edgeFuseA = edge?.fuseA;
    const fuseA = edgeFuseA ?? nodeFuseA;

    if (edge && fuseA && Math.abs(sum) > fuseA + 1e-6) {
      this.blownEdges.add(edge.id);
      members.forEach((id) => this.blockedNodes.add(id));
      this._diagnostics.push({
        severity: "warning",
        code: "FUSE_OPEN",
        message: "Fuse opened due to overcurrent; downstream loads are unserved.",
        refs: [{ edgeId: edge.id }]
      });
      sum = 0;
    }

    // Warn about unprotected wires: if the edge is connected to a battery or source and doesn't have a fuse on it or connected node, flag it as unprotected
    if (edge && !fuseA) {
      const fromNode = this.nodes.find((n) => n.id === edge.from);
      const toNode = this.nodes.find((n) => n.id === edge.to);
      const fromType = fromNode?.type;

      const isFromSource = fromType === "source" || fromType === "battery";
      const isToFuse = toNode?.params?.ratingA !== undefined;
      
      if (isFromSource || isToFuse) {
        this.unprotectedEdges.add(edge.id);
        this._diagnostics.push({
          severity: "warning",
          code: "UNPROTECTED_WIRE",
          message: "Unprotected wire detected; consider adding a fuse.",
          refs: [{ edgeId: edge.id }]
        });
      }
    }

    this.subtreeA.set(nodeId, sum);
    this.subtreeMembers.set(nodeId, members);
  }

  diagnostics() {
    return this._diagnostics;
  }
}
