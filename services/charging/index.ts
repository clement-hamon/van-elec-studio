import type { ComponentInstance, ComponentType, SchemaState } from '~/types/schema'

export type ChargePath = {
  sourceId: string
  batteryId: string
  path: string[]
}

export type ChargeSummary = {
  availableCurrentA: number
  effectiveCurrentA: number
  timeToFullHours: number | null
}

const numericProp = (props: Record<string, unknown>, key: string) => {
  const value = props[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const resolveVoltage = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  if (!component) return null
  const props = component.props as Record<string, unknown>
  const candidate =
    numericProp(props, 'voltage') ||
    numericProp(props, 'outputVoltage') ||
    numericProp(props, 'inputVoltage')

  if (candidate) return candidate

  const domain =
    (component.derived?.voltageDomain as string | undefined) || type?.constraints?.voltageDomain
  if (domain === '12V') return 12
  if (domain === '24V') return 24
  if (domain === '48V') return 48
  return null
}

const resolveSupplyCurrent = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number => {
  if (!component || !type) return 0
  const isSource = type.energyRole === 'source' || type.chargePathRole === 'source'
  if (!isSource) return 0

  const props = component.props as Record<string, unknown>
  const explicit =
    numericProp(props, 'currentA') ||
    numericProp(props, 'ratedCurrentA') ||
    numericProp(props, 'maxOutputCurrentA')
  if (explicit) return explicit

  const watt = numericProp(props, 'watt') || numericProp(props, 'powerW')
  const voltage = resolveVoltage(component, type)
  if (watt && voltage) return watt / voltage

  return 0
}

const resolveOutputLimit = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  if (!component || !type) return null
  const props = component.props as Record<string, unknown>
  const cap =
    numericProp(props, 'maxOutputCurrentA') ||
    numericProp(props, 'maxCurrentA') ||
    numericProp(props, 'outputCurrentA')
  return cap
}

const isBattery = (component: ComponentInstance, type: ComponentType | undefined) =>
  type?.chargePathRole === 'battery' || type?.id === 'battery'

export const findChargePaths = (schema: SchemaState, registry: ComponentType[]): ChargePath[] => {
  const typeById = new Map(registry.map((item) => [item.id, item]))
  const componentById = new Map(schema.components.map((item) => [item.id, item]))
  const outgoing = new Map<string, string[]>()

  schema.cables.forEach((cable) => {
    const list = outgoing.get(cable.sourceId) ?? []
    list.push(cable.targetId)
    outgoing.set(cable.sourceId, list)
  })

  const paths: ChargePath[] = []

  schema.components.forEach((component) => {
    const type = typeById.get(component.typeId)
    if (!type || type.energyRole !== 'source') return

    const stack: { nodeId: string; path: string[]; visited: Set<string> }[] = [
      { nodeId: component.id, path: [component.id], visited: new Set([component.id]) },
    ]

    while (stack.length) {
      const current = stack.pop()
      if (!current) continue
      const nextIds = outgoing.get(current.nodeId) ?? []

      nextIds.forEach((nextId) => {
        if (current.visited.has(nextId)) return
        const nextPath = [...current.path, nextId]
        const nextVisited = new Set(current.visited)
        nextVisited.add(nextId)

        const nextComponent = componentById.get(nextId)
        const nextType = nextComponent ? typeById.get(nextComponent.typeId) : undefined
        if (nextComponent && isBattery(nextComponent, nextType)) {
          paths.push({ sourceId: component.id, batteryId: nextId, path: nextPath })
          return
        }

        stack.push({ nodeId: nextId, path: nextPath, visited: nextVisited })
      })
    }
  })

  return paths
}

export const computeChargeSummary = (
  schema: SchemaState,
  registry: ComponentType[],
): Map<string, ChargeSummary> => {
  const typeById = new Map(registry.map((item) => [item.id, item]))
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()

  schema.cables.forEach((cable) => {
    const out = outgoing.get(cable.sourceId) ?? []
    out.push(cable.targetId)
    outgoing.set(cable.sourceId, out)

    const inc = incoming.get(cable.targetId) ?? []
    inc.push(cable.sourceId)
    incoming.set(cable.targetId, inc)
  })

  const indegree = new Map<string, number>()
  schema.components.forEach((component) => indegree.set(component.id, 0))
  schema.cables.forEach((cable) => {
    indegree.set(cable.targetId, (indegree.get(cable.targetId) ?? 0) + 1)
  })

  const queue: string[] = []
  indegree.forEach((value, key) => {
    if (value === 0) queue.push(key)
  })

  const ordered: string[] = []
  while (queue.length) {
    const id = queue.shift()
    if (!id) continue
    ordered.push(id)
    const next = outgoing.get(id) ?? []
    next.forEach((targetId) => {
      const nextValue = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, nextValue)
      if (nextValue === 0) queue.push(targetId)
    })
  }

  const remaining = schema.components
    .map((component) => component.id)
    .filter((id) => !ordered.includes(id))
  ordered.push(...remaining)

  const outputById = new Map<string, number>()
  const supplyById = new Map<string, number>()
  const capById = new Map<string, number | null>()

  schema.components.forEach((component) => {
    const type = typeById.get(component.typeId)
    supplyById.set(component.id, resolveSupplyCurrent(component, type))
    capById.set(component.id, resolveOutputLimit(component, type))
  })

  ordered.forEach((componentId) => {
    const incomingIds = incoming.get(componentId) ?? []
    const incomingSum = incomingIds.reduce(
      (total, sourceId) => total + (outputById.get(sourceId) ?? 0),
      0,
    )
    const supply = supplyById.get(componentId) ?? 0
    let output = incomingSum + supply
    const cap = capById.get(componentId)
    if (cap !== null && cap !== undefined) {
      output = Math.min(output, cap)
    }
    outputById.set(componentId, output)
  })

  const summaries = new Map<string, ChargeSummary>()

  schema.components.forEach((component) => {
    const type = typeById.get(component.typeId)
    if (!isBattery(component, type)) return

    const incomingIds = incoming.get(component.id) ?? []
    const availableCurrentA = incomingIds.reduce(
      (total, sourceId) => total + (outputById.get(sourceId) ?? 0),
      0,
    )

    const batteryLimitA = numericProp(
      component.props as Record<string, unknown>,
      'maxChargeCurrentA',
    )
    const effectiveCurrentA =
      batteryLimitA && batteryLimitA > 0
        ? Math.min(availableCurrentA, batteryLimitA)
        : availableCurrentA

    const capacityAh = numericProp(component.props as Record<string, unknown>, 'capacityAh')
    const timeToFullHours =
      capacityAh && effectiveCurrentA > 0 ? capacityAh / effectiveCurrentA : null

    summaries.set(component.id, { availableCurrentA, effectiveCurrentA, timeToFullHours })
  })

  return summaries
}
