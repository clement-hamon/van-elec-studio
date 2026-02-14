import { GraphEngine } from '~/services/graph-engine'
import {
  computeFlow,
  type BaseNode,
  type Edge as FlowEdge,
  type FlowOutput,
  type GraphInput,
  type Port as FlowPort,
  type ScenarioInput,
} from '~/services/flow-engine-simple'
import type { Cable, ComponentInstance, ComponentType, SchemaState } from '~/types/schema'
import { estimateAmpacityForAwg } from '~/services/cable'

type PortDefinition = ComponentType['ports'][number]

const DEFAULT_DC_V = 12
const DEFAULT_AC_V = 230

const numericProp = (props: Record<string, unknown>, key: string) => {
  const value = props[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const pickProp = (props: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = numericProp(props, key)
    if (value !== null) return value
  }
  return null
}

const normalizeVoltage = (voltage: number, kind: 'dc' | 'ac') => {
  const standards = kind === 'dc' ? [12, 24, 48] : [120, 230]
  const tolerance = kind === 'dc' ? 1 : 5
  const match = standards.find((value) => Math.abs(value - voltage) <= tolerance)
  if (match) return match
  return Math.round(voltage * 10) / 10
}

const formatDomain = (kind: 'dc' | 'ac', voltage: number) => {
  const normalized = normalizeVoltage(voltage, kind)
  return `${kind === 'dc' ? 'DC' : 'AC'}_${normalized}V`
}

const resolveOutputVoltage = (
  component: ComponentInstance,
  voltageResolver: { getOutputVoltage: (nodeId: string) => number },
  fallback: number,
) => {
  const resolved = voltageResolver.getOutputVoltage(component.id)
  return resolved > 0 ? resolved : fallback
}

const resolveInputVoltage = (
  component: ComponentInstance,
  fallback: number,
) => {
  const props = component.props as Record<string, unknown>
  const fromProps =
    pickProp(props, ['inputVoltage', 'maxInputVoltage', 'operatingVoltage', 'voltage']) ?? null
  return fromProps ?? fallback
}

const buildNodeParams = (
  component: ComponentInstance,
  nodeType: BaseNode['type'],
  outputVoltage: number,
) => {
  const props = component.props as Record<string, unknown>
  const params: Record<string, unknown> = {}

  if (nodeType === 'load') {
    const watts = pickProp(props, ['watt', 'powerW', 'continuousW'])
    const amps = pickProp(props, ['currentA'])
    if (watts !== null) params.watts = watts
    if (amps !== null) params.amps = amps
    const duty = numericProp(props, 'dutyCycle')
    if (duty !== null) params.dutyCycle = duty
  }

  if (nodeType === 'source') {
    const watts = pickProp(props, ['watt', 'powerW', 'continuousW'])
    const maxOutA = pickProp(props, ['currentA', 'ratedCurrentA', 'maxOutputCurrentA', 'maxCurrentA'])
    if (watts !== null) params.availableW = watts
    if (maxOutA !== null) params.maxOutA = maxOutA
  }

  if (nodeType === 'storage') {
    const maxChargeA = pickProp(props, ['maxChargeCurrentA', 'recommendedChargeCurrentA'])
    const maxDischargeA = pickProp(props, ['maxDischargeCurrentA', 'maxOutputCurrentA', 'maxCurrentA'])

    if (maxChargeA !== null) params.maxChargeA = maxChargeA
    if (maxDischargeA !== null) params.maxDischargeA = maxDischargeA
    if (outputVoltage > 0) params.nominalV = outputVoltage
  }

  if (nodeType === 'conversion') {
    const maxOutA = pickProp(props, ['maxOutputCurrentA', 'maxCurrentA', 'ratedCurrentA'])
    const maxOutW = pickProp(props, ['continuousW', 'powerW', 'watt'])
    const efficiency = numericProp(props, 'efficiency')
    if (maxOutA !== null) params.maxOutA = maxOutA
    if (maxOutW !== null) params.maxOutW = maxOutW
    if (efficiency !== null) params.efficiency = efficiency
  }

  if (nodeType === 'distribution') {
    const ratingA = pickProp(props, ['ratingA'])
    if (ratingA !== null) params.ratingA = ratingA
  }

  return params
}

const isBatteryType = (type: ComponentType | undefined) => type?.id === 'battery'

const resolveBatteryChargeVoltage = (
  component: ComponentInstance,
  outputVoltage: number,
) => {
  const props = component.props as Record<string, unknown>
  const chargeVoltage =
    pickProp(props, [
      'maxInputVoltage',
      'recommendedChargeVoltage',
      'chargeCutoffVoltage',
      'inputVoltage',
      'operatingVoltage',
      'voltage',
    ]) ?? null
  return chargeVoltage ?? outputVoltage
}

const resolveBatteryChargeCurrentA = (component: ComponentInstance) => {
  const props = component.props as Record<string, unknown>
  const explicit = pickProp(props, ['maxChargeCurrentA', 'recommendedChargeCurrentA'])
  if (explicit !== null) return explicit

  const fallback = pickProp(props, ['maxCurrentA', 'maxOutputCurrentA', 'maxDischargeCurrentA'])
  if (fallback !== null) return fallback

  return null
}

const pickBatteryPosPortId = (ports: PortDefinition[]) => {
  if (ports.length === 0) return undefined
  const posPort = ports.find((port) => port.conductor === 'POS')
  return posPort?.id ?? ports[0]?.id
}

export const ensureCablePorts = (
  schema: SchemaState,
  registry: ComponentType[],
): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  const componentById = new Map(schema.components.map((component) => [component.id, component]))

  const usedPorts = new Map<string, Set<string>>()
  const markUsed = (componentId: string, portId: string) => {
    if (!usedPorts.has(componentId)) usedPorts.set(componentId, new Set())
    usedPorts.get(componentId)?.add(portId)
  }

  const isValidPort = (componentId: string, portId: string | undefined) => {
    if (!portId) return false
    const component = componentById.get(componentId)
    if (!component) return false
    const type = typeById.get(component.typeId)
    if (!type) return false
    return type.ports.some((port) => port.id === portId)
  }

  schema.cables.forEach((cable) => {
    if (isValidPort(cable.sourceId, cable.sourcePortId)) {
      markUsed(cable.sourceId, cable.sourcePortId as string)
    }
    if (isValidPort(cable.targetId, cable.targetPortId)) {
      markUsed(cable.targetId, cable.targetPortId as string)
    }
  })

  const pickPort = (
    componentId: string,
    direction: 'in' | 'out',
    existingPortId?: string,
  ) => {
    const component = componentById.get(componentId)
    const type = component ? typeById.get(component.typeId) : undefined
    const ports = type?.ports ?? []
    if (existingPortId && ports.some((port) => port.id === existingPortId)) return existingPortId

    const candidates = ports.filter(
      (port) => port.direction === direction || port.direction === 'bidirectional',
    )
    const fallback = candidates.length > 0 ? candidates : ports
    if (fallback.length === 0) return undefined

    if (direction === 'out') {
      const used = usedPorts.get(componentId) ?? new Set()
      const available = fallback.find((port) => !used.has(port.id))
      if (available) return available.id
    }

    return fallback[0]?.id
  }

  let mutated = false
  const nextCables = schema.cables.map((cable) => {
    const sourcePortId = pickPort(cable.sourceId, 'out', cable.sourcePortId)
    const targetPortId = pickPort(cable.targetId, 'in', cable.targetPortId)

    if (sourcePortId && sourcePortId !== cable.sourcePortId) {
      markUsed(cable.sourceId, sourcePortId)
      mutated = true
    }
    if (targetPortId && targetPortId !== cable.targetPortId) {
      markUsed(cable.targetId, targetPortId)
      mutated = true
    }

    const changed = sourcePortId !== cable.sourcePortId || targetPortId !== cable.targetPortId
    if (!changed) return cable
    return { ...cable, sourcePortId, targetPortId }
  })

  if (!mutated) return schema
  return { ...schema, cables: nextCables }
}

