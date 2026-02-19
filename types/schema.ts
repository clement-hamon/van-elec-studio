export const nodeTypes = ["source", "battery", "conversion", "distribution", "load"] as const;
export type NodeType = typeof nodeTypes[number];

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
  imageScaleRatio: number
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

/* =========================================================
 * Shared flow/domain types
 * ========================================================= */

export type Domain = "DC_12V" | "DC_24V" | "AC_230V" | string;
export type Conductor = "POS" | "NEG" | "CHASSIS" | "L" | "N" | "PE";

export type Direction = "in" | "out" | "bidirectional";

export type Severity = "info" | "warning" | "error";

export interface Port {
  id: string;
  domain: Domain;
  conductor: Conductor;
  dir: Direction;
}

export interface Wire {
  lengthM?: number;
  maxA?: number; // ampacity
  resistanceOhmPerM?: number; // for future voltage-drop mode
}

export interface Protection {
  fuseA?: number;
  breakerA?: number;
  switchA?: number;
  enabled?: boolean; // switch open/closed
}

export interface Edge {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  wire?: Wire;
  protection?: Protection;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  ports: Port[];
  params?: Record<string, unknown>;
}

export interface GraphInput {
  nodes: BaseNode[];
  edges: Edge[];
}

export type DcNegativeMode = "off" | "warn" | "enforce";
export type CurrentComputationMode = "load_simulation" | "cable_sizing";

/** Scenario toggles and assumptions */
export interface ScenarioInput {
  // enable/disable nodes (loads/sources/converters)
  enabledNodes?: Record<string, boolean>;

  // Domain nominal voltages used for W<->A conversions
  domainVoltage?: Partial<Record<Domain, number>>;

  // DC negative-return path validation mode.
  dcNegativeMode?: DcNegativeMode;

  // Current calculation strategy used for cable metrics.
  currentComputationMode?: CurrentComputationMode;

  // Multi-source dispatch
  dispatchPolicy?: "priority_order" | "share_proportionally";
  sourcePriority?: string[]; // list of source node ids in priority order
}

/** Flow engine input */
export interface FlowInput {
  graph: GraphInput;
  scenario: ScenarioInput;
}

/** Output structures */
export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  refs?: { nodeId?: string; edgeId?: string; domain?: Domain }[];
}

export interface EdgeFlow {
  currentA: number;          // signed relative to edge.from -> edge.to
  utilization?: number;      // |A| / wire.maxA
  limitedBy?: string[];      // e.g. ["wire.maxA", "fuseA", "converter.maxOutA"]
}

export interface NodeFlow {
  netA?: number; // for battery
  state?: "charging" | "discharging" | "idle";
  clampedBy?: string[];
  demandW?: number;   // for loads
  supplyW?: number;   // for sources
}

export interface FlowOutput {
  status: "ok" | "partial" | "failed";
  diagnostics: Diagnostic[];
  edges: Record<string, EdgeFlow>;
  nodes: Record<string, NodeFlow>;
  totals: {
    byDomain: Record<string, { loadW: number; supplyW: number; lossW: number }>;
  };
}
