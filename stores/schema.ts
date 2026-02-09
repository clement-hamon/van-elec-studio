import { defineStore } from 'pinia'
import { computeCableDerived } from '~/services/cable'
import { computeCablePower } from '~/services/power-flow'
import { runValidation } from '~/services/validation'
import { computeChargeSummary } from '~/services/charging'
import { componentRegistry } from '~/src/domain/components/registry'
import { getHistoryDepth, loadSchema, saveSchema, undoSchema } from '~/services/storage'
import type {
  Cable,
  ComponentInstance,
  ComponentType,
  Group,
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

const applyCableDerived = (schema: SchemaState, registry: ComponentType[]): SchemaState => {
  const powerMap = computeCablePower(schema, registry)

  return {
    ...schema,
    cables: schema.cables.map((cable) => buildCable(cable, powerMap.get(cable.id))),
  }
}

const applyComponentDerived = (schema: SchemaState, registry: ComponentType[]): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  return {
    ...schema,
    components: schema.components.map((component) => {
      const type = typeById.get(component.typeId)
      if (!type) return component
      const derived = { ...component.derived }
      if (
        typeof derived.maxCurrentA !== 'number' &&
        typeof type.constraints?.maxCurrent === 'number'
      ) {
        derived.maxCurrentA = type.constraints.maxCurrent
      }
      if (!derived.voltageDomain && type.constraints?.voltageDomain) {
        derived.voltageDomain = type.constraints.voltageDomain
      }
      return { ...component, derived }
    }),
  }
}

const applyDefaultProps = (schema: SchemaState, registry: ComponentType[]): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  return {
    ...schema,
    components: schema.components.map((component) => {
      const type = typeById.get(component.typeId)
      if (!type) return component
      const props = { ...component.props }
      const isBattery = type.chargePathRole === 'battery' || type.id === 'battery'
      if (isBattery) {
        if (props.outputVoltage === undefined || props.outputVoltage === null) {
          if (typeof props.voltage === 'number') {
            props.outputVoltage = props.voltage
          } else if (typeof props.operatingVoltage === 'number') {
            props.outputVoltage = props.operatingVoltage
          }
        }
        if (props.maxInputVoltage === undefined || props.maxInputVoltage === null) {
          if (typeof props.chargeCutoffVoltage === 'number') {
            props.maxInputVoltage = props.chargeCutoffVoltage
          } else if (typeof props.recommendedChargeVoltage === 'number') {
            props.maxInputVoltage = props.recommendedChargeVoltage
          }
        }
        if ('voltage' in props) {
          delete props.voltage
        }
        if ('operatingVoltage' in props) {
          delete props.operatingVoltage
        }
      }
      Object.entries(type.defaultProps).forEach(([key, value]) => {
        if (props[key] === undefined || props[key] === null) {
          props[key] = value
        }
      })
      return { ...component, props }
    }),
  }
}

const applyChargingDerived = (schema: SchemaState, registry: ComponentType[]): SchemaState => {
  const summaries = computeChargeSummary(schema, registry)
  if (summaries.size === 0) return schema

  return {
    ...schema,
    components: schema.components.map((component) => {
      const summary = summaries.get(component.id)
      if (!summary) return component
      return {
        ...component,
        derived: {
          ...component.derived,
          chargeAvailableA: summary.availableCurrentA,
          chargeEffectiveA: summary.effectiveCurrentA,
          timeToFullH: summary.timeToFullHours ?? 'n/a',
        },
      }
    }),
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
      derived: { maxCurrentA: 200, voltageDomain: '12V' },
    },
    {
      id: 'comp-2',
      typeId: 'fuse',
      name: 'Main Fuse',
      position: { x: 360, y: 140 },
      props: { ratingA: 60, operatingVoltage: 32 },
      derived: { maxCurrentA: 120, voltageDomain: '12V' },
    },
  ],
  cables: [
    {
      id: 'cable-1',
      name: 'Main Feed',
      sourceId: 'comp-1',
      targetId: 'comp-2',
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
  groups: [],
  selection: {},
  updatedAt: nowIso(),
})

const emptySchema = (): SchemaState => ({
  components: [],
  cables: [],
  groups: [],
  selection: {},
  updatedAt: nowIso(),
})

const applyDerivedAll = (schema: SchemaState, registry: ComponentType[]) =>
  applyChargingDerived(
    applyCableDerived(applyComponentDerived(schema, registry), registry),
    registry,
  )

const hydrateSchema = (registry: ComponentType[]) => {
  const saved = loadSchema()
  const base = saved ?? defaultSchema()
  return applyDerivedAll(applyDefaultProps(base, registry), registry)
}

export const useSchemaStore = defineStore('schema', {
  state: () => {
    const schema = hydrateSchema(componentRegistry)
    return {
      schema,
      issues: runValidation(schema, componentRegistry),
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
  },
  actions: {
    addComponentFromType(typeId: string, position?: { x: number; y: number }) {
      const type = this.registry.find((item) => item.id === typeId)
      if (!type) return

      const sameTypeCount = this.schema.components.filter(
        (component) => component.typeId === typeId,
      ).length

      const derived: Record<string, number | string | boolean> = {
        maxCurrentA: type.constraints?.maxCurrent ?? 0,
      }

      if (type.constraints?.voltageDomain) {
        derived.voltageDomain = type.constraints.voltageDomain
      }

      this.addComponent({
        id: makeId('comp'),
        typeId,
        name: `${type.label} ${sameTypeCount + 1}`,
        position: position ?? { x: 160 + sameTypeCount * 40, y: 220 + sameTypeCount * 30 },
        props: { ...type.defaultProps },
        derived,
      })
    },
    refreshValidation() {
      this.schema = applyDerivedAll(this.schema, this.registry)
      this.issues = runValidation(this.schema, this.registry)
      this.scheduleSave()
    },
    reset() {
      this.schema = applyDerivedAll(defaultSchema(), this.registry)
      this.refreshValidation()
    },
    clearSchema() {
      this.schema = applyDerivedAll(emptySchema(), this.registry)
      this.refreshValidation()
    },
    undo() {
      const previous = undoSchema()
      if (!previous) return false
      this.schema = applyDerivedAll(previous, this.registry)
      this.issues = runValidation(this.schema, this.registry)
      this.historyDepth = getHistoryDepth()
      return true
    },
    setSelection(payload: { componentId?: string; cableId?: string; groupId?: string }) {
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
      this.schema.groups = this.schema.groups.map((group) => ({
        ...group,
        children: group.children.filter((childId) => childId !== id),
      }))
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
    addGroup(group: Group) {
      this.schema.groups.push(group)
      this.schema.updatedAt = nowIso()
      this.refreshValidation()
    },
    loadFromStorage() {
      const saved = loadSchema()
      this.historyDepth = getHistoryDepth()
      if (!saved) return false
      this.schema = applyDerivedAll(saved, this.registry)
      this.issues = runValidation(this.schema, this.registry)
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