type EdgeDomainMeta = { domain: string; voltage: number }

export const computeFlowForSchema = (
  schema: SchemaState,
  registry: ComponentType[],
  scenarioOverride?: ScenarioInput,
): { graph: GraphInput; flow: FlowOutput; edgeMeta: Map<string, EdgeDomainMeta> } => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  const componentById = new Map(schema.components.map((component) => [component.id, component]))
  const incomingByComponent = new Map<string, string[]>()

  schema.cables.forEach((cable) => {
    const incoming = incomingByComponent.get(cable.targetId) ?? []
    incoming.push(cable.sourceId)
    incomingByComponent.set(cable.targetId, incoming)
  })

  const voltageResolver = (() => {
    const outputMemo = new Map<string, number>()
    const visiting = new Set<string>()

    const resolveOutputVoltageFromProps = (
      component: ComponentInstance | undefined,
    ) => {
      if (!component) return null
      const props = component.props as Record<string, unknown>
      return (
        numericProp(props, 'outputVoltage') ||
        numericProp(props, 'voltage') ||
        numericProp(props, 'operatingVoltage') ||
        numericProp(props, 'inputVoltage')
      )
    }

    const getOutputVoltage = (nodeId: string): number => {
      if (outputMemo.has(nodeId)) return outputMemo.get(nodeId) ?? DEFAULT_DC_V
      if (visiting.has(nodeId)) return DEFAULT_DC_V
      visiting.add(nodeId)

      const component = componentById.get(nodeId)
      const type = component ? typeById.get(component.typeId) : undefined
      const role = type?.nodeType

      let voltage: number | null = null
      if (role === 'distribution') {
        const sources = incomingByComponent.get(nodeId) ?? []
        if (sources.length > 0) {
          voltage = sources.reduce((max, sourceId) => Math.max(max, getOutputVoltage(sourceId)), 0)
        }
      }

      if (!voltage) {
        voltage = resolveOutputVoltageFromProps(component)
      }

      if (!voltage) {
        voltage = DEFAULT_DC_V
      }

      outputMemo.set(nodeId, voltage)
      visiting.delete(nodeId)
      return voltage
    }

    return { getOutputVoltage }
  })()

  const domainVoltage = new Map<string, number>()
  const portMeta = new Map<string, EdgeDomainMeta>()
  const batteryConversions = new Map<
    string,
    {
      converterId: string
      inputVoltage: number
      outputVoltage: number
      inputDomain: string
      outputDomain: string
      inPortId: string
      outPortId: string
      batteryPosPortId: string
    }
  >()

  const internalEdges: FlowEdge[] = []
  const nodes: BaseNode[] = []

  schema.components.forEach((component) => {
    const type = typeById.get(component.typeId)
    const nodeType = type?.nodeType ?? 'distribution'
    const fallbackVoltage = DEFAULT_DC_V
    const outputVoltage = resolveOutputVoltage(component, voltageResolver, fallbackVoltage)
    const isBattery = isBatteryType(type)
    const chargeVoltage = isBattery ? resolveBatteryChargeVoltage(component, outputVoltage) : outputVoltage
    const isSplitBattery = isBattery && chargeVoltage > outputVoltage + 0.5

    const ports: FlowPort[] = (type?.ports ?? []).map((port) => {
      const dir = port.direction
      const isIn = dir === 'in'
      const portVoltage = isSplitBattery
        ? outputVoltage
        : isIn
          ? resolveInputVoltage(component, outputVoltage)
          : outputVoltage

      const normalizedVoltage =
        port.domain === 'ac'
          ? normalizeVoltage(portVoltage || DEFAULT_AC_V, 'ac')
          : normalizeVoltage(portVoltage || fallbackVoltage, 'dc')
      const domain = formatDomain(port.domain, normalizedVoltage)
      const conductor = port.conductor

      domainVoltage.set(domain, normalizedVoltage)
      portMeta.set(`${component.id}:${port.id}`, { domain, voltage: normalizedVoltage })

      return {
        id: port.id,
        domain,
        conductor,
        dir,
      }
    })

    nodes.push({
      id: component.id,
      type: nodeType,
      ports,
      params: buildNodeParams(component, nodeType, outputVoltage),
    })

    if (isSplitBattery) {
      const converterId = `__battery_converter_${component.id}`
      const inputVoltageNorm = normalizeVoltage(chargeVoltage, 'dc')
      const outputVoltageNorm = normalizeVoltage(outputVoltage, 'dc')
      const inputDomain = formatDomain('dc', chargeVoltage)
      const outputDomain = formatDomain('dc', outputVoltage)
      const batteryPosPortId = pickBatteryPosPortId(type?.ports ?? []) ?? ports[0]?.id
      if (!batteryPosPortId) return

      const maxChargeA = resolveBatteryChargeCurrentA(component)
      const hasIncomingCable = schema.cables.some((cable) => cable.targetId === component.id)
      const chargeDemandA =
        maxChargeA && maxChargeA > 0 && hasIncomingCable ? maxChargeA : undefined

      const converterPorts: FlowPort[] = [
        { id: 'in', domain: inputDomain, conductor: 'POS', dir: 'in' },
        { id: 'out', domain: outputDomain, conductor: 'POS', dir: 'out' },
      ]

      nodes.push({
        id: converterId,
        type: 'conversion',
        ports: converterPorts,
        params: {
          efficiency: 0.96,
          maxOutA: maxChargeA ?? undefined,
          chargeDemandA,
        },
      })

      domainVoltage.set(inputDomain, inputVoltageNorm)
      domainVoltage.set(outputDomain, outputVoltageNorm)
      portMeta.set(`${converterId}:in`, { domain: inputDomain, voltage: inputVoltageNorm })
      portMeta.set(`${converterId}:out`, { domain: outputDomain, voltage: outputVoltageNorm })

      batteryConversions.set(component.id, {
        converterId,
        inputVoltage: chargeVoltage,
        outputVoltage,
        inputDomain,
        outputDomain,
        inPortId: 'in',
        outPortId: 'out',
        batteryPosPortId,
      })

      internalEdges.push({
        id: `__internal_${component.id}_charge`,
        from: { nodeId: converterId, portId: 'out' },
        to: { nodeId: component.id, portId: batteryPosPortId },
        wire: maxChargeA ? { maxA: maxChargeA } : undefined,
      })
    }
  })

  const edgeMeta = new Map<string, EdgeDomainMeta>()

  const edges: FlowEdge[] = schema.cables
    .map((cable) => {
      if (!cable.sourcePortId || !cable.targetPortId) return null
      if (!componentById.has(cable.sourceId) || !componentById.has(cable.targetId)) return null

      const sourceConv = batteryConversions.get(cable.sourceId)
      const targetConv = batteryConversions.get(cable.targetId)

      let fromNodeId = cable.sourceId
      let fromPortId = cable.sourcePortId
      let toNodeId = cable.targetId
      let toPortId = cable.targetPortId

      if (sourceConv) {
        const otherVoltage = voltageResolver.getOutputVoltage(cable.targetId)
        if (otherVoltage > sourceConv.outputVoltage + 0.5) {
          fromNodeId = sourceConv.converterId
          fromPortId = sourceConv.inPortId
        }
      }

      if (targetConv) {
        const otherVoltage = voltageResolver.getOutputVoltage(cable.sourceId)
        if (otherVoltage > targetConv.outputVoltage + 0.5) {
          toNodeId = targetConv.converterId
          toPortId = targetConv.inPortId
        }
      }

      const fromKey = `${fromNodeId}:${fromPortId}`
      const domainInfo = portMeta.get(fromKey)
      if (domainInfo) {
        edgeMeta.set(cable.id, domainInfo)
      } else {
        const toKey = `${toNodeId}:${toPortId}`
        const fallback = portMeta.get(toKey)
        if (fallback) edgeMeta.set(cable.id, fallback)
      }

      return {
        id: cable.id,
        from: { nodeId: fromNodeId, portId: fromPortId },
        to: { nodeId: toNodeId, portId: toPortId },
        wire: {
          lengthM: cable.props.lengthM,
          maxA: estimateAmpacityForAwg(cable.props.gaugeAwg),
        },
      }
    })
    .filter(Boolean) as FlowEdge[]

  edges.push(...internalEdges)

  const graph: GraphInput = { nodes, edges }

  const scenario: ScenarioInput = {
    enabledNodes: { ...(schema.scenario?.enabledNodes ?? {}) },
    dispatchPolicy: schema.scenario?.dispatchPolicy ?? 'priority_order',
    sourcePriority: schema.scenario?.sourcePriority ?? [],
    domainVoltage: {
      ...Object.fromEntries(domainVoltage),
      ...(schema.scenario?.domainVoltage ?? {}),
      ...(scenarioOverride?.domainVoltage ?? {}),
    },
    ...scenarioOverride,
  }

  if (batteryConversions.size > 0) {
    const enabledNodes = { ...(scenario.enabledNodes ?? {}) }
    batteryConversions.forEach((info, batteryId) => {
      if (enabledNodes[batteryId] === false) {
        enabledNodes[info.converterId] = false
      }
    })
    scenario.enabledNodes = enabledNodes
  }

  if (!scenario.sourcePriority || scenario.sourcePriority.length === 0) {
    scenario.sourcePriority = nodes.filter((node) => node.type === 'source').map((node) => node.id)
  }

  const graphEngine = new GraphEngine(graph)
  const flow = computeFlow({ graph: graphEngine.getSnapshot(), scenario })
  return { graph, flow, edgeMeta }
}

export const computeEdgePower = (
  cable: Cable,
  flow: FlowOutput | null,
  edgeMeta: Map<string, EdgeDomainMeta>,
) => {
  const edgeFlow = flow?.edges?.[cable.id]
  const currentA = edgeFlow ? Math.abs(edgeFlow.currentA) : 0
  const meta = edgeMeta.get(cable.id)
  const voltage = meta?.voltage ?? 0
  return {
    expectedCurrentA: currentA,
    expectedPowerW: voltage * currentA,
    circuitVoltageV: voltage,
  }
}
