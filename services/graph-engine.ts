/* =========================================================
 * Graph Engine (canonical state + indexes + mutation API)
 * Compatible with computeFlow() GraphInput
 * ========================================================= */

import type { GraphInput, BaseNode, Edge, Port, Wire, Protection } from '~/types/schema'

type Id = string;
type PortRef = { nodeId: Id; portId: Id };

export type GraphChange =
  | { kind: "node.add"; node: BaseNode }
  | { kind: "node.remove"; nodeId: Id }
  | { kind: "node.update"; nodeId: Id; patch: Partial<BaseNode> } // shallow patch
  | { kind: "port.update"; nodeId: Id; portId: Id; patch: Partial<Port> }
  | { kind: "edge.add"; edge: Edge }
  | { kind: "edge.remove"; edgeId: Id }
  | { kind: "edge.update"; edgeId: Id; patch: Partial<Edge> }
  | { kind: "edge.reconnect"; edgeId: Id; from?: PortRef; to?: PortRef };

export type GraphListener = (evt: {
  revision: number;
  changes: GraphChange[];
  snapshot: GraphInput; // canonical snapshot (nodes+edges)
}) => void;

export interface GraphEngineOptions {
  /** If true, refuse edges that connect missing endpoints. Recommended: true. */
  strictEndpoints?: boolean;

  /** If true, auto-generate ids when missing on add ops. */
  autoIds?: boolean;

  /** Optional ID generator */
  idGen?: () => string;
}

/** Useful errors for UI */
export class GraphError extends Error {
  constructor(
    message: string,
    public code:
      | "DUPLICATE_ID"
      | "MISSING_NODE"
      | "MISSING_PORT"
      | "MISSING_EDGE"
      | "INVALID_EDGE_ENDPOINT"
      | "INVALID_PATCH"
      | "PORT_ID_DUPLICATE"
  ) {
    super(message);
  }
}

/** Indexes so Flow/Rules can run fast without re-scanning all the time */
export interface GraphIndex {
  nodeById: Map<Id, BaseNode>;
  edgeById: Map<Id, Edge>;
  portByKey: Map<string, Port>; // key = `${nodeId}:${portId}`
  edgesByNode: Map<Id, Set<Id>>; // nodeId -> edgeIds
  edgesByPort: Map<string, Set<Id>>; // portKey -> edgeIds
}

