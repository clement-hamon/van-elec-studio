import type { NodeType } from "../../types/schema";
import {
  resolveNodeSupplyCapW,
  transformSubtreeW,
} from "./current-calculation";
import type { GraphEdge, SpanningTree } from "../spanning-tree";

export interface SupplyNode {
  id: string;
  type: NodeType;
  params?: Record<string, unknown>;
}

export interface SupplyEdge extends GraphEdge {
  voltageV?: number;
}

export interface SupplySolveResult {
  supplyCapByNode: Map<string, number>;
  dispatchableSources: Array<readonly [string, number]>;
}

/**
 * Solve source-only capacity values and source deliverability to the battery root.
 *
 * Converter limits are applied while walking ancestors toward the root, so the
 * resulting source capacities are directly dispatchable by the balance stage.
 */
export const solveSupply = <E extends SupplyEdge>(
  nodes: SupplyNode[],
  tree: SpanningTree<E>,
  batteryVoltageV: number,
): SupplySolveResult => {
  const nodeById = new Map<string, SupplyNode>(nodes.map((node) => [node.id, node]));
  const supplyCapByNode = new Map<string, number>();
  const dispatchableSources: Array<readonly [string, number]> = [];

  const resolveSourceDeliverableToRootW = (sourceId: string, sourceCapW: number) => {
    let deliverableW = sourceCapW;
    let cursor = sourceId;

    while (true) {
      const parentId = tree.parent.get(cursor);
      if (parentId === undefined || parentId === null) return deliverableW;
      const parentNode = nodeById.get(parentId);
      if (!parentNode) return deliverableW;

      // Moving supply upstream through converters enforces output caps/efficiency.
      deliverableW = Math.abs(transformSubtreeW(parentNode, -deliverableW));
      cursor = parentId;
    }
  };

  for (const node of nodes) {
    if (node.type !== "source") continue;
    if (!tree.parent.has(node.id)) continue;

    const parentEdge = tree.parentEdge.get(node.id) ?? undefined;
    const nodeVoltage = parentEdge?.voltageV && parentEdge.voltageV > 0
      ? parentEdge.voltageV
      : batteryVoltageV;
    const sourceCapW = resolveNodeSupplyCapW(node, nodeVoltage);

    supplyCapByNode.set(node.id, sourceCapW);
    dispatchableSources.push([node.id, resolveSourceDeliverableToRootW(node.id, sourceCapW)]);
  }

  return {
    supplyCapByNode,
    dispatchableSources,
  };
};
