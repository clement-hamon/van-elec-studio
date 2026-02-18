import type { Diagnostic, NodeType } from "../../types/schema";
import { policyForNode } from "../flow/node-policies";
import { DEFAULT_DOMAIN_VOLTAGE } from "../flow/voltage-domain";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

// ── Local helpers ──────────────────────────────────────────

export interface FuseEdge extends GraphEdge {
  fuseA?: number;
  voltageV?: number;
  wire?: { lengthM?: number };
}

export interface FuseNode {
  id: string;
  type: NodeType;
  typeId?: string;
  params?: Record<string, unknown>;
}

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

const isSourceNode = (node: FuseNode | undefined) =>
  node?.type === "source" || node?.type === "battery";

const isFuse = (node: FuseNode | undefined) => node?.params?.ratingA !== undefined;

const MAX_FUSE_DISTANCE_M = 0.3;

// ── Visitor ────────────────────────────────────────────────

/**
 * Postorder visitor: accumulates subtree power sums and opens fuses
 * when edge current exceeds the rating.
 *
 * Must run AFTER PowerBalanceVisitor (needs injectionsW).
 *
 * After the walk, exposes: subtreeW, blockedNodes, blownEdges.
 */
export class FuseCheckVisitor<E extends FuseEdge> implements TreeVisitor<E> {
  readonly name = "fuse-check";
  readonly order = "postorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];

  /** Subtree power sum per node (mutated when fuses blow) */
  readonly subtreeW = new Map<string, number>();

  /** Nodes in each node's subtree */
  private readonly subtreeMembers = new Map<string, Set<string>>();

  /** Nodes downstream of a blown fuse */
  readonly blockedNodes = new Set<string>();

  /** Edges where the fuse blew */
  readonly blownEdges = new Set<string>();

  readonly unprotectedEdges = new Set<string>();

  constructor(
    private readonly nodes: FuseNode[],
    private readonly injectionsW: Map<string, number>
  ) {}

  prepare() {
    // Seed each node with its own injection
    for (const node of this.nodes) {
      this.subtreeW.set(node.id, this.injectionsW.get(node.id) ?? 0);
      this.subtreeMembers.set(node.id, new Set([node.id]));
    }
  }

  visit(nodeId: string, _parentId: string | null, parentEdge: E | null, children: string[]): void {
    let sumW = this.subtreeW.get(nodeId) ?? 0;
    const members = this.subtreeMembers.get(nodeId) ?? new Set([nodeId]);

    // Accumulate children
    for (const child of children) {
      sumW += this.subtreeW.get(child) ?? 0;
      const childMembers = this.subtreeMembers.get(child);
      if (childMembers) childMembers.forEach((id) => members.add(id));
    }

    const node = this.nodes.find((n) => n.id === nodeId);
    if (node) {
      // Converter nodes transform required upstream power by efficiency.
      // Example: 500W load behind a 90% converter requires ~556W upstream.
      sumW = policyForNode(node).transformSubtreeW(node, sumW);
    }

    // Check fuse
    const nodeFuseA = numberParam(node?.params, "ratingA");
    const edgeFuseA = parentEdge?.fuseA;
    const fuseA = edgeFuseA ?? nodeFuseA;
    const edgeVoltageV =
      parentEdge?.voltageV && parentEdge.voltageV > 0
        ? parentEdge.voltageV
        : DEFAULT_DOMAIN_VOLTAGE;
    // Fuse ratings are current-based, so we convert subtree power to edge current locally.
    const currentA = Math.abs(sumW) / edgeVoltageV;

    if (parentEdge && fuseA && currentA > fuseA + 1e-6) {
      this.blownEdges.add(parentEdge.id);
      members.forEach((id) => this.blockedNodes.add(id));
      this._diagnostics.push({
        severity: "warning",
        code: "FUSE_OPEN",
        message: "Fuse opened due to overcurrent; downstream loads are unserved.",
        refs: [{ edgeId: parentEdge.id }]
      });
      sumW = 0;
    }

    // Warn about unprotected wires: if the edge is connected to a battery or source and doesn't have a fuse on it or connected node, flag it as unprotected
    if (parentEdge) {
      const fromNode = this.nodes.find((n) => n.id === parentEdge.from);
      const toNode = this.nodes.find((n) => n.id === parentEdge.to);

      const isFromSource = isSourceNode(fromNode);
      const isToFuse = isFuse(toNode);
      const isLongWire = parentEdge.wire?.lengthM !== undefined && parentEdge.wire.lengthM > MAX_FUSE_DISTANCE_M;

      if (isFromSource && (!isToFuse || isLongWire)) {
        this.unprotectedEdges.add(parentEdge.id);
        this._diagnostics.push({
          severity: "warning",
          code: "UNPROTECTED_WIRE",
          message: "Unprotected wire detected, which may pose a fire risk. Consider adding a fuse or moving the existing fuse closer to the power source (<30cm).",
          refs: [{ edgeId: parentEdge.id }]
        });
      }
    }

    this.subtreeW.set(nodeId, sumW);
    this.subtreeMembers.set(nodeId, members);
  }

  diagnostics() {
    return this._diagnostics;
  }
}
