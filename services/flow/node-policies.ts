import type { NodeType } from "../../types/schema";

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

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const clampMinZero = (value: number) => Math.max(0, value);

const clampEfficiency = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.01, value));
};

const defaultPolicy: NodePolicy = {
  demandW() {
    return 0;
  },
  supplyCapW() {
    return 0;
  },
  transformSubtreeW(_node, subtreeW) {
    return subtreeW;
  },
};

const loadPolicy: NodePolicy = {
  ...defaultPolicy,
  demandW(node, voltageV) {
    const watts = numberParam(node.params, "watts");
    const amps = numberParam(node.params, "amps");
    const dutyCycle = numberParam(node.params, "dutyCycle") ?? 1;

    const baseW = typeof watts === "number" ? watts : typeof amps === "number" ? amps * voltageV : 0;
    return clampMinZero(baseW) * clampMinZero(dutyCycle);
  },
};

const sourcePolicy: NodePolicy = {
  ...defaultPolicy,
  supplyCapW(node, voltageV) {
    const availableW = numberParam(node.params, "availableW");
    const maxOutA = numberParam(node.params, "maxOutA");

    if (typeof availableW === "number") return clampMinZero(availableW);
    if (typeof maxOutA === "number") return clampMinZero(maxOutA) * clampMinZero(voltageV);
    return 0;
  },
};

const conversionPolicy: NodePolicy = {
  ...defaultPolicy,
  transformSubtreeW(node, subtreeW) {
    if (Math.abs(subtreeW) <= 1e-9) return 0;

    const efficiency = clampEfficiency(numberParam(node.params, "efficiency"));
    // Positive subtreeW means demand flowing from parent -> child.
    // Upstream side must provide more power than downstream demand.
    if (subtreeW > 0) return subtreeW / efficiency;
    // Negative subtreeW means supply flowing child -> parent.
    // Upstream delivered supply is reduced by conversion losses.
    return subtreeW * efficiency;
  },
};

const policyByType: Record<NodeType, NodePolicy> = {
  source: sourcePolicy,
  battery: defaultPolicy,
  conversion: conversionPolicy,
  distribution: defaultPolicy,
  load: loadPolicy,
};

export const policyForNode = (node: PolicyNode): NodePolicy => {
  return policyByType[node.type] ?? defaultPolicy;
};
