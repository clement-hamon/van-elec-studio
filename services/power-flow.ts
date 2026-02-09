import type { Cable, ComponentInstance, ComponentType, SchemaState } from '~/types/schema'
import { buildGraph } from '~/src/circuit-graph'
import {
  createVoltageResolver,
  resolveLoadVoltage,
  resolveVoltageRole,
  type VoltageRole,
} from '~/services/voltage'

type CablePowerInfo = {
  expectedPowerW: number
  circuitVoltageV: number
  expectedCurrentA: number
}

type NodePowerProfile = {
  demandW: number
  supplyW: number
  throughputCapW: number
  outputVoltageV: number
  inputVoltageV: number
  role: VoltageRole | null
}

const numericProp = (props: Record<string, unknown>, key: string) => {
  const value = props[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const INF = 1e9

const capOrInf = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return INF
  return value
}

const pickProp = (props: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = numericProp(props, key)
    if (value) return value
  }
  return null
}

const resolveBatteryChargeDemandPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
  inputVoltage: number,
): number => {
  if (!component || !type) return 0
  const props = component.props as Record<string, unknown>
  const maxCharge =
    pickProp(props, ['maxChargeCurrentA', 'recommendedChargeCurrentA']) ||
    (typeof component.derived?.maxCurrentA === 'number' ? component.derived.maxCurrentA : null) ||
    (typeof type.constraints?.maxCurrent === 'number' ? type.constraints.maxCurrent : null)
  if (!maxCharge) return 0
  return maxCharge * (inputVoltage > 0 ? inputVoltage : 12)
}

const resolveLoadDemandPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number => {
  if (!component || !type) return 0
  const isLoad = type.category === 'load' || type.energyRole === 'load'
  if (!isLoad) return 0

  const props = component.props as Record<string, unknown>
  const explicitCurrent = pickProp(props, ['currentA'])
  if (explicitCurrent) {
    const voltage = resolveLoadVoltage(component, type) ?? 12
    return explicitCurrent * voltage
  }

  const watt = pickProp(props, ['watt', 'powerW', 'continuousW'])
  if (watt) return watt

  return 0
}

const resolveConversionCapPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
  outputVoltage: number,
  inputVoltage: number,
): number | null => {
  if (!component || !type) return null
  const isConverter =
    type.category === 'conversion' ||
    type.energyRole === 'charger' ||
    type.chargePathRole === 'charger' ||
    type.chargePathRole === 'controller'
  if (!isConverter) return null

  const props = component.props as Record<string, unknown>
  const outputCurrent = pickProp(props, ['maxOutputCurrentA', 'maxCurrentA', 'ratedCurrentA'])
  const inputCurrent = pickProp(props, ['maxInputCurrentA'])
  const powerCap = pickProp(props, ['continuousW', 'powerW', 'watt'])

  const candidates: number[] = []
  if (outputCurrent) candidates.push(outputCurrent * (outputVoltage > 0 ? outputVoltage : 12))
  if (inputCurrent) candidates.push(inputCurrent * (inputVoltage > 0 ? inputVoltage : 12))
  if (powerCap) candidates.push(powerCap)

  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

const resolveDistributionCapPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
  outputVoltage: number,
): number | null => {
  if (!component || !type) return null
  const isDistribution =
    type.category === 'distribution' ||
    type.energyRole === 'distribution' ||
    type.energyRole === 'protection'
  if (!isDistribution) return null

  const props = component.props as Record<string, unknown>
  const currentLimit =
    pickProp(props, ['ratingA', 'maxCurrentA', 'maxOutputCurrentA']) ||
    (typeof component.derived?.maxCurrentA === 'number' ? component.derived.maxCurrentA : null) ||
    (typeof type.constraints?.maxCurrent === 'number' ? type.constraints.maxCurrent : null)

  if (!currentLimit) return null
  return currentLimit * (outputVoltage > 0 ? outputVoltage : 12)
}

const resolveSourceSupplyPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
  outputVoltage: number,
): number => {
  if (!component || !type) return 0
  const props = component.props as Record<string, unknown>
  const explicitCurrent = pickProp(props, [
    'currentA',
    'ratedCurrentA',
    'maxOutputCurrentA',
    'maxCurrentA',
  ])
  if (explicitCurrent) return explicitCurrent * (outputVoltage > 0 ? outputVoltage : 12)

  const watt = pickProp(props, ['watt', 'powerW', 'continuousW'])
  if (watt) return watt

  return 0
}

const resolveBatterySupplyPower = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
  outputVoltage: number,
): number => {
  if (!component || !type) return 0
  const props = component.props as Record<string, unknown>
  const current =
    pickProp(props, ['maxDischargeCurrentA', 'maxOutputCurrentA', 'maxCurrentA']) ||
    (typeof component.derived?.maxCurrentA === 'number' ? component.derived.maxCurrentA : null) ||
    (typeof type.constraints?.maxCurrent === 'number' ? type.constraints.maxCurrent : null)
  if (!current) return 0
  return current * (outputVoltage > 0 ? outputVoltage : 12)
}

class Dinic {
  private adj: { to: number; rev: number; cap: number }[][]

  constructor(private readonly n: number) {
    this.adj = Array.from({ length: n }, () => [])
  }

  addEdge(from: number, to: number, cap: number) {
    const forward = { to, rev: this.adj[to].length, cap }
    const backward = { to: from, rev: this.adj[from].length, cap: 0 }
    this.adj[from].push(forward)
    this.adj[to].push(backward)
    return forward
  }

