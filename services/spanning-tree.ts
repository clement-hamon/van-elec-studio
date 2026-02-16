/**
 * Generic undirected-graph spanning tree built via BFS.
 * No domain knowledge — works with any string-identified nodes & edges.
 */

// ── Core types ─────────────────────────────────────────────

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface AdjacencyEntry<E extends GraphEdge = GraphEdge> {
  edge: E;
  other: string;
}

export interface SpanningTree<E extends GraphEdge = GraphEdge> {
  root: string;
  /** nodeId → parentNodeId (null for root) */
  parent: Map<string, string | null>;
  /** nodeId → edge that connects it to its parent (null for root) */
  parentEdge: Map<string, E | null>;
  /** nodeId → list of child nodeIds */
  children: Map<string, string[]>;
  /** Leaf-first traversal order */
  postorder: string[];
  /** Root-first traversal order */
  preorder: string[];
  /** Edges not included in the tree */
  nonTreeEdges: E[];
}

// ── Build helpers ──────────────────────────────────────────

/** Build an undirected adjacency list from edges. */
export function buildAdjacency<E extends GraphEdge>(edges: E[]): Map<string, AdjacencyEntry<E>[]> {
  const adjacency = new Map<string, AdjacencyEntry<E>[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push({ edge, other: edge.to });
    adjacency.get(edge.to)!.push({ edge, other: edge.from });
  }
  return adjacency;
}

/** BFS spanning tree rooted at `rootId`. */
export function buildSpanningTree<E extends GraphEdge>(
  rootId: string,
  adjacency: Map<string, AdjacencyEntry<E>[]>,
  allEdges: E[]
): SpanningTree<E> {
  const parent = new Map<string, string | null>();
  const parentEdge = new Map<string, E | null>();
  const children = new Map<string, string[]>();
  const postorder: string[] = [];
  const preorder: string[] = [];
  const treeEdgeIds = new Set<string>();

  parent.set(rootId, null);
  parentEdge.set(rootId, null);

  const queue: string[] = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const { edge, other } of adjacency.get(current) ?? []) {
      if (parent.has(other)) continue;
      parent.set(other, current);
      parentEdge.set(other, edge);
      treeEdgeIds.add(edge.id);
      queue.push(other);
    }
  }

  for (const [nodeId, parentId] of parent.entries()) {
    if (parentId === null) continue;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(nodeId);
  }

  // Build both traversal orders
  const visit = (nodeId: string) => {
    preorder.push(nodeId);
    for (const child of children.get(nodeId) ?? []) visit(child);
    postorder.push(nodeId);
  };
  visit(rootId);

  const nonTreeEdges = allEdges.filter((e) => !treeEdgeIds.has(e.id));

  return { root: rootId, parent, parentEdge, children, postorder, preorder, nonTreeEdges };
}

// ── Tree walker ────────────────────────────────────────────

/** Walk the tree, calling a visitor at each node in the given order. */
export function walkTree<E extends GraphEdge>(
  tree: SpanningTree<E>,
  order: "preorder" | "postorder",
  visit: (nodeId: string, parentId: string | null, edge: E | null, children: string[]) => void
): void {
  const sequence = order === "postorder" ? tree.postorder : tree.preorder;
  for (const nodeId of sequence) {
    visit(
      nodeId,
      tree.parent.get(nodeId) ?? null,
      tree.parentEdge.get(nodeId) ?? null,
      tree.children.get(nodeId) ?? []
    );
  }
}
