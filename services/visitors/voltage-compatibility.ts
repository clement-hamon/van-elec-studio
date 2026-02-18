import type { Diagnostic, NodeType } from "../../types/schema";
import type { GraphEdge } from "../spanning-tree";
import type { TreeVisitor } from "./tree-visitor";

export interface VoltageNode {
  id: string;
  type: NodeType;
  typeId?: string;
  params?: Record<string, unknown>;
}

export interface VoltageEdge extends GraphEdge {
  voltageV?: number;
}

interface VoltageProfile {
  operationalVoltageV?: number;
  maxVoltageV?: number;
  maxInputVoltageV?: number;
  outputVoltageV?: number;
}

const EPSILON = 1e-6;

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
};

const resolveProfile = (node: VoltageNode): VoltageProfile => {
  const operationalV =
    numberParam(node.params, "operationalV") ??
    numberParam(node.params, "nominalV");

  const defaultBatteryMaxV =
    node.type === "battery" && typeof operationalV === "number" ? operationalV * 1.2 : undefined;

  const maxVoltageV =
    numberParam(node.params, "maxVoltageV") ??
    numberParam(node.params, "maxChargeV") ??
    defaultBatteryMaxV;

  const maxInputVoltageV =
    numberParam(node.params, "maxInputV") ??
    maxVoltageV;

  const outputVoltageV =
    numberParam(node.params, "outputV") ??
    operationalV;

  return {
    operationalVoltageV: operationalV,
    maxVoltageV,
    maxInputVoltageV,
    outputVoltageV,
  };
};

/**
 * Visitor validating voltage compatibility between directly connected nodes.
 *
 * Rule:
 * - each node may define operational and max voltage,
 * - converters may define max input and output voltage,
 * - an edge is invalid when sender effective voltage exceeds receiver max input voltage.
 *
 * Effective sender voltage priority:
 * 1) sender outputV / operationalV
 * 2) edge voltage fallback resolved by the flow mapper
 */
export class VoltageCompatibilityVisitor<E extends VoltageEdge> implements TreeVisitor<E> {
  readonly name = "voltage-compatibility";
  readonly order = "postorder" as const;

  private readonly _diagnostics: Diagnostic[] = [];
  private readonly checkedEdgeIds = new Set<string>();
  private readonly checkedNodeIds = new Set<string>();
  private readonly nodeById = new Map<string, VoltageNode>();
  private readonly effectiveOutputVoltageByNode = new Map<string, number>();

  constructor(private readonly nodes: VoltageNode[]) {
    for (const node of nodes) {
      this.nodeById.set(node.id, node);
    }
  }

  prepare() {
    this.checkedEdgeIds.clear();
    this.checkedNodeIds.clear();
    this.effectiveOutputVoltageByNode.clear();
  }

  visit(nodeId: string, _parentId: string | null, parentEdge: E | null, children: string[]): void {
    const node = this.nodeById.get(nodeId);
    if (!node) return;

    if (!this.checkedNodeIds.has(nodeId)) {
      this.checkedNodeIds.add(nodeId);
      this.checkNodeProfile(node);
    }

    // Compute node effective output after children are processed (postorder).
    // This preserves source voltage across pass-through nodes in the charging path.
    const profile = resolveProfile(node);
    const explicitOutputV = profile.outputVoltageV ?? profile.operationalVoltageV;
    let inheritedOutputV: number | undefined;
    for (const childId of children) {
      const childV = this.effectiveOutputVoltageByNode.get(childId);
      if (typeof childV !== "number") continue;
      if (typeof inheritedOutputV !== "number" || childV > inheritedOutputV) {
        inheritedOutputV = childV;
      }
    }

    const fallbackEdgeV =
      parentEdge?.voltageV && parentEdge.voltageV > 0 ? parentEdge.voltageV : undefined;
    const effectiveOutputV = explicitOutputV ?? inheritedOutputV ?? fallbackEdgeV;
    if (typeof effectiveOutputV === "number") {
      this.effectiveOutputVoltageByNode.set(nodeId, effectiveOutputV);
    }

    if (parentEdge && !this.checkedEdgeIds.has(parentEdge.id)) {
      this.checkedEdgeIds.add(parentEdge.id);
      this.checkEdge(parentEdge);
    }
  }

  private checkNodeProfile(node: VoltageNode) {
    const profile = resolveProfile(node);
    if (
      typeof profile.maxVoltageV === "number" &&
      typeof profile.operationalVoltageV === "number" &&
      profile.operationalVoltageV > profile.maxVoltageV + EPSILON
    ) {
      this._diagnostics.push({
        severity: "error",
        code: "NODE_VOLTAGE_SELF_INCOMPATIBLE",
        message:
          `Node operating voltage (${profile.operationalVoltageV.toFixed(1)}V) exceeds its max voltage ` +
          `(${profile.maxVoltageV.toFixed(1)}V).`,
        refs: [{ nodeId: node.id }]
      });
    }
  }

  private checkEdge(edge: E) {
    const fromNode = this.nodeById.get(edge.from);
    const toNode = this.nodeById.get(edge.to);
    if (!fromNode || !toNode) return;

    const fromProfile = resolveProfile(fromNode);
    const toProfile = resolveProfile(toNode);

    const senderVoltageV =
      fromProfile.outputVoltageV ??
      fromProfile.operationalVoltageV ??
      this.effectiveOutputVoltageByNode.get(fromNode.id) ??
      edge.voltageV;

    const receiverMaxInputV =
      toProfile.maxInputVoltageV ??
      toProfile.maxVoltageV;

    if (
      typeof senderVoltageV === "number" &&
      typeof receiverMaxInputV === "number" &&
      senderVoltageV > receiverMaxInputV + EPSILON
    ) {
      this._diagnostics.push({
        severity: "error",
        code: "EDGE_OVERVOLTAGE_INCOMPATIBLE",
        message:
          `${fromNode.id} may deliver ${senderVoltageV.toFixed(1)}V, but ${toNode.id} accepts at most ` +
          `${receiverMaxInputV.toFixed(1)}V.`,
        refs: [{ edgeId: edge.id }, { nodeId: fromNode.id }, { nodeId: toNode.id }]
      });
    }
  }

  diagnostics() {
    return this._diagnostics;
  }
}
