import type {
  BaseNode,
  Conductor,
  DcNegativeMode,
  Diagnostic,
  GraphInput,
  Port,
  ScenarioInput,
  Severity,
} from "../../types/schema";
import { isDCDomain } from "./voltage-domain";

const NEGATIVE_CONDUCTOR: Conductor = "NEG";
const POSITIVE_CONDUCTOR: Conductor = "POS";

const isEnabled = (nodeId: string, scenario: ScenarioInput | undefined) => {
  const enabled = scenario?.enabledNodes?.[nodeId];
  return enabled !== false;
};

const portKey = (nodeId: string, portId: string) => `${nodeId}:${portId}`;

const buildPortIndex = (graph: GraphInput, scenario: ScenarioInput | undefined) => {
  const byKey = new Map<string, Port>();
  for (const node of graph.nodes) {
    if (!isEnabled(node.id, scenario)) continue;
    for (const port of node.ports) {
      byKey.set(portKey(node.id, port.id), port);
    }
  }
  return byKey;
};

const buildNodeIndex = (graph: GraphInput) => {
  return new Map<string, BaseNode>(graph.nodes.map((node) => [node.id, node] as const));
};

const buildNegativeAdjacency = (graph: GraphInput, scenario: ScenarioInput | undefined, portByKey: Map<string, Port>) => {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set<string>());
    adjacency.get(a)?.add(b);
  };

  for (const edge of graph.edges) {
    if (!isEnabled(edge.from.nodeId, scenario) || !isEnabled(edge.to.nodeId, scenario)) continue;

    const fromPort = portByKey.get(portKey(edge.from.nodeId, edge.from.portId));
    const toPort = portByKey.get(portKey(edge.to.nodeId, edge.to.portId));
    if (!fromPort || !toPort) continue;
    if (!isDCDomain(fromPort.domain) || !isDCDomain(toPort.domain)) continue;
    if (fromPort.conductor !== NEGATIVE_CONDUCTOR || toPort.conductor !== NEGATIVE_CONDUCTOR) continue;

    link(edge.from.nodeId, edge.to.nodeId);
    link(edge.to.nodeId, edge.from.nodeId);
  }

  return adjacency;
};

const reachableNodes = (adjacency: Map<string, Set<string>>, startNodeId: string) => {
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
};

const hasConductorPort = (node: BaseNode | undefined, conductor: Conductor) => {
  if (!node) return false;
  return node.ports.some((port) => isDCDomain(port.domain) && port.conductor === conductor);
};

const severityForMode = (mode: DcNegativeMode): Severity => {
  return mode === "enforce" ? "error" : "warning";
};

export const resolveDcNegativeMode = (scenario: ScenarioInput | undefined): DcNegativeMode => {
  return scenario?.dcNegativeMode ?? "warn";
};

export interface DcNegativeReturnContext {
  graph: GraphInput;
  scenario: ScenarioInput | undefined;
  batteryId: string;
  connectedLoadIds: Iterable<string>;
}

export const validateDcNegativeReturn = (context: DcNegativeReturnContext): Diagnostic[] => {
  const mode = resolveDcNegativeMode(context.scenario);
  if (mode === "off") return [];

  const diagnostics: Diagnostic[] = [];
  const severity = severityForMode(mode);
  const nodeById = buildNodeIndex(context.graph);
  const battery = nodeById.get(context.batteryId);
  if (!battery) return diagnostics;

  if (!hasConductorPort(battery, NEGATIVE_CONDUCTOR)) {
    diagnostics.push({
      severity,
      code: "DC_BATTERY_NEG_MISSING",
      message: "Battery has no DC negative port; return-path checks cannot be completed.",
      refs: [{ nodeId: context.batteryId }],
    });
    return diagnostics;
  }

  const portByKey = buildPortIndex(context.graph, context.scenario);
  const negativeAdjacency = buildNegativeAdjacency(context.graph, context.scenario, portByKey);
  const reachableByNegative = reachableNodes(negativeAdjacency, context.batteryId);
  const loadIds = Array.from(new Set(context.connectedLoadIds)).sort();

  for (const loadId of loadIds) {
    if (!isEnabled(loadId, context.scenario)) continue;
    const load = nodeById.get(loadId);
    if (!load || load.type !== "load") continue;
    if (!hasConductorPort(load, POSITIVE_CONDUCTOR)) continue;

    if (!hasConductorPort(load, NEGATIVE_CONDUCTOR)) {
      diagnostics.push({
        severity,
        code: "DC_LOAD_NEG_PORT_MISSING",
        message: "DC load has no negative port; add a return terminal to model a complete circuit.",
        refs: [{ nodeId: loadId }],
      });
      continue;
    }

    if (reachableByNegative.has(loadId)) continue;
    diagnostics.push({
      severity,
      code: "DC_NEG_RETURN_MISSING",
      message: "DC load is missing a negative return path to battery negative.",
      refs: [{ nodeId: loadId }, { nodeId: context.batteryId }],
    });
  }

  return diagnostics;
};
