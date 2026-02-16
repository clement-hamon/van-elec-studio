import type { Diagnostic } from "~/types/schema";
import { walkTree, type GraphEdge, type SpanningTree } from "../spanning-tree";

/**
 * A visitor that performs one analysis pass over the spanning tree.
 *
 * Lifecycle:
 *   1. prepare()        — called once before the walk
 *   2. visit()          — called for each node (in the order the visitor declares)
 *   3. diagnostics()    — collected after the walk
 */
export interface TreeVisitor<E extends GraphEdge = GraphEdge> {
  /** Name for debugging / logging */
  readonly name: string;

  /** Which traversal order this visitor needs */
  readonly order: "preorder" | "postorder";

  /** One-time setup before the walk begins */
  prepare?(tree: SpanningTree<E>): void;

  /** Called for each node in the tree */
  visit(
    nodeId: string,
    parentId: string | null,
    edge: E | null,
    children: string[]
  ): void;

  /** Return any diagnostics produced during the walk */
  diagnostics(): Diagnostic[];
}

/** Run a pipeline of visitors in sequence on the tree. */
export function runVisitors<E extends GraphEdge>(
  tree: SpanningTree<E>,
  visitors: TreeVisitor<E>[]
): Diagnostic[] {
  const allDiagnostics: Diagnostic[] = [];

  for (const visitor of visitors) {
    visitor.prepare?.(tree);
    walkTree(tree, visitor.order, (nodeId: string, parentId: string | null, edge: E | null, children: string[]) =>
      visitor.visit(nodeId, parentId, edge, children)
    );
    allDiagnostics.push(...visitor.diagnostics());
  }

  return allDiagnostics;
}
