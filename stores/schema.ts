import { defineStore } from 'pinia'
import { applyDerivedAll, defaultSchema, emptySchema } from '~/services/schema/derivation'
import { flowDiagnosticsToIssues } from '~/services/schema/issues'
import { defaultImageScaleRatio, normalizeScenario, nowIso } from '~/services/schema/normalize'
import { buildPortsFromType } from '~/src/domain/components/ports'
import { componentRegistry } from '~/src/domain/components/registry'
import { getHistoryDepth, loadSchema, saveSchema, undoSchema } from '~/services/storage'
import type { Cable, ComponentInstance, ComponentType, CurrentComputationMode, Issue } from '~/types/schema'

const SAVE_DEBOUNCE_MS = 500
let saveTimer: ReturnType<typeof setTimeout> | null = null

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`

const hydrateSchema = (registry: ComponentType[]) => {
  const saved = loadSchema()
  const base = saved ?? defaultSchema(registry)
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
        type: type.type,
        name: `${type.label} ${sameTypeCount + 1}`,
        position: position ?? { x: 160 + sameTypeCount * 40, y: 220 + sameTypeCount * 30 },
        imageScaleRatio: defaultImageScaleRatio(typeId),
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
      const scenario = normalizeScenario(this.schema.scenario)
      const existing = scenario.enabledNodes ?? {}
      const enabledNodes = enabled
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== id))
        : { ...existing, [id]: false }

      this.schema.scenario = { ...scenario, enabledNodes }
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    setCurrentComputationMode(mode: CurrentComputationMode) {
      const scenario = normalizeScenario(this.schema.scenario)
      this.schema.scenario = { ...scenario, currentComputationMode: mode }
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    setAutoCableGauge(enabled: boolean) {
      const scenario = normalizeScenario(this.schema.scenario)
      this.schema.scenario = { ...scenario, autoCableGauge: enabled }
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    setSelection(payload: { componentId?: string; cableId?: string }) {
      this.schema.selection = payload
    },
    addComponent(instance: ComponentInstance) {
      this.schema.components.push({
        ...instance,
        imageScaleRatio:
          typeof instance.imageScaleRatio === 'number'
            ? instance.imageScaleRatio
            : defaultImageScaleRatio(instance.typeId),
      })
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
