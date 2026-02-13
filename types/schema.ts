export type Id = string

export type NodeType = 'source' | 'storage' | 'conversion' | 'distribution' | 'load'
export type PortDomain = 'dc' | 'ac'
export type PortDirection = 'in' | 'out' | 'bidirectional'
export type PortConductor = 'POS' | 'NEG' | 'CHASSIS' | 'L' | 'N' | 'PE'

export type ComponentFieldType = 'text' | 'number' | 'select'

export type ComponentFieldOption = {
  label: string
  value: string | number
}

export type ComponentFieldDefinition = {
  key: string
  label: string
  type: ComponentFieldType
  step?: number
  unit?: string
  options?: ComponentFieldOption[]
  placeholder?: string
}

export type ComponentType = {
  id: string
  label: string
  description?: string
  nodeType: NodeType
  defaultProps: Record<string, number | string | boolean>
  fields?: ComponentFieldDefinition[]
  ports: PortDefinition[]
}

export type PortDefinition = {
  id: string
  label: string
  direction: PortDirection
  domain: PortDomain
  conductor: PortConductor
}

export type ComponentInstance = {
  id: Id
  typeId: string
  name: string
  position: Position
  props: Record<string, number | string | boolean>
}

export type Cable = {
  id: Id
  name: string
  sourceId: Id
  targetId: Id
  sourcePortId?: Id
  targetPortId?: Id
  props: CableProps
  derived: CableDerived
}

export type CableProps = {
  lengthM: number
  gaugeAwg: number
}

export type CableDerived = {
  ampacityA: number
  expectedCurrentA: number
  expectedPowerW: number
  circuitVoltageV: number
  resistanceOhmPerM: number
  loopResistanceOhm: number
  voltageDropV: number
}

export type Position = {
  x: number
  y: number
}

export type SchemaState = {
  components: ComponentInstance[]
  cables: Cable[]
  selection: SelectionState
  scenario?: ScenarioState
  updatedAt: string
}

export type ScenarioState = {
  enabledNodes?: Record<Id, boolean>
  domainVoltage?: Record<string, number>
  dispatchPolicy?: 'priority_order' | 'share_proportionally'
  sourcePriority?: Id[]
}

export type SelectionState = {
  componentId?: Id
  cableId?: Id
}

export type Issue = {
  id: Id
  level: 'warning' | 'error' | 'info'
  message: string
  targetType: 'component' | 'cable'
  targetId: Id
  suggestion?: string
  category?: string
  messageKey?: string
  params?: Record<string, string | number>
  blame?: {
    nodes?: Id[]
    edges?: Id[]
    ports?: Id[]
  }
  ruleId?: string
}
