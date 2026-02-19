import type { NodeType } from '../../types/schema'
import { DEFAULT_DOMAIN_VOLTAGE } from './voltage-domain'

/**
 * Role:
 * Central authority for all current/power calculation formulas used by flow solving.
 *
 * Input:
 * Node params, edge voltages/limits, subtree power envelopes.
 *
 * Output:
 * Deterministic power/current values and standardized limit reason codes.
 */

export interface CurrentNode {
  id: string
  type: NodeType
  params?: Record<string, unknown>
}

export const CURRENT_LIMIT_REASONS = {
  fuseA: 'fuseA',
  wireMaxA: 'wire.maxA',
  loadMaxDemandA: 'load.maxDemandA',
  sourceMaxSupplyA: 'source.maxSupplyA',
  batteryMaxChargeA: 'battery.maxChargeA',
  batteryMaxDischargeA: 'battery.maxDischargeA',
  supplyShortage: 'supply.shortage',
} as const

export type CurrentLimitReason =
  (typeof CURRENT_LIMIT_REASONS)[keyof typeof CURRENT_LIMIT_REASONS]

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const clampMinZero = (value: number) => Math.max(0, value)

const clampEfficiency = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0.01, value))
}

/**
 * Role:
 * Resolve load demand in watts from node params.
 *
 * Input:
 * A node and resolved operating voltage on that branch.
 *
 * Output:
 * Non-negative demand power in watts.
 */
export const resolveNodeDemandW = (node: CurrentNode, voltageV: number) => {
  if (node.type !== 'load') return 0
  const watts = numberParam(node.params, 'watts')
  const amps = numberParam(node.params, 'amps')
  const dutyCycle = numberParam(node.params, 'dutyCycle') ?? 1
  const baseW = typeof watts === 'number' ? watts : typeof amps === 'number' ? amps * voltageV : 0
  return clampMinZero(baseW) * clampMinZero(dutyCycle)
}

/**
 * Role:
 * Resolve source capacity in watts from node params.
 *
 * Input:
 * A node and resolved operating voltage on that branch.
 *
 * Output:
 * Non-negative source capacity in watts.
 */
export const resolveNodeSupplyCapW = (node: CurrentNode, voltageV: number) => {
  if (node.type !== 'source') return 0
  const availableW = numberParam(node.params, 'availableW')
  const maxOutA = numberParam(node.params, 'maxOutA')
  if (typeof availableW === 'number') return clampMinZero(availableW)
  if (typeof maxOutA === 'number') return clampMinZero(maxOutA) * clampMinZero(voltageV)
  return 0
}

/**
 * Role:
 * Transform subtree power when propagating through a node toward upstream.
 *
 * Input:
 * A node and signed subtree power.
 *
 * Output:
 * Signed upstream power adjusted for conversion efficiency when applicable.
 */
export const transformSubtreeW = (node: CurrentNode, subtreeW: number) => {
  if (node.type !== 'conversion') return subtreeW
  if (Math.abs(subtreeW) <= 1e-9) return 0
  const efficiency = clampEfficiency(numberParam(node.params, 'efficiency'))
  if (subtreeW > 0) return subtreeW / efficiency
  return subtreeW * efficiency
}

/**
 * Role:
 * Resolve battery charge/discharge power caps from battery params.
 *
 * Input:
 * Battery node params and solved battery voltage.
 *
 * Output:
 * Max charge/discharge powers in watts.
 */
export const resolveBatteryPowerCapsW = (battery: CurrentNode, batteryVoltageV: number) => {
  const maxDischargeA = numberParam(battery.params, 'maxDischargeA') ?? Number.POSITIVE_INFINITY
  const maxChargeA = numberParam(battery.params, 'maxChargeA') ?? maxDischargeA
  return {
    maxDischargeW: maxDischargeA * batteryVoltageV,
    maxChargeW: maxChargeA * batteryVoltageV,
  }
}

/**
 * Role:
 * Resolve effective edge voltage used for current conversion.
 *
 * Input:
 * Optional edge voltage and optional fallback voltage.
 *
 * Output:
 * Strictly positive voltage value.
 */
export const resolveEdgeVoltageV = (
  edgeVoltageV: number | undefined,
  fallbackVoltageV = DEFAULT_DOMAIN_VOLTAGE,
) => {
  if (typeof edgeVoltageV === 'number' && edgeVoltageV > 0) return edgeVoltageV
  return fallbackVoltageV
}