function portKey(nodeId: Id, portId: Id) {
  return `${nodeId}:${portId}`;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function defaultIdGen() {
  // good enough for MVP; replace with nanoid/uuid in prod
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/* =========================================================
 * GraphEngine
 * ========================================================= */

export class GraphEngine {
  private nodes: BaseNode[] = [];
  private edges: Edge[] = [];

  private index: GraphIndex = {
    nodeById: new Map(),
    edgeById: new Map(),
    portByKey: new Map(),
    edgesByNode: new Map(),
    edgesByPort: new Map()
  };

  private listeners: Set<GraphListener> = new Set();
  private revision = 0;

  private options: Required<GraphEngineOptions>;

  constructor(initial?: GraphInput, opts?: GraphEngineOptions) {
    this.options = {
      strictEndpoints: opts?.strictEndpoints ?? true,
      autoIds: opts?.autoIds ?? true,
      idGen: opts?.idGen ?? defaultIdGen
    };

    if (initial) {
      this.nodes = deepClone(initial.nodes);
      this.edges = deepClone(initial.edges);
      this.rebuildIndexOrThrow();
    }
  }

  /* ---------- Public read API ---------- */

  getRevision() {
    return this.revision;
  }

  /** Canonical snapshot matching Flow engine input */
  getSnapshot(): GraphInput {
    return { nodes: deepClone(this.nodes), edges: deepClone(this.edges) };
  }

  /** Zero-copy internal snapshot (only use internally; don’t expose to UI) */
  getSnapshotUnsafe(): GraphInput {
    return { nodes: this.nodes, edges: this.edges };
  }

  getIndex(): GraphIndex {
    return this.index;
  }

  onChange(fn: GraphListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /* ---------- Transaction & patch API ---------- */

  transaction(mutator: (tx: GraphTx) => void): void {
    const tx = new GraphTx(this);
    mutator(tx);
    const changes = tx.flush();
    if (changes.length) this.emit(changes);
  }

  patch(changes: GraphChange[]): void {
    this.transaction((tx) => {
      for (const c of changes) tx.apply(c);
    });
  }

  /* ---------- Convenience operations for UI ---------- */

  addNode(node: BaseNode) {
    this.patch([{ kind: "node.add", node }]);
  }

  removeNode(nodeId: Id) {
    this.patch([{ kind: "node.remove", nodeId }]);
  }

  addEdge(edge: Edge) {
    this.patch([{ kind: "edge.add", edge }]);
  }

  removeEdge(edgeId: Id) {
    this.patch([{ kind: "edge.remove", edgeId }]);
  }

  /** Connect two ports with a new edge */
  connectPorts(params: {
    from: PortRef;
    to: PortRef;
    wire?: Wire;
    protection?: Protection;
    edgeId?: Id;
  }): Id {
    const id = params.edgeId ?? (this.options.autoIds ? this.options.idGen() : undefined);
    if (!id) throw new GraphError("Missing edge id", "INVALID_PATCH");

    const edge: Edge = {
      id,
      from: params.from,
      to: params.to,
      wire: params.wire,
      protection: params.protection
    };
    this.addEdge(edge);
    return id;
  }

  /** Disconnect all edges attached to a port */
  disconnectPort(ref: PortRef) {
    const k = portKey(ref.nodeId, ref.portId);
    const edgeIds = this.index.edgesByPort.get(k);
    if (!edgeIds || !edgeIds.size) return;
    this.patch(Array.from(edgeIds).map((edgeId) => ({ kind: "edge.remove", edgeId })));
  }

  /* =========================================================
   * Internal mutation primitives (called by GraphTx)
   * ========================================================= */

  _apply(change: GraphChange): void {
    switch (change.kind) {
      case "node.add": {
        const node = deepClone(change.node);
        if (!node.id && this.options.autoIds) node.id = this.options.idGen();
        if (!node.id) throw new GraphError("Node id is required", "INVALID_PATCH");
        if (this.index.nodeById.has(node.id)) throw new GraphError(`Duplicate node id ${node.id}`, "DUPLICATE_ID");

        // Validate port ids unique within node
        const seen = new Set<string>();
        for (const p of node.ports) {
          if (!p.id) throw new GraphError(`Port id is required in node ${node.id}`, "INVALID_PATCH");
          if (seen.has(p.id)) throw new GraphError(`Duplicate port id ${p.id} in node ${node.id}`, "PORT_ID_DUPLICATE");
          seen.add(p.id);
        }

        this.nodes.push(node);
        this.indexNode(node);
        break;
      }

      case "node.remove": {
        const { nodeId } = change;
        if (!this.index.nodeById.has(nodeId)) throw new GraphError(`Missing node ${nodeId}`, "MISSING_NODE");

        // Remove all edges connected to node
        const edgeIds = this.index.edgesByNode.get(nodeId);
        if (edgeIds) {
          for (const eid of Array.from(edgeIds)) this._apply({ kind: "edge.remove", edgeId: eid });
        }

        // Remove node
        this.nodes = this.nodes.filter((n) => n.id !== nodeId);
        this.deindexNode(nodeId);
        break;
      }

      case "node.update": {
        const n = this.index.nodeById.get(change.nodeId);
        if (!n) throw new GraphError(`Missing node ${change.nodeId}`, "MISSING_NODE");

        // Shallow patch allowed: type/params/ports etc.
        // If ports are replaced, ensure uniqueness and reindex ports.
        const patched = { ...n, ...deepClone(change.patch) } as BaseNode;

        if (patched.id !== n.id) throw new GraphError("Node id is immutable", "INVALID_PATCH");
        if (!patched.ports || !Array.isArray(patched.ports)) throw new GraphError("Node ports must be an array", "INVALID_PATCH");

        // Validate port ids unique
        const seen = new Set<string>();
        for (const p of patched.ports) {
          if (!p.id) throw new GraphError(`Port id is required in node ${patched.id}`, "INVALID_PATCH");
          if (seen.has(p.id)) throw new GraphError(`Duplicate port id ${p.id} in node ${patched.id}`, "PORT_ID_DUPLICATE");
          seen.add(p.id);
        }

        // Before replacing, ensure edges still point to valid ports
        // If ports removed, either fail (strict) or auto-remove edges.
        const existingPorts = new Set(patched.ports.map((p) => p.id));
        const edgeIds = this.index.edgesByNode.get(patched.id) ?? new Set();
        for (const eid of edgeIds) {
          const e = this.index.edgeById.get(eid)!;
          const aOk = e.from.nodeId !== patched.id || existingPorts.has(e.from.portId);
          const bOk = e.to.nodeId !== patched.id || existingPorts.has(e.to.portId);
          if (!aOk || !bOk) {
            if (this.options.strictEndpoints) {
              throw new GraphError(`Node update would orphan edge ${eid}`, "INVALID_EDGE_ENDPOINT");
            } else {
              this._apply({ kind: "edge.remove", edgeId: eid });
            }
          }
        }

        // Replace node in array
        this.nodes = this.nodes.map((x) => (x.id === patched.id ? patched : x));

        // Reindex node ports
        this.deindexNode(patched.id);
        this.indexNode(patched);
        break;
      }

      case "port.update": {
        const n = this.index.nodeById.get(change.nodeId);
        if (!n) throw new GraphError(`Missing node ${change.nodeId}`, "MISSING_NODE");

        const idx = n.ports.findIndex((p) => p.id === change.portId);
        if (idx < 0) throw new GraphError(`Missing port ${change.nodeId}:${change.portId}`, "MISSING_PORT");

        const updatedPorts = deepClone(n.ports);
        updatedPorts[idx] = { ...updatedPorts[idx], ...deepClone(change.patch), id: change.portId };

        this._apply({ kind: "node.update", nodeId: change.nodeId, patch: { ports: updatedPorts } });
        break;
      }

      case "edge.add": {
        const edge = deepClone(change.edge);
        if (!edge.id && this.options.autoIds) edge.id = this.options.idGen();
        if (!edge.id) throw new GraphError("Edge id is required", "INVALID_PATCH");
        if (this.index.edgeById.has(edge.id)) throw new GraphError(`Duplicate edge id ${edge.id}`, "DUPLICATE_ID");

        // Validate endpoints
        this.assertEdgeEndpoints(edge);

        this.edges.push(edge);
        this.indexEdge(edge);
        break;
      }

      case "edge.remove": {
        const { edgeId } = change;
        const e = this.index.edgeById.get(edgeId);
        if (!e) throw new GraphError(`Missing edge ${edgeId}`, "MISSING_EDGE");

        this.edges = this.edges.filter((x) => x.id !== edgeId);
        this.deindexEdge(edgeId);
        break;
      }

      case "edge.update": {
        const e = this.index.edgeById.get(change.edgeId);
        if (!e) throw new GraphError(`Missing edge ${change.edgeId}`, "MISSING_EDGE");

        const patched = { ...e, ...deepClone(change.patch) } as Edge;
        if (patched.id !== e.id) throw new GraphError("Edge id is immutable", "INVALID_PATCH");

        // If endpoints changed via patch, validate and reindex.
        // For simplicity, require endpoints to be changed via edge.reconnect
        if (
          (change.patch).from ||
          (change.patch).to
        ) {
          throw new GraphError("Use edge.reconnect to change endpoints", "INVALID_PATCH");
        }

        // Replace edge in array
        this.edges = this.edges.map((x) => (x.id === patched.id ? patched : x));

        // Update index (wire/protection changes don’t affect endpoints index)
        this.index.edgeById.set(patched.id, patched);
        break;
      }

      case "edge.reconnect": {
        const e = this.index.edgeById.get(change.edgeId);
        if (!e) throw new GraphError(`Missing edge ${change.edgeId}`, "MISSING_EDGE");

        const patched: Edge = {
          ...deepClone(e),
          from: change.from ?? e.from,
          to: change.to ?? e.to
        };

        this.assertEdgeEndpoints(patched);

        // Replace in array
        this.edges = this.edges.map((x) => (x.id === patched.id ? patched : x));

        // Reindex endpoints
        this.deindexEdge(patched.id);
        this.indexEdge(patched);
        break;
      }

      default:
        // exhaustive
        return change as never;
    }
  }

  private emit(changes: GraphChange[]) {
    this.revision++;
    const snapshot = this.getSnapshotUnsafe(); // avoid cloning twice
    for (const fn of this.listeners) fn({ revision: this.revision, changes, snapshot });
  }

  /* ---------- Index management ---------- */

  private rebuildIndexOrThrow() {
    // reset
    this.index = {
      nodeById: new Map(),
      edgeById: new Map(),
      portByKey: new Map(),
      edgesByNode: new Map(),
      edgesByPort: new Map()
    };

    // nodes
    for (const n of this.nodes) {
      if (this.index.nodeById.has(n.id)) throw new GraphError(`Duplicate node id ${n.id}`, "DUPLICATE_ID");
      const seen = new Set<string>();
      for (const p of n.ports) {
        if (seen.has(p.id)) throw new GraphError(`Duplicate port id ${p.id} in node ${n.id}`, "PORT_ID_DUPLICATE");
        seen.add(p.id);
      }
      this.indexNode(n);
    }

    // edges
    for (const e of this.edges) {
      if (this.index.edgeById.has(e.id)) throw new GraphError(`Duplicate edge id ${e.id}`, "DUPLICATE_ID");
      this.assertEdgeEndpoints(e);
      this.indexEdge(e);
    }
  }

  private indexNode(node: BaseNode) {
    this.index.nodeById.set(node.id, node);
    for (const p of node.ports) {
      this.index.portByKey.set(portKey(node.id, p.id), p);
    }
    if (!this.index.edgesByNode.has(node.id)) this.index.edgesByNode.set(node.id, new Set());
  }

  private deindexNode(nodeId: Id) {
    const node = this.index.nodeById.get(nodeId);
    if (node) {
      for (const p of node.ports) this.index.portByKey.delete(portKey(nodeId, p.id));
    }
    this.index.nodeById.delete(nodeId);
    this.index.edgesByNode.delete(nodeId);
  }

  private indexEdge(edge: Edge) {
    this.index.edgeById.set(edge.id, edge);

    // edgesByNode
    const a = edge.from.nodeId;
    const b = edge.to.nodeId;
    if (!this.index.edgesByNode.has(a)) this.index.edgesByNode.set(a, new Set());
    if (!this.index.edgesByNode.has(b)) this.index.edgesByNode.set(b, new Set());
    this.index.edgesByNode.get(a)!.add(edge.id);
    this.index.edgesByNode.get(b)!.add(edge.id);

    // edgesByPort
    const ka = portKey(edge.from.nodeId, edge.from.portId);
    const kb = portKey(edge.to.nodeId, edge.to.portId);
    if (!this.index.edgesByPort.has(ka)) this.index.edgesByPort.set(ka, new Set());
    if (!this.index.edgesByPort.has(kb)) this.index.edgesByPort.set(kb, new Set());
    this.index.edgesByPort.get(ka)!.add(edge.id);
    this.index.edgesByPort.get(kb)!.add(edge.id);
  }

  private deindexEdge(edgeId: Id) {
    const e = this.index.edgeById.get(edgeId);
    if (!e) return;

    // edgesByNode
    this.index.edgesByNode.get(e.from.nodeId)?.delete(edgeId);
    this.index.edgesByNode.get(e.to.nodeId)?.delete(edgeId);

    // edgesByPort
    this.index.edgesByPort.get(portKey(e.from.nodeId, e.from.portId))?.delete(edgeId);
    this.index.edgesByPort.get(portKey(e.to.nodeId, e.to.portId))?.delete(edgeId);

    this.index.edgeById.delete(edgeId);
  }

  private assertEdgeEndpoints(edge: Edge) {
    const nA = this.index.nodeById.get(edge.from.nodeId);
    const nB = this.index.nodeById.get(edge.to.nodeId);
    if (!nA) throw new GraphError(`Missing node ${edge.from.nodeId}`, "MISSING_NODE");
    if (!nB) throw new GraphError(`Missing node ${edge.to.nodeId}`, "MISSING_NODE");

    const pA = this.index.portByKey.get(portKey(edge.from.nodeId, edge.from.portId));
    const pB = this.index.portByKey.get(portKey(edge.to.nodeId, edge.to.portId));
    if (!pA) throw new GraphError(`Missing port ${edge.from.nodeId}:${edge.from.portId}`, "MISSING_PORT");
    if (!pB) throw new GraphError(`Missing port ${edge.to.nodeId}:${edge.to.portId}`, "MISSING_PORT");

    // In strict mode, forbid self-loop on same port
    if (this.options.strictEndpoints) {
      const samePort = edge.from.nodeId === edge.to.nodeId && edge.from.portId === edge.to.portId;
      if (samePort) throw new GraphError("Edge cannot connect a port to itself", "INVALID_EDGE_ENDPOINT");
    }
  }
}

/* =========================================================
 * GraphTx: batches changes and applies in order
 * ========================================================= */

class GraphTx {
  private changes: GraphChange[] = [];
  constructor(private engine: GraphEngine) {}

  apply(c: GraphChange) {
    this.engine._apply(c);
    this.changes.push(c);
  }

  flush(): GraphChange[] {
    const out = this.changes;
    this.changes = [];
    return out;
  }
}
