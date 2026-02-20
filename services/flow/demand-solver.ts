import type { NodeFlow, NodeType } from "../../types/schema";
import { resolveNodeDemandW } from "./current-calculation";
import type { GraphEdge, SpanningTree } from "../spanning-tree";

export interface DemandNode {
  id: string;
  type: NodeType;
  params?: Record<string, unknown>;
}

export interface DemandEdge extends GraphEdge {
  voltageV?: number;
}

export interface DemandSolveResult {
  demandByNode: Map<string, number>;
  nodeFlows: Record<string, NodeFlow>;
  totalDemandW: number;
  connectedDemandW: number;
}

/**
 * Solve load-only demand values.
 *
 * The solver is intentionally isolated from source/battery dispatch so demand
 * can be reasoned about and tested independently.
 */
export const solveDemand = <E extends DemandEdge>(
  nodes: DemandNode[],
  tree: SpanningTree<E>,
  batteryVoltageV: number,
): DemandSolveResult => {
  const demandByNode = new Map<string, number>();
  const nodeFlows: Record<string, NodeFlow> = {};
  let totalDemandW = 0;
  let connectedDemandW = 0;

  for (const node of nodes) {
    if (node.type !== "load") continue;

    const parentEdge = tree.parentEdge.get(node.id) ?? undefined;
    const nodeVoltage = parentEdge?.voltageV && parentEdge.voltageV > 0
      ? parentEdge.voltageV
      : batteryVoltageV;
    const demandW = resolveNodeDemandW(node, nodeVoltage);

    demandByNode.set(node.id, demandW);
    nodeFlows[node.id] = { demandW };
    totalDemandW += demandW;
    if (tree.parent.has(node.id)) connectedDemandW += demandW;
  }

  return {
    demandByNode,
    nodeFlows,
    totalDemandW,
    connectedDemandW,
  };
};