/**
 * Role:
 * Convert signed power to signed current.
 *
 * Input:
 * Signed power in watts and positive voltage.
 *
 * Output:
 * Signed current in amperes.
 */
export const powerToCurrentA = (powerW: number, voltageV: number) => {
  if (!Number.isFinite(powerW) || !Number.isFinite(voltageV) || voltageV <= 0) return 0
  return powerW / voltageV
}

/**
 * Role:
 * Convert signed power to current magnitude.
 *
 * Input:
 * Signed power in watts and positive voltage.
 *
 * Output:
 * Non-negative current magnitude in amperes.
 */
export const powerToCurrentMagnitudeA = (powerW: number, voltageV: number) => {
  return Math.abs(powerToCurrentA(powerW, voltageV))
}

/**
 * Role:
 * Compute wire utilization ratio.
 *
 * Input:
 * Signed/unsigned current and optional wire ampacity.
 *
 * Output:
 * Utilization ratio or undefined when no ampacity is available.
 */
export const resolveCurrentUtilization = (currentA: number, maxA: number | undefined) => {
  if (!maxA || maxA <= 0) return undefined
  return Math.abs(currentA) / maxA
}

/**
 * Role:
 * Resolve simulation-mode limiting reasons for a solved edge current.
 *
 * Input:
 * Signed edge current and optional wire ampacity.
 *
 * Output:
 * Standardized limit reason list.
 */
export const resolveSimulationLimitReasons = (
  currentA: number,
  wireMaxA: number | undefined,
): CurrentLimitReason[] => {
  const reasons: CurrentLimitReason[] = []
  if (wireMaxA && Math.abs(currentA) > wireMaxA + 1e-6) reasons.push(CURRENT_LIMIT_REASONS.wireMaxA)
  return reasons
}

/**
 * Role:
 * Resolve cable-sizing-mode branch flow and standardized limiting reasons.
 *
 * Input:
 * Demand/supply subtree powers in watts and edge voltage.
 *
 * Output:
 * Parent-to-child signed sizing current and limit reason list.
 */
export const resolveSizingFlow = (
  demandW: number,
  supplyW: number,
  edgeVoltageV: number,
): {
  flowParentToChildA: number
  demandA: number
  supplyA: number
  limitedBy: CurrentLimitReason[]
} => {
  const demandA = powerToCurrentA(Math.max(0, demandW), edgeVoltageV)
  const supplyA = powerToCurrentA(Math.max(0, supplyW), edgeVoltageV)
  const sizedA = Math.max(demandA, supplyA)
  const flowParentToChildA = demandA >= supplyA ? sizedA : -sizedA
  return {
    flowParentToChildA,
    demandA,
    supplyA,
    limitedBy: resolveSizingLimitReasons(demandA, supplyA),
  }
}

/**
 * Role:
 * Resolve cable-sizing reasons from demand/supply envelopes.
 *
 * Input:
 * Demand and supply currents in amperes.
 *
 * Output:
 * Standardized limit reason list.
 */
export const resolveSizingLimitReasons = (
  demandA: number,
  supplyA: number,
): CurrentLimitReason[] => {
  const reasons: CurrentLimitReason[] = []
  const epsilon = 1e-6
  if (Math.abs(demandA - supplyA) <= epsilon && Math.max(demandA, supplyA) > epsilon) {
    reasons.push(CURRENT_LIMIT_REASONS.loadMaxDemandA, CURRENT_LIMIT_REASONS.sourceMaxSupplyA)
    return reasons
  }
  if (demandA > supplyA + epsilon) reasons.push(CURRENT_LIMIT_REASONS.loadMaxDemandA)
  if (supplyA > demandA + epsilon) reasons.push(CURRENT_LIMIT_REASONS.sourceMaxSupplyA)
  return reasons
}

export const CABLE_SIZING_DESIGN_MARGIN = 1.25

/**
 * Role:
 * Convert solved sizing current to conductor design current.
 *
 * Input:
 * Solved branch sizing current and optional design margin.
 *
 * Output:
 * Non-negative design current in amperes.
 */
export const toCableDesignCurrentA = (
  sizingCurrentA: number,
  designMargin = CABLE_SIZING_DESIGN_MARGIN,
) => {
  return Math.max(0, sizingCurrentA) * Math.max(0, designMargin)
}
