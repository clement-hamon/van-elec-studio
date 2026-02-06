import { defineStore } from 'pinia'
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
]

const defaultSchema = (): SchemaState => ({
  components: [
    {
      id: 'comp-1',
      typeId: 'battery',
      name: 'House Battery',
      position: { x: 140, y: 140 },
      props: { voltage: 12, capacityAh: 200 },
      derived: { maxCurrentA: 200 },
    },
    {
      id: 'comp-2',
      typeId: 'fuse',
      name: 'Main Fuse',
      position: { x: 360, y: 140 },
      props: { ratingA: 60 },
      derived: { maxCurrentA: 120 },
    },
  ],
  cables: [
    {
      id: 'cable-1',
      name: 'Main Feed',
      sourceId: 'comp-1',
      targetId: 'comp-2',
      props: { lengthM: 2, gaugeAwg: 6, material: 'copper' },
      derived: { maxCurrentA: 120, voltageDropV: 0.1 },
    },
  ],
  groups: [],
  selection: {},
  updatedAt: nowIso(),
})

export const useSchemaStore = defineStore('schema', {
  state: () => ({
    schema: defaultSchema(),
    issues: runValidation(defaultSchema()),
    registry: componentRegistry,
  }),
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
    refreshValidation() {
      this.issues = runValidation(this.schema)
    },
    reset() {
      this.schema = defaultSchema()
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
      this.schema.cables[idx] = { ...this.schema.cables[idx], ...props }
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