  maxFlow(source: number, sink: number) {
    let flow = 0
    const level = new Array(this.n).fill(-1)
    const iter = new Array(this.n).fill(0)

    const bfs = () => {
      level.fill(-1)
      level[source] = 0
      const queue: number[] = [source]
      for (let i = 0; i < queue.length; i += 1) {
        const v = queue[i]
        this.adj[v].forEach((edge) => {
          if (edge.cap > 0 && level[edge.to] < 0) {
            level[edge.to] = level[v] + 1
            queue.push(edge.to)
          }
        })
      }
      return level[sink] >= 0
    }

    const dfs = (v: number, upTo: number): number => {
      if (v === sink) return upTo
      for (let i = iter[v]; i < this.adj[v].length; i += 1) {
        iter[v] = i
        const edge = this.adj[v][i]
        if (edge.cap <= 0 || level[v] + 1 !== level[edge.to]) continue
        const d = dfs(edge.to, Math.min(upTo, edge.cap))
        if (d > 0) {
          edge.cap -= d
          this.adj[edge.to][edge.rev].cap += d
          return d
        }
      }
      return 0
    }

    while (bfs()) {
      iter.fill(0)
      let f = dfs(source, INF)
      while (f > 0) {
        flow += f
        f = dfs(source, INF)
      }
    }

    return flow
  }
}

const buildNodeProfiles = (
  graph: ReturnType<typeof buildGraph>,
  voltageResolver: ReturnType<typeof createVoltageResolver>,
): Map<string, NodePowerProfile> => {
  const typeById = graph.typesById

  const profiles = new Map<string, NodePowerProfile>()

  graph.nodes.forEach((component) => {
    const type = typeById.get(component.typeId)
    const role = resolveVoltageRole(type)
    const outputVoltageV = voltageResolver.getOutputVoltage(component.id)
    const inputVoltageV = voltageResolver.getMaxInputVoltage(component.id) ?? outputVoltageV
    const isRoot = (graph.incoming.get(component.id) ?? []).length === 0

    const demandW =
      role === 'load'
        ? resolveLoadDemandPower(component, type)
        : role === 'storage'
          ? resolveBatteryChargeDemandPower(component, type, inputVoltageV)
          : 0

    const explicitSupplyW =
      role === 'source'
        ? resolveSourceSupplyPower(component, type, outputVoltageV)
        : role === 'storage'
          ? resolveBatterySupplyPower(component, type, outputVoltageV)
          : 0

    const supplyW = explicitSupplyW > 0 ? explicitSupplyW : isRoot ? INF : 0

    let throughputCapW = INF
    if (role === 'conversion') {
      throughputCapW = capOrInf(
        resolveConversionCapPower(component, type, outputVoltageV, inputVoltageV),
      )
    } else if (role === 'distribution') {
      throughputCapW = capOrInf(resolveDistributionCapPower(component, type, outputVoltageV))
    }

    profiles.set(component.id, {
      demandW,
      supplyW,
      throughputCapW,
      outputVoltageV,
      inputVoltageV,
      role,
    })
  })

  return profiles
}

export const computeCablePower = (
  schema: SchemaState,
  registry: ComponentType[],
): Map<string, CablePowerInfo> => {
  const graph = buildGraph(schema, registry)
  const voltageResolver = createVoltageResolver(graph)
  const profiles = buildNodeProfiles(graph, voltageResolver)

  const nodeIds = graph.nodes.map((node) => node.id)
  const nodeIndex = new Map(nodeIds.map((id, idx) => [id, idx]))
  const nodeCount = nodeIds.length
  const inNode = (idx: number) => idx * 2
  const outNode = (idx: number) => idx * 2 + 1
  const superSource = nodeCount * 2
  const superSink = nodeCount * 2 + 1
  const dinic = new Dinic(nodeCount * 2 + 2)

  const edgeByCableId = new Map<
    string,
    { edge: { to: number; rev: number; cap: number }; capacity: number }
  >()

  nodeIds.forEach((id, idx) => {
    const profile = profiles.get(id)
    const throughputCap = profile?.throughputCapW ?? INF
    dinic.addEdge(inNode(idx), outNode(idx), throughputCap)

    const supply = profile?.supplyW ?? 0
    if (supply > 0) {
      const supplyNode = profile?.role === 'storage' ? outNode(idx) : inNode(idx)
      dinic.addEdge(superSource, supplyNode, supply)
    }

    const demand = profile?.demandW ?? 0
    if (demand > 0) {
      const demandNode = profile?.role === 'storage' ? inNode(idx) : outNode(idx)
      dinic.addEdge(demandNode, superSink, demand)
    }
  })

  graph.edges.forEach((cable) => {
    const sourceIdx = nodeIndex.get(cable.sourceId)
    const targetIdx = nodeIndex.get(cable.targetId)
    if (sourceIdx === undefined || targetIdx === undefined) return
    const capacity = INF
    const edge = dinic.addEdge(outNode(sourceIdx), inNode(targetIdx), capacity)
    edgeByCableId.set(cable.id, { edge, capacity })
  })

  dinic.maxFlow(superSource, superSink)

  const result = new Map<string, CablePowerInfo>()

  schema.cables.forEach((cable: Cable) => {
    const edgeRef = edgeByCableId.get(cable.id)
    const usedPower = edgeRef ? Math.max(0, edgeRef.capacity - edgeRef.edge.cap) : 0
    const circuitVoltage =
      profiles.get(cable.sourceId)?.outputVoltageV ?? voltageResolver.getOutputVoltage(cable.sourceId)
    const expectedCurrent = circuitVoltage > 0 ? usedPower / circuitVoltage : 0
    const expectedPower = usedPower

    result.set(cable.id, {
      expectedPowerW: expectedPower,
      circuitVoltageV: circuitVoltage,
      expectedCurrentA: expectedCurrent,
    })
  })

  return result
}
