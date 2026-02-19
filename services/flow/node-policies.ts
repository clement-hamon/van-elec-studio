import type { NodeType } from "../../types/schema";
import {
  resolveNodeDemandW,
  resolveNodeSupplyCapW,
  transformSubtreeW as transformNodeSubtreeW,
} from "./current-calculation";

/**
 * Role:
 * Transitional adapter layer that preserves the NodePolicy API expected by
 * visitors while delegating formulas to flow/current-calculation.
 *
 * Input:
 * PolicyNode + local voltage + subtree power.
 *
 * Output:
 * Demand/supply/transform values from the centralized current model.
 */

export interface PolicyNode {
  id: string;
  type: NodeType;
  typeId?: string;
  params?: Record<string, unknown>;
}

export interface NodePolicy {
  demandW(node: PolicyNode, voltageV: number): number;
  supplyCapW(node: PolicyNode, voltageV: number): number;
  // Transform subtree power when crossing this node upstream.
  // Most nodes are pass-through; converters apply efficiency.
  transformSubtreeW(node: PolicyNode, subtreeW: number): number;
}

/**
 * Role:
 * Compatibility adapter kept for visitors that still consume a NodePolicy API.
 *
 * Input:
 * Any node type + local branch voltage.
 *
 * Output:
 * Delegated current/power formulas from flow/current-calculation.
 */
const delegatedPolicy: NodePolicy = {
  demandW(node, voltageV) {
    return resolveNodeDemandW(node, voltageV);
  },
  supplyCapW(node, voltageV) {
    return resolveNodeSupplyCapW(node, voltageV);
  },
  transformSubtreeW(node, subtreeW) {
    return transformNodeSubtreeW(node, subtreeW);
  },
};

export const policyForNode = (_node: PolicyNode): NodePolicy => {
  return delegatedPolicy;
};
