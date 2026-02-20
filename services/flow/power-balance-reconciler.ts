import type { Diagnostic, NodeFlow, NodeType, ScenarioInput } from "../../types/schema";
import {
  CURRENT_LIMIT_REASONS,
  resolveBatteryPowerCapsW,
} from "./current-calculation";

export interface BalanceNode {
  id: string;
  type: NodeType;
  params?: Record<string, unknown>;
}

export interface ReconcileBalanceInput {
  nodes: BalanceNode[];
  battery: BalanceNode;
  batteryVoltageV: number;
  scenario: ScenarioInput;
  demandByNode: Map<string, number>;
  connectedDemandW: number;
  dispatchableSources: Array<readonly [string, number]>;
  isNodeConnected: (nodeId: string) => boolean;
}

export interface ReconcileBalanceResult {
  diagnostics: Diagnostic[];
  nodeFlows: Record<string, NodeFlow>;
  injectionsW: Map<string, number>;
  hasUnserved: boolean;
  totalSupplyW: number;
}

/**
 * Reconcile demand and supply with battery behavior.
 *
 * Battery policy:
 * - Absorb surplus supply (charge).
 * - Fill supply deficit (discharge).
 * - Always clamp by maxChargeA / maxDischargeA caps.
 */
export const reconcilePowerBalance = (
  input: ReconcileBalanceInput,
): ReconcileBalanceResult => {
  const diagnostics: Diagnostic[] = [];
  const nodeFlows: Record<string, NodeFlow> = {};
  const injectionsW = new Map<string, number>();

  const {
    nodes,
    battery,
    batteryVoltageV,
    scenario,
    demandByNode,
    connectedDemandW,
    dispatchableSources,
    isNodeConnected,
  } = input;

  const { maxChargeW, maxDischargeW } = resolveBatteryPowerCapsW(battery, batteryVoltageV);
  const totalSourceCapW = dispatchableSources.reduce((sum, [, capW]) => sum + capW, 0);
  const totalSupplyCapW = totalSourceCapW + maxDischargeW;
  const servedFactor = connectedDemandW > 0 ? Math.min(1, totalSupplyCapW / connectedDemandW) : 1;
  const servedDemandW = connectedDemandW * servedFactor;

  if (servedFactor < 1) {
    diagnostics.push({
      severity: "warning",
      code: "UNSERVED_DEMAND",
      message: "Demand exceeds available supply; loads scaled proportionally."
    });
  }

  for (const node of nodes) {
    if (node.type !== "load") continue;
    const demandW = demandByNode.get(node.id) ?? 0;
    const servedW = isNodeConnected(node.id) ? demandW * servedFactor : 0;
    // Positive injection means this node consumes power.
    injectionsW.set(node.id, servedW);
    if (servedFactor < 1 && servedW < demandW) {
      nodeFlows[node.id] = {
        ...nodeFlows[node.id],
        clampedBy: [CURRENT_LIMIT_REASONS.supplyShortage],
      };
    }
  }

  const supplyBudgetW = servedDemandW + (servedFactor === 1 ? maxChargeW : 0);
  const sources = [...dispatchableSources];
  const dispatchPolicy = scenario.dispatchPolicy ?? "priority_order";
  const priority = scenario.sourcePriority ?? [];

  if (dispatchPolicy === "priority_order" && priority.length > 0) {
    const rank = new Map<string, number>(priority.map((id, idx) => [id, idx] as const));
    sources.sort((a, b) => (rank.get(a[0]) ?? 999999) - (rank.get(b[0]) ?? 999999));
  }

  let usedSupplyW = 0;
  if (dispatchPolicy === "share_proportionally") {
    const totalCap = sources.reduce((sum, [, cap]) => sum + cap, 0);
    for (const [id, cap] of sources) {
      const use = totalCap > 0 ? Math.min(cap, (cap / totalCap) * supplyBudgetW) : 0;
      usedSupplyW += use;
      nodeFlows[id] = { supplyW: use };
      // Negative injection means this node supplies power.
      injectionsW.set(id, -use);
    }
  } else {
    let remaining = supplyBudgetW;
    for (const [id, cap] of sources) {
      if (remaining <= 1e-6) {
        nodeFlows[id] = { supplyW: 0 };
        injectionsW.set(id, 0);
        continue;
      }
      const use = Math.min(cap, remaining);
      remaining -= use;
      usedSupplyW += use;
      nodeFlows[id] = { supplyW: use };
      injectionsW.set(id, -use);
    }
  }

  const netFromSourcesW = usedSupplyW - servedDemandW;
  let batteryNetA = 0;
  const batteryFlow: NodeFlow = {};

  if (netFromSourcesW >= 0) {
    const chargeW = Math.min(netFromSourcesW, maxChargeW);
    batteryNetA = batteryVoltageV > 0 ? chargeW / batteryVoltageV : 0;
    if (netFromSourcesW - chargeW > 1e-6) {
      diagnostics.push({
        severity: "warning",
        code: "EXCESS_SUPPLY",
        message: "Supply exceeds load and battery charge limit; excess is unused."
      });
      batteryFlow.clampedBy = [CURRENT_LIMIT_REASONS.batteryMaxChargeA];
    }
  } else {
    const dischargeW = Math.min(-netFromSourcesW, maxDischargeW);
    batteryNetA = batteryVoltageV > 0 ? -dischargeW / batteryVoltageV : 0;
    if (servedFactor === 1 && -netFromSourcesW - dischargeW > 1e-6) {
      diagnostics.push({
        severity: "warning",
        code: "UNSERVED_DEMAND",
        message: "Battery discharge limit prevents serving all demand."
      });
      batteryFlow.clampedBy = [CURRENT_LIMIT_REASONS.batteryMaxDischargeA];
    }
  }

  nodeFlows[battery.id] = {
    netA: batteryNetA,
    state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle",
    ...batteryFlow
  };
  injectionsW.set(battery.id, -batteryNetA * batteryVoltageV);

  return {
    diagnostics,
    nodeFlows,
    injectionsW,
    hasUnserved: servedFactor < 1,
    totalSupplyW: usedSupplyW + Math.max(0, -batteryNetA * batteryVoltageV),
  };
};
