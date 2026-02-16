import { defineStore } from 'pinia'
import { computeCableDerived, estimateAmpacityForAwg } from '~/services/cable'
import { computeFlow } from '~/services/flow-engine'
import { componentRegistry } from '~/src/domain/components/registry'
import { getHistoryDepth, loadSchema, saveSchema, undoSchema } from '~/services/storage'
import type { FlowOutput, ScenarioInput, Port,
  Cable,
  CableDerived,
  CableWire,
  ComponentInstance,
  ComponentType,
  Issue,
  SchemaState } from '~/types/schema'

const nowIso = () => new Date().toISOString()
const SAVE_DEBOUNCE_MS = 500
let saveTimer: ReturnType<typeof setTimeout> | null = null

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`

const defaultScenario = (): ScenarioInput => ({
  enabledNodes: {},
  dispatchPolicy: 'priority_order',
  sourcePriority: [],
})

const emptyDerived: CableDerived = {
  ampacityA: 0,
  expectedCurrentA: 0,
  expectedPowerW: 0,
  circuitVoltageV: 0,
  resistanceOhmPerM: 0,
  loopResistanceOhm: 0,
  voltageDropV: 0,
}

const buildPortsFromType = (type: ComponentType | undefined): (Port & { label?: string })[] => {
  if (!type) return []
  return type.ports.map((port) => ({
    id: port.id,
    domain: port.domain,
    conductor: port.conductor,
    dir: port.direction,
    label: port.label,
  }))
}

const ensureWireAmpacity = (wire: CableWire): CableWire => {
  if (typeof wire.gaugeAwg === 'number') {
    return { ...wire, maxA: estimateAmpacityForAwg(wire.gaugeAwg) }
  }
  return wire
}

const normalizeSchema = (schema: SchemaState): SchemaState => {
  return {
    ...schema,
    scenario: schema.scenario ?? defaultScenario(),
    updatedAt: schema.updatedAt ?? nowIso(),
  }
}

const parseVoltageFromDomain = (domain?: string) => {
  if (!domain) return 12
  const match = domain.match(/(\d+(?:\.\d+)?)V$/i)
  if (match) return Number(match[1])
  const lower = domain.toLowerCase()
  if (lower.includes('ac')) return 230
  if (lower.includes('dc')) return 12
  return 12
}

const resolveVoltageForDomain = (domain: string | undefined, scenario: ScenarioInput) => {
  if (!domain) return 12
  const scenarioVoltage = scenario.domainVoltage?.[domain]
  if (typeof scenarioVoltage === 'number' && scenarioVoltage > 0) return scenarioVoltage
  return parseVoltageFromDomain(domain)
}

const buildPortIndex = (components: ComponentInstance[]) => {
  const portByKey = new Map<string, Port>()
  components.forEach((component) => {
    component.ports.forEach((port) => {
      portByKey.set(`${component.id}:${port.id}`, port)
    })
  })
  return portByKey
}

const resolveCableDomain = (cable: Cable, portByKey: Map<string, Port>) => {
  const fromPort = portByKey.get(`${cable.from.nodeId}:${cable.from.portId}`)
  const toPort = portByKey.get(`${cable.to.nodeId}:${cable.to.portId}`)
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

const applyDerivedAll = (
  schema: SchemaState,
): { schema: SchemaState; flow: FlowOutput | null } => {
  const normalized = normalizeSchema(schema)
  const scenario = normalized.scenario ?? defaultScenario()
  let flow: FlowOutput | null = null

  try {
    flow = computeFlow({
      graph: { nodes: normalized.components, edges: normalized.cables },
      scenario,
    })
  } catch (error) {
    console.error('Flow engine failed to compute flow', error)
  }

  const portByKey = buildPortIndex(normalized.components)
  const cables = normalized.cables.map((cable) => buildCable(cable, flow, portByKey, scenario))

  return {
    schema: { ...normalized, cables },
    flow,
  }
}

const defaultSchema = (registry: ComponentType[]): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  const batteryType = typeById.get('battery')
  const fuseType = typeById.get('fuse')

  const battery: ComponentInstance = {
    id: 'comp-1',
    typeId: 'battery',
    type: batteryType?.type ?? 'battery',
    name: 'Main Battery',
    position: { x: 140, y: 140 },
    params: { ...(batteryType?.defaultParams ?? {}) },
    ports: buildPortsFromType(batteryType),
  }

  const fuse: ComponentInstance = {
    id: 'comp-2',
    typeId: 'fuse',
    type: fuseType?.type ?? 'distribution',
    name: 'Main Fuse',
    position: { x: 360, y: 140 },
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

const emptySchema = (): SchemaState => ({
  components: [],
  cables: [],
  selection: {},
  scenario: defaultScenario(),
  updatedAt: nowIso(),
})

const flowDiagnosticsToIssues = (flow: FlowOutput | null): Issue[] => {
  if (!flow) return []
  return flow.diagnostics.flatMap((diagnostic, index) => {
    const ref = diagnostic.refs?.find((item) => item.edgeId || item.nodeId)
    if (!ref) return []
    const targetId = (ref.edgeId ?? ref.nodeId) as string
    const targetType = ref.edgeId ? 'cable' : 'component'

    return [
      {
        id: `flow-${diagnostic.code}-${targetId}-${index}`,
        level:
          diagnostic.severity === 'error'
            ? 'error'
            : diagnostic.severity === 'warning'
              ? 'warning'
              : 'info',
        message: diagnostic.message,
        targetType,
        targetId,
        category: 'Flow',
      },
    ]
  })
}

const hydrateSchema = (registry: ComponentType[]) => {
  const saved = loadSchema()
  const base = saved ?? defaultSchema(registry)
  return applyDerivedAll(base)
}

export const useSchemaStore = defineStore('schema', {
  state: () => {
    const { schema, flow } = hydrateSchema(componentRegistry)
    return {
      schema,
      flow,
      issues: flowDiagnosticsToIssues(flow),
      registry: componentRegistry,
      historyDepth: getHistoryDepth(),
    }
  },
  getters: {
    selectedComponent(state) {
      return state.schema.components.find(
        (component) => component.id === state.schema.selection.componentId,
      )
    },
    selectedCable(state) {
      return state.schema.cables.find((cable) => cable.id === state.schema.selection.cableId)
    },
    isComponentEnabled: (state) => (id: string) =>
      state.schema.scenario?.enabledNodes?.[id] !== false,
  },
  actions: {
    addComponentFromType(typeId: string, position?: { x: number; y: number }) {
      const type = this.registry.find((item) => item.id === typeId)
      if (!type) return

      const sameTypeCount = this.schema.components.filter(
        (component) => component.typeId === typeId,
      ).length

      this.addComponent({
        id: makeId('comp'),
        typeId,
        type: type.type,
        name: `${type.label} ${sameTypeCount + 1}`,
        position: position ?? { x: 160 + sameTypeCount * 40, y: 220 + sameTypeCount * 30 },
        params: { ...type.defaultParams },
        ports: buildPortsFromType(type),
      })
    },
    refreshValidation() {
      const { schema, flow } = applyDerivedAll(this.schema, this.registry)
      this.schema = schema
      this.flow = flow
      this.issues = flowDiagnosticsToIssues(flow)
      this.scheduleSave()
    },
    reset() {
      const { schema, flow } = applyDerivedAll(defaultSchema(this.registry), this.registry)
      this.schema = schema
      this.flow = flow
      this.issues = flowDiagnosticsToIssues(flow)
      this.scheduleSave()
    },
    clearSchema() {
      const { schema, flow } = applyDerivedAll(emptySchema(), this.registry)
      this.schema = schema
      this.flow = flow
      this.issues = flowDiagnosticsToIssues(flow)
      this.scheduleSave()
    },
    undo() {
      const previous = undoSchema()
      if (!previous) return false
      const { schema, flow } = applyDerivedAll(previous, this.registry)
      this.schema = schema
      this.flow = flow
      this.issues = flowDiagnosticsToIssues(flow)
      this.historyDepth = getHistoryDepth()
      return true
    },
    setComponentEnabled(id: string, enabled: boolean) {
      const scenario = this.schema.scenario ?? defaultScenario()
      const existing = scenario.enabledNodes ?? {}
      const enabledNodes = enabled
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== id))
        : { ...existing, [id]: false }

      this.schema.scenario = { ...scenario, enabledNodes }
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    swapCableDirection(id: string) {
      const cable = this.schema.cables.find((item) => item.id === id)
      if (!cable) return
      this.updateCable(id, {
        from: cable.to,
        to: cable.from,
      })
    },
    setSelection(payload: { componentId?: string; cableId?: string }) {
      this.schema.selection = payload
    },
    addComponent(instance: ComponentInstance) {
      this.schema.components.push(instance)
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    updateComponent(id: string, props: Partial<ComponentInstance>) {
      const idx = this.schema.components.findIndex((component) => component.id === id)
      if (idx === -1) return
      this.schema.components[idx] = { ...this.schema.components[idx], ...props }
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    addCable(cable: Cable) {
      this.schema.cables.push(cable)
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    updateCable(id: string, props: Partial<Cable>) {
      const idx = this.schema.cables.findIndex((cable) => cable.id === id)
      if (idx === -1) return
      const next = { ...this.schema.cables[idx], ...props }
      this.schema.cables[idx] = next
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    removeComponent(id: string) {
      const wasSelected = this.schema.selection.componentId === id
      this.schema.components = this.schema.components.filter((component) => component.id !== id)
      this.schema.cables = this.schema.cables.filter(
        (cable) => cable.from.nodeId !== id && cable.to.nodeId !== id,
      )
      if (wasSelected) this.schema.selection = {}
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    removeCable(id: string) {
      const wasSelected = this.schema.selection.cableId === id
      this.schema.cables = this.schema.cables.filter((cable) => cable.id !== id)
      if (wasSelected) this.schema.selection = {}
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    loadFromStorage() {
      const saved = loadSchema()
      this.historyDepth = getHistoryDepth()
      if (!saved) return false
      const { schema, flow } = applyDerivedAll(saved, this.registry)
      this.schema = schema
      this.flow = flow
      this.issues = flowDiagnosticsToIssues(flow)
      return true
    },
    saveNow() {
      saveSchema(this.schema)
      this.historyDepth = getHistoryDepth()
    },
    scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveSchema(this.schema)
        this.historyDepth = getHistoryDepth()
        saveTimer = null
      }, SAVE_DEBOUNCE_MS)
    },
    setIssues(issues: Issue[]) {
      this.issues = issues
    },
  },
})
