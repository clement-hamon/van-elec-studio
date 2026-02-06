export type Id = string

export type VoltageDomain = '12V' | '24V' | '48V'
export type ComponentCategory = 'source' | 'storage' | 'conversion' | 'distribution' | 'load'

export type ComponentType = {
  id: string
  label: string
  category: ComponentCategory
  defaultProps: Record<string, number | string | boolean>
  ports: PortDefinition[]
  constraints?: ComponentConstraints
}

export type PortDefinition = {
  id: string
  label: string
  direction: 'in' | 'out' | 'bidirectional'
  domain: 'dc' | 'ac'
  maxCurrent?: number
}

export type ComponentConstraints = {
  voltageDomain?: VoltageDomain
  maxCurrent?: number
}

export type ComponentInstance = {
  id: Id
  typeId: string
  name: string
  position: Position
  props: Record<string, number | string | boolean>
  derived: Record<string, number | string | boolean>
  groupId?: Id
}

export type Cable = {
  id: Id
  name: string
  sourceId: Id
  targetId: Id
  props: CableProps
  derived: CableDerived
}

export type CableProps = {
  lengthM: number
  gaugeAwg: number
  material: 'copper' | 'aluminum'
}

export type CableDerived = {
  maxCurrentA: number
  voltageDropV: number
}

export type Group = {
  id: Id
  name: string
  constraint: ComponentConstraints
  children: Id[]
}

export type Position = {
  x: number
  y: number
}

export type SchemaState = {
  components: ComponentInstance[]
  cables: Cable[]
  groups: Group[]
  selection: SelectionState
  updatedAt: string
}

export type SelectionState = {
  componentId?: Id
  cableId?: Id
  groupId?: Id
}

export type Issue = {
  id: Id
  level: 'warning' | 'error'
  message: string
  targetType: 'component' | 'cable' | 'group'
  targetId: Id
  suggestion?: string
}
