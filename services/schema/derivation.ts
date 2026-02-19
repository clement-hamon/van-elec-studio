import { computeCableDerived, estimateAmpacityForAwg, findRequiredAwgForCurrent } from '~/services/cable'
import { computeFlow } from '~/services/flow-engine'
import { resolveVoltageForDomain } from '~/services/flow/voltage-domain'
import { buildPortIndex, portKey } from '~/services/graph/indexes'
import { buildPortsFromType } from '~/src/domain/components/ports'
import type {
  Cable,
  CableDerived,
  CableWire,
  ComponentInstance,
  ComponentType,
  FlowOutput,
  Port,
  ScenarioInput,
  SchemaState,
} from '~/types/schema'
import { defaultImageScaleRatio, defaultScenario, normalizeScenario, normalizeSchema, nowIso } from './normalize'

const CABLE_SIZING_DESIGN_MARGIN = 1.25

export const emptyDerived: CableDerived = {
  ampacityA: 0,
  expectedCurrentA: 0,
  expectedPowerW: 0,
  circuitVoltageV: 0,
  resistanceOhmPerM: 0,
  loopResistanceOhm: 0,
  voltageDropV: 0,
}

export const ensureWireAmpacity = (wire: CableWire): CableWire => {
  if (typeof wire.gaugeAwg === 'number') {
    return { ...wire, maxA: estimateAmpacityForAwg(wire.gaugeAwg) }
  }
  return wire
}

const resolveCableDomain = (cable: Cable, portByKey: Map<string, Port>) => {
  const fromPort = portByKey.get(portKey(cable.from.nodeId, cable.from.portId))
  const toPort = portByKey.get(portKey(cable.to.nodeId, cable.to.portId))
  return fromPort?.domain ?? toPort?.domain
}

const buildCable = (
  cable: Cable,
  flow: FlowOutput | null,
  portByKey: Map<string, Port>,
  scenario: ScenarioInput,
): Cable => {
  const edgeFlow = flow?.edges[cable.id]
  const expectedCurrentA = edgeFlow ? Math.abs(edgeFlow.currentA) : 0
  const domain = resolveCableDomain(cable, portByKey)
  const circuitVoltageV = resolveVoltageForDomain(domain, scenario)
  const expectedPowerW = expectedCurrentA * circuitVoltageV
  const wire = ensureWireAmpacity(cable.wire)

  return {
    ...cable,
    wire,
    derived: computeCableDerived(wire, expectedCurrentA, expectedPowerW, circuitVoltageV),
  }
}

export const applyDerivedAll = (
  schema: SchemaState,
  registry: ComponentType[],
): { schema: SchemaState; flow: FlowOutput | null } => {
  const normalized = normalizeSchema(schema, registry)
  const scenario = normalizeScenario(normalized.scenario)
  const portByKey = buildPortIndex(normalized.components)
  let flow: FlowOutput | null = null

  try {
    flow = computeFlow({
      graph: { nodes: normalized.components, edges: normalized.cables },
      scenario,
    })
  } catch (error) {
    console.error('Flow engine failed to compute flow', error)
  }

  const shouldAutoGauge =
    scenario.currentComputationMode === 'cable_sizing' &&
    scenario.autoCableGauge === true &&
    flow !== null

  const cablesForDerivation = shouldAutoGauge
    ? normalized.cables.map((cable) => {
      const edgeFlow = flow?.edges[cable.id]
      const sizingCurrentA = edgeFlow ? Math.abs(edgeFlow.currentA) : 0
      // Continuous-load conductor sizing convention: 125% design current.
      const designCurrentA = sizingCurrentA * CABLE_SIZING_DESIGN_MARGIN
      const domain = resolveCableDomain(cable, portByKey)
      const circuitVoltageV = resolveVoltageForDomain(domain, scenario)
      const autoGaugeAwg = findRequiredAwgForCurrent(designCurrentA, {
        lengthM: cable.wire.lengthM,
        voltageV: circuitVoltageV,
      })
      return {
        ...cable,
        wire: ensureWireAmpacity({ ...cable.wire, gaugeAwg: autoGaugeAwg }),
      }
    })
    : normalized.cables

  const cables = cablesForDerivation.map((cable) => buildCable(cable, flow, portByKey, scenario))

  return {
    schema: { ...normalized, cables },
    flow,
  }
}

export const defaultSchema = (registry: ComponentType[]): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  const batteryType = typeById.get('battery')
  const fuseType = typeById.get('fuse')

  const battery: ComponentInstance = {
    id: 'comp-1',
    typeId: 'battery',
    type: batteryType?.type ?? 'battery',
    name: 'Main Battery',
    position: { x: 140, y: 140 },
    imageScaleRatio: defaultImageScaleRatio('battery'),
    params: { ...(batteryType?.defaultParams ?? {}) },
    ports: buildPortsFromType(batteryType),
  }

  const fuse: ComponentInstance = {
    id: 'comp-2',
    typeId: 'fuse',
    type: fuseType?.type ?? 'distribution',
    name: 'Main Fuse',
    position: { x: 360, y: 140 },
    imageScaleRatio: defaultImageScaleRatio('fuse'),
    params: { ...(fuseType?.defaultParams ?? {}) },
    ports: buildPortsFromType(fuseType),
  }

  const wire: CableWire = ensureWireAmpacity({ lengthM: 2, gaugeAwg: 6 })

  return {
    components: [battery, fuse],
    cables: [
      {
        id: 'cable-1',
        name: 'Main Feed',
        from: { nodeId: battery.id, portId: 'positive' },
        to: { nodeId: fuse.id, portId: 'in' },
        wire,
        derived: emptyDerived,
      },
    ],
    selection: {},
    scenario: defaultScenario(),
    updatedAt: nowIso(),
  }
}

export const emptySchema = (): SchemaState => ({
  components: [],
  cables: [],
  selection: {},
  scenario: defaultScenario(),
  updatedAt: nowIso(),
})
