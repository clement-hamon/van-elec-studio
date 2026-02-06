import { defineStore } from 'pinia'
import { computeCableDerived } from '~/services/cable'
import { computeCablePower } from '~/services/power-flow'
import { runValidation } from '~/services/validation'
import type {
  Cable,
  ComponentInstance,
  ComponentType,
  Group,
  Issue,
  SchemaState,
} from '~/types/schema'

const nowIso = () => new Date().toISOString()

const componentRegistry: ComponentType[] = [
  {
    id: 'battery',
    label: 'Battery',
    category: 'storage',
    defaultProps: { voltage: 12, capacityAh: 200 },
    ports: [
      { id: 'positive', label: '+', direction: 'out', domain: 'dc', maxCurrent: 200 },
      { id: 'negative', label: '-', direction: 'out', domain: 'dc', maxCurrent: 200 },
    ],
    constraints: { voltageDomain: '12V', maxCurrent: 200 },
  },
  {
    id: 'fuse',
    label: 'Fuse',
    category: 'distribution',
    defaultProps: { ratingA: 60 },
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', maxCurrent: 120 },
      { id: 'out', label: 'Out', direction: 'out', domain: 'dc', maxCurrent: 120 },
    ],
    constraints: { voltageDomain: '12V', maxCurrent: 120 },
  },
  {
    id: 'inverter',
    label: 'Inverter',
    category: 'conversion',
    defaultProps: { inputVoltage: 12, outputVoltage: 230, continuousW: 1000 },
    ports: [
      { id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', maxCurrent: 120 },
      { id: 'ac-out', label: 'AC Out', direction: 'out', domain: 'ac', maxCurrent: 10 },
    ],
    constraints: { voltageDomain: '12V', maxCurrent: 120 },
  },
  {
    id: 'led-light',
    label: 'LED Light',
    category: 'load',
    defaultProps: { voltage: 12, watt: 6, lumens: 500 },
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', maxCurrent: 2 }],
    constraints: { voltageDomain: '12V', maxCurrent: 2 },
  },
  {
    id: 'light-bar',
    label: 'Light Bar',
    category: 'load',
    defaultProps: { voltage: 12, watt: 36, lumens: 3000 },
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', maxCurrent: 5 }],
    constraints: { voltageDomain: '12V', maxCurrent: 5 },
  },
  {
    id: 'dc-bus',
    label: 'DC Bus',
    category: 'distribution',
    defaultProps: { voltage: 12, maxBranches: 4 },
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', maxCurrent: 200 },
      { id: 'out-1', label: 'Out 1', direction: 'out', domain: 'dc', maxCurrent: 50 },
      { id: 'out-2', label: 'Out 2', direction: 'out', domain: 'dc', maxCurrent: 50 },
      { id: 'out-3', label: 'Out 3', direction: 'out', domain: 'dc', maxCurrent: 50 },
      { id: 'out-4', label: 'Out 4', direction: 'out', domain: 'dc', maxCurrent: 50 },
    ],
    constraints: { voltageDomain: '12V', maxCurrent: 200 },
  },
]

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

const defaultSchema = (): SchemaState => ({
  components: [
    {
      id: 'comp-1',
      typeId: 'battery',
      name: 'House Battery',
      position: { x: 140, y: 140 },
      props: { voltage: 12, capacityAh: 200 },
      derived: { maxCurrentA: 200, voltageDomain: '12V' },
    },
    {
      id: 'comp-2',
      typeId: 'fuse',
      name: 'Main Fuse',
      position: { x: 360, y: 140 },
      props: { ratingA: 60 },
      derived: { maxCurrentA: 120, voltageDomain: '12V' },
    },
  ],
  cables: [
    {
      id: 'cable-1',
      name: 'Main Feed',
      sourceId: 'comp-1',
      targetId: 'comp-2',
      props: { lengthM: 2, gaugeAwg: 6, material: 'copper' },
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

export const useSchemaStore = defineStore('schema', {
  state: () => {
    const schema = applyCableDerived(defaultSchema(), componentRegistry)
    return {
      schema,
      issues: runValidation(schema),
      registry: componentRegistry,
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
      this.schema = applyCableDerived(this.schema, this.registry)
      this.issues = runValidation(this.schema)
    },
    reset() {
      this.schema = applyCableDerived(defaultSchema(), this.registry)
      this.refreshValidation()
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
    setIssues(issues: Issue[]) {
      this.issues = issues
    },
  },
})
