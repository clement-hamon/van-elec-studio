import type {
  BaseNode,
  Conductor,
  Direction,
  Domain,
  Edge,
  NodeType,
  Port,
  ScenarioInput,
  Wire,
} from '~/types/flow'

export type Id = string

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
  type: NodeType
  defaultParams: Record<string, number | string | boolean>
  fields?: ComponentFieldDefinition[]
  ports: PortDefinition[]
}

export type PortDefinition = {
  id: string
  label: string
  direction: Direction
  domain: Domain
  conductor: Conductor
}

export type ComponentInstance = BaseNode & {
  typeId: string
  name: string
  position: Position
  params: Record<string, number | string | boolean>
  ports: (Port & { label?: string })[]
}

export type CableWire = Wire & {
  gaugeAwg?: number
}

export type Cable = Edge & {
  name: string
  wire: CableWire
  derived: CableDerived
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

export type ScenarioState = ScenarioInput

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
