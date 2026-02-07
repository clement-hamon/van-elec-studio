export type Id = string

export type VoltageDomain = '12V' | '24V' | '48V'
export type ComponentCategory = 'source' | 'storage' | 'conversion' | 'distribution' | 'load'
export type EnergyRole =
  | 'source'
  | 'storage'
  | 'conversion'
  | 'distribution'
  | 'load'
  | 'protection'
  | 'charger'
export type ChargePathRole =
  | 'source'
  | 'controller'
  | 'charger'
  | 'battery'
  | 'converter'
  | 'inlet'
  | 'none'

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
  category: ComponentCategory
  energyRole?: EnergyRole
  chargePathRole?: ChargePathRole
  defaultProps: Record<string, number | string | boolean>
  fields?: ComponentFieldDefinition[]
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

export type BatteryProps = {
  voltage: number
  operatingVoltage: number
  capacityAh: number
  chemistry?: string
  maxChargeCurrentA?: number
  absorptionVoltage?: number
  floatVoltage?: number
}

export type SolarPanelProps = {
  watt: number
  voltage: number
  currentA?: number
}

export type ChargeControllerProps = {
  controllerType?: 'mppt' | 'pwm'
  maxInputVoltage?: number
  maxInputCurrentA?: number
  maxOutputCurrentA?: number
  outputVoltage?: number
}

export type AlternatorProps = {
  ratedCurrentA: number
  voltage?: number
}

export type DcDcChargerProps = {
  maxOutputCurrentA: number
  inputVoltage?: number
  outputVoltage?: number
}

export type ShoreInletProps = {
  inputVoltage: 120 | 230
}

export type AcDcChargerProps = {
  maxOutputCurrentA: number
  outputVoltage?: number
  inputVoltage?: number
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
