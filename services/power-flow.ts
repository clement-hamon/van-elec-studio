import type { Cable, ComponentInstance, ComponentType, SchemaState } from '~/types/schema'
import { buildGraph } from '~/src/circuit-graph'

type CablePowerInfo = {
  expectedPowerW: number
  circuitVoltageV: number
  expectedCurrentA: number
}

const numericProp = (props: Record<string, unknown>, key: string) => {
  const value = props[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export const voltageFromDomain = (domain?: string) => {
  if (domain === '12V') return 12
  if (domain === '24V') return 24
  if (domain === '48V') return 48
  return null
}

export const resolveComponentVoltage = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number => {
  if (!component) return 12
  const props = component.props as Record<string, unknown>
  const isBattery = type?.chargePathRole === 'battery' || type?.id === 'battery'
  if (isBattery) {
    const batteryOutput =
      numericProp(props, 'outputVoltage') ||
      numericProp(props, 'voltage') ||
      numericProp(props, 'operatingVoltage')
    if (batteryOutput) return batteryOutput
  }
  const candidate =
    (typeof props.voltage === 'number' && props.voltage) ||
    (typeof props.inputVoltage === 'number' && props.inputVoltage) ||
    (typeof props.outputVoltage === 'number' && props.outputVoltage) ||
    null

  if (candidate) return candidate

  const domain =
    (component.derived?.voltageDomain as string | undefined) || type?.constraints?.voltageDomain
  return voltageFromDomain(domain) ?? 12
}

const resolveDemandCurrent = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number => {
  if (!component || !type) return 0
  const isBattery = type.chargePathRole === 'battery' || type.id === 'battery'
  if (isBattery) {
    const props = component.props as Record<string, unknown>
    const maxCharge =
      numericProp(props, 'maxChargeCurrentA') ||
      numericProp(props, 'recommendedChargeCurrentA') ||
      (typeof component.derived?.maxCurrentA === 'number' ? component.derived.maxCurrentA : null) ||
      (typeof type.constraints?.maxCurrent === 'number' ? type.constraints.maxCurrent : null)
    return maxCharge ?? 0
  }

  const isLoad = type.category === 'load' || type.energyRole === 'load'
  if (!isLoad) return 0

  const props = component.props as Record<string, unknown>
  const explicit = numericProp(props, 'currentA')
  if (explicit) return explicit

  const watt = numericProp(props, 'watt') || numericProp(props, 'powerW')
  const voltage = resolveComponentVoltage(component, type)
  if (watt && voltage) return watt / voltage

  return 0
}

const resolveThroughputCap = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  if (!component || !type) return null
  const isConverter =
    type.energyRole === 'charger' ||
    type.chargePathRole === 'charger' ||
    type.chargePathRole === 'controller'
  if (!isConverter) return null

  const props = component.props as Record<string, unknown>
  return (
    numericProp(props, 'maxOutputCurrentA') ||
    numericProp(props, 'maxInputCurrentA') ||
    numericProp(props, 'maxCurrentA') ||
    numericProp(props, 'ratedCurrentA')
  )
}

export const computeCablePower = (
  schema: SchemaState,
  registry: ComponentType[],
): Map<string, CablePowerInfo> => {
  const graph = buildGraph(schema, registry)
  const typeById = graph.typesById
  const logicalNodes = new Set(graph.logicalNodeIds)

  const demandById = new Map<string, number>()
  const capById = new Map<string, number | null>()
  const voltageById = new Map<string, number>()

  graph.nodes.forEach((component) => {
    const type = typeById.get(component.typeId)
    const isLogical = logicalNodes.has(component.id)
    const demand = isLogical ? resolveDemandCurrent(component, type) : 0
    demandById.set(component.id, demand)
    capById.set(component.id, isLogical ? resolveThroughputCap(component, type) : null)
    voltageById.set(component.id, resolveComponentVoltage(component, type))
  })

  const outgoing = graph.outgoing
  const childSumById = new Map<string, number>()
  const outgoingAvailableById = new Map<string, number>()
  const demandMemo = new Map<string, number>()
  const visiting = new Set<string>()

  const downstreamDemand = (nodeId: string): number => {
    if (demandMemo.has(nodeId)) return demandMemo.get(nodeId) ?? 0
    if (visiting.has(nodeId)) return 0
    visiting.add(nodeId)

    const own = demandById.get(nodeId) ?? 0
    let childSum = 0
    const children = outgoing.get(nodeId) ?? []
    children.forEach((childId) => {
      childSum += downstreamDemand(childId)
    })

    const cap = capById.get(nodeId)
    const available =
      typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? Math.min(childSum, cap) : childSum

    const total = own + available
    childSumById.set(nodeId, childSum)
    outgoingAvailableById.set(nodeId, available)
    demandMemo.set(nodeId, total)
    visiting.delete(nodeId)
    return total
  }

  const result = new Map<string, CablePowerInfo>()

  schema.cables.forEach((cable: Cable) => {
    const sourceId = cable.sourceId
    const targetId = cable.targetId
    downstreamDemand(sourceId)
    const targetDemand = downstreamDemand(targetId)
    const sourceChildSum = childSumById.get(sourceId) ?? 0
    const sourceAvailable = outgoingAvailableById.get(sourceId) ?? sourceChildSum
    const scale = sourceChildSum > 0 ? Math.min(1, sourceAvailable / sourceChildSum) : 0
    const expectedCurrent = targetDemand * scale
    const circuitVoltage = voltageById.get(sourceId) ?? 12
    const expectedPower = expectedCurrent * circuitVoltage

    result.set(cable.id, {
      expectedPowerW: expectedPower,
      circuitVoltageV: circuitVoltage,
      expectedCurrentA: expectedCurrent,
    })
  })

  return result
}
