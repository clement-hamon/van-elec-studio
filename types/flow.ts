/* =========================================================
 * Shared flow/domain types
 * ========================================================= */

export type NodeType = "source" | "storage" | "conversion" | "distribution" | "load";

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

/** Scenario toggles and assumptions */
export interface ScenarioInput {
  // enable/disable nodes (loads/sources/converters)
  enabledNodes?: Record<string, boolean>;

  // Domain nominal voltages used for W<->A conversions
  domainVoltage?: Partial<Record<Domain, number>>;

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
  netA?: number; // for storage
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
