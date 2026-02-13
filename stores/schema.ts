import { defineStore } from 'pinia'
import { computeCableDerived } from '~/services/cable'
import { computeEdgePower, computeFlowForSchema, ensureCablePorts } from '~/services/graph-flow'
import type { FlowOutput } from '~/services/flow-engine'
import { componentRegistry } from '~/src/domain/components/registry'
import { getHistoryDepth, loadSchema, saveSchema, undoSchema } from '~/services/storage'
import type {
  Cable,
  ComponentInstance,
  ComponentType,
  Issue,
  SchemaState,
} from '~/types/schema'

const nowIso = () => new Date().toISOString()
const SAVE_DEBOUNCE_MS = 500
let saveTimer: ReturnType<typeof setTimeout> | null = null

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`

const buildCable = (
  cable: Cable,
  powerInfo?: { expectedCurrentA: number; expectedPowerW: number; circuitVoltageV: number },
): Cable => ({
  ...cable,
  derived: computeCableDerived(
    cable.props,
    powerInfo?.expectedCurrentA ?? 0,
    powerInfo?.expectedPowerW ?? 0,
    powerInfo?.circuitVoltageV ?? 0,
  ),
})

const applyCableDerived = (
  schema: SchemaState,
  registry: ComponentType[],
): { schema: SchemaState; flow: FlowOutput | null } => {
  try {
    const { flow, edgeMeta } = computeFlowForSchema(schema, registry)
    return {
      schema: {
        ...schema,
        cables: schema.cables.map((cable) => buildCable(cable, computeEdgePower(cable, flow, edgeMeta))),
      },
      flow,
    }
  } catch (error) {
    console.error('Flow engine failed to compute flow', error)
    return {
      schema: {
        ...schema,
        cables: schema.cables.map((cable) => buildCable(cable)),
      },
      flow: null,
    }
  }
}

const defaultSchema = (): SchemaState => ({
  components: [
    {
      id: 'comp-1',
      typeId: 'battery',
      name: 'Main Battery',
      position: { x: 140, y: 140 },
      props: {
        outputVoltage: 12,
        maxInputVoltage: 14.6,
        capacityAh: 200,
        recommendedChargeCurrentA: 45,
        maxChargeCurrentA: 75,
      },
    },
    {
      id: 'comp-2',
      typeId: 'fuse',
      name: 'Main Fuse',
      position: { x: 360, y: 140 },
      props: { ratingA: 60, operatingVoltage: 32 },
    },
  ],
  cables: [
    {
      id: 'cable-1',
      name: 'Main Feed',
      sourceId: 'comp-1',
      targetId: 'comp-2',
      sourcePortId: 'positive',
      targetPortId: 'in',
      props: { lengthM: 2, gaugeAwg: 6 },
      derived: {
        ampacityA: 0,
        expectedCurrentA: 0,
        expectedPowerW: 0,
        circuitVoltageV: 0,
        resistanceOhmPerM: 0,
        loopResistanceOhm: 0,
        voltageDropV: 0,
      },
    },
  ],
  selection: {},
  scenario: {
    enabledNodes: {},
    dispatchPolicy: 'priority_order',
    sourcePriority: [],
  },
  updatedAt: nowIso(),
})

const emptySchema = (): SchemaState => ({
  components: [],
  cables: [],
  selection: {},
  scenario: {
    enabledNodes: {},
    dispatchPolicy: 'priority_order',
    sourcePriority: [],
  },
  updatedAt: nowIso(),
})

const applyDerivedAll = (
  schema: SchemaState,
  registry: ComponentType[],
): { schema: SchemaState; flow: FlowOutput | null } => {
  const withScenario =
    schema.scenario
      ? schema
      : {
          ...schema,
          scenario: {
            enabledNodes: {},
            dispatchPolicy: 'priority_order',
            sourcePriority: [],
          },
        }
  const withPorts = ensureCablePorts(withScenario, registry)
  const { schema: withCables, flow } = applyCableDerived(withPorts, registry)
  return { schema: withCables, flow }
}

const flowDiagnosticsToIssues = (flow: FlowOutput | null): Issue[] => {
  if (!flow) return []
  const issues: Issue[] = []
  flow.diagnostics.forEach((diagnostic, index) => {
    const ref = diagnostic.refs?.find((item) => item.edgeId || item.nodeId)
    if (!ref) return
    if (ref.edgeId && ref.edgeId.startsWith('__internal_')) return
    const rawId = (ref.edgeId ?? ref.nodeId) as string
    const targetId = rawId.startsWith('__battery_converter_')
      ? rawId.replace('__battery_converter_', '')
      : rawId
    const targetType = ref.edgeId ? 'cable' : 'component'
    issues.push({
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
    })
  })
  return issues
}

const hydrateSchema = (registry: ComponentType[]) => {
  const saved = loadSchema()
  const base = saved ?? defaultSchema()
  return applyDerivedAll(base, registry)
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
        name: `${type.label} ${sameTypeCount + 1}`,
        position: position ?? { x: 160 + sameTypeCount * 40, y: 220 + sameTypeCount * 30 },
        props: { ...type.defaultProps },
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
      const { schema, flow } = applyDerivedAll(defaultSchema(), this.registry)
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
      const scenario = this.schema.scenario ?? {
        enabledNodes: {},
        dispatchPolicy: 'priority_order',
        sourcePriority: [],
      }
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
        sourceId: cable.targetId,
        targetId: cable.sourceId,
        sourcePortId: cable.targetPortId,
        targetPortId: cable.sourcePortId,
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
        (cable) => cable.sourceId !== id && cable.targetId !== id,
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
