import type { Cable, ComponentInstance, ComponentType, SchemaState } from '~/types/schema'

type CablePowerInfo = {
  expectedPowerW: number
  circuitVoltageV: number
  expectedCurrentA: number
}

const voltageFromDomain = (domain?: string) => {
  if (domain === '12V') return 12
  if (domain === '24V') return 24
  if (domain === '48V') return 48
  return null
}

const resolveComponentVoltage = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number => {
  if (!component) return 12
  const props = component.props as Record<string, unknown>
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

const loadPower = (component: ComponentInstance | undefined, type: ComponentType | undefined) => {
  if (!component) return 0
  const watt = component.props.watt
  if (typeof watt === 'number' && watt > 0) return watt
  if (type?.category === 'load') return 0
  return 0
}

export const computeCablePower = (
  schema: SchemaState,
  registry: ComponentType[],
): Map<string, CablePowerInfo> => {
  const typeById = new Map(registry.map((item) => [item.id, item]))
  const componentById = new Map(schema.components.map((item) => [item.id, item]))

  const outgoing = new Map<string, string[]>()
  schema.cables.forEach((cable) => {
    const list = outgoing.get(cable.sourceId) ?? []
    list.push(cable.targetId)
    outgoing.set(cable.sourceId, list)
  })

  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  const downstreamPower = (componentId: string): number => {
    if (memo.has(componentId)) return memo.get(componentId) ?? 0
    if (visiting.has(componentId)) return 0
    visiting.add(componentId)

    const component = componentById.get(componentId)
    const type = component ? typeById.get(component.typeId) : undefined

    let total = loadPower(component, type)
    const children = outgoing.get(componentId) ?? []
    children.forEach((childId) => {
      total += downstreamPower(childId)
    })

    visiting.delete(componentId)
    memo.set(componentId, total)
    return total
  }

  const result = new Map<string, CablePowerInfo>()

  schema.cables.forEach((cable: Cable) => {
    const powerW = downstreamPower(cable.targetId)
    const source = componentById.get(cable.sourceId)
    const sourceType = source ? typeById.get(source.typeId) : undefined
    const voltage = resolveComponentVoltage(source, sourceType)
    const current = voltage > 0 ? powerW / voltage : 0

    result.set(cable.id, {
      expectedPowerW: powerW,
      circuitVoltageV: voltage,
      expectedCurrentA: current,
    })
  })

  return result
}
