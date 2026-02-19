/* =========================================================
 * Flow Engine
 * - Compatible signature with computeFlow(input)
 * - Tree-based visitor pipeline
 * - Supports DC/AC edge voltages and conversion losses
 * ========================================================= */

import type {
  BaseNode,
  Diagnostic,
  Edge as SchemaEdge,
  EdgeFlow,
  FlowInput,
  FlowOutput,
  GraphInput,
  NodeFlow,
  Port,
  ScenarioInput,
  NodeType, Conductor, Direction
} from "../types/schema";
import { nodeTypes } from "../types/schema";
import {
  DEFAULT_DOMAIN_VOLTAGE,
  isACDomain,
  isDCDomain,
  normalizeDomain,
  resolveVoltageForDomain,
} from "./flow/voltage-domain";

import { buildAdjacency, buildSpanningTree } from "./spanning-tree";
import { runVisitors } from "./visitors/tree-visitor";
import { PowerBalanceVisitor, type DomainNode } from "./visitors/power-balance";
import { FuseCheckVisitor } from "./visitors/fuse-check";
import { EdgeCurrentVisitor } from "./visitors/edge-current";
import { VoltageCompatibilityVisitor } from "./visitors/voltage-compatibility";

export type {
  BaseNode,
  Diagnostic,
  SchemaEdge as Edge,
  EdgeFlow,
  FlowInput,
  FlowOutput,
  GraphInput,
  NodeFlow,
  Port,
  ScenarioInput
};

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  fromPortId: string;
  toPortId: string;
  fromPortDir: Direction;
  toPortDir: Direction;
  domain: string;
  // Resolved operating voltage for this edge domain in the active scenario.
  voltageV: number;
  wire?: { maxA?: number; lengthM?: number };
  fuseA?: number;
}

const DEFAULT_TOTALS_DOMAIN = "dc";
const SUPPORTED_CONDUCTORS = new Set<Conductor>(["POS", "L"]);

const isEnabled = (nodeId: string, scenario: ScenarioInput) => {
  const enabled = scenario.enabledNodes?.[nodeId];
  return enabled !== false;
};

const isSupportedDomain = (domain: string) => {
  return isDCDomain(domain) || isACDomain(domain);
};

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isSupportedConductor = (conductor: Conductor) => SUPPORTED_CONDUCTORS.has(conductor);

class FlowEngine {
  private readonly scenario: ScenarioInput;

  constructor(private readonly input: FlowInput) {
    this.scenario = input.scenario ?? {};
  }

  run(): FlowOutput {
    const diagnostics: Diagnostic[] = [];
    const edgesOut: Record<string, EdgeFlow> = {};
    const nodesOut: Record<string, NodeFlow> = {};

    // Phase 1: map graph into the flow model.
    const { nodes, edges, diagnostics: mapDiagnostics } = this.mapGraph(this.input.graph, this.scenario);
    diagnostics.push(...mapDiagnostics);

    const batteries = nodes.filter((n) => n.type === "battery");
    if (batteries.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "NO_BATTERY",
        message: "No battery node found; cannot solve flow."
      });
      return this.finish("failed", diagnostics, edgesOut, nodesOut, 0, 0, undefined);
    }

    if (batteries.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "MULTIPLE_BATTERIES",
        message: "Multiple batteries found; using the first one."
      });
    }

    const battery = batteries[0];
    const batteryVoltageV = this.resolveBatteryVoltage(battery);

    // Phase 2: build a spanning tree from the battery (delegated to spanning-tree module).
    const adjacency = buildAdjacency(edges);
    const tree = buildSpanningTree(battery.id, adjacency, edges);

    if (tree.nonTreeEdges.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "NON_TREE_EDGE_IGNORED",
        message: "Graph has cycles or extra edges; non-tree edges carry 0A in this model."
      });
    }

    const disconnectedLoads = nodes.filter(
      (n) => n.type === "load" && !tree.parent.has(n.id)
    );
    for (const node of disconnectedLoads) {
      diagnostics.push({
        severity: "warning",
        code: "DISCONNECTED_LOAD",
        message: "Load is disconnected from the battery; it will not be served.",
        refs: [{ nodeId: node.id }]
      });
    }

    // Phase 3: run visitors in pipeline order.
    const powerBalance = new PowerBalanceVisitor<FlowEdge>(nodes, battery, batteryVoltageV, this.scenario);
    const fuseCheck = new FuseCheckVisitor<FlowEdge>(nodes, powerBalance.injectionsW);
    const edgeCurrent = new EdgeCurrentVisitor<FlowEdge>(
      fuseCheck.subtreeW,
      fuseCheck.blockedNodes,
      fuseCheck.blownEdges,
    );
    const voltageCompatibility = new VoltageCompatibilityVisitor<FlowEdge>(nodes);

    const visitorDiag = runVisitors(tree, [voltageCompatibility, powerBalance, fuseCheck, edgeCurrent]);
    diagnostics.push(...visitorDiag);

    // Collect results from visitors.
    Object.assign(nodesOut, powerBalance.nodeFlows);

    for (const nodeId of fuseCheck.blockedNodes) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type !== "load") continue;
      const existing = nodesOut[nodeId] ?? {};
      nodesOut[nodeId] = { ...existing, clampedBy: ["fuseA"] };
      diagnostics.push({
        severity: "warning",
        code: "LOAD_UNSERVED_FUSE",
        message: "Load unserved due to upstream fuse opening.",
        refs: [{ nodeId }]
      });
    }

    Object.assign(edgesOut, edgeCurrent.edgeFlows);

    // Fill in zero for any edges not in the tree.
    for (const edge of this.input.graph.edges as SchemaEdge[]) {
      if (!edgesOut[edge.id]) edgesOut[edge.id] = { currentA: 0 };
    }

    // Derive battery net current from solved edge flows.
    const edgeById = new Map<string, SchemaEdge>(this.input.graph.edges.map((edge: SchemaEdge) => [edge.id, edge]));
    const batteryNetA = this.sumBatteryCurrent(battery.id, edgesOut, edgeById);
    const batteryFlow = nodesOut[battery.id] ?? {};
    nodesOut[battery.id] = {
      ...batteryFlow,
      netA: batteryNetA,
      state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle"
    };

    const hasError = diagnostics.some((d) => d.severity === "error");
    const hasUnserved = powerBalance.hasUnserved || disconnectedLoads.length > 0 || fuseCheck.blockedNodes.size > 0;
    const status: FlowOutput["status"] = hasError ? "failed" : hasUnserved ? "partial" : "ok";

    return this.finish(
      status,
      diagnostics,
      edgesOut,
      nodesOut,
      powerBalance.totalDemandW,
      powerBalance.totalSupplyW,
      battery.primaryDomain
    );
  }

  private scenarioVoltageForDomain(domain: string | undefined) {
    if (!domain) return undefined;
    const domainVoltage = this.scenario.domainVoltage;
    if (!domainVoltage) return undefined;

    const direct = domainVoltage[domain];
    if (typeof direct === "number" && direct > 0) return direct;

    const normalizedDomain = normalizeDomain(domain);
    for (const [candidateDomain, candidateVoltage] of Object.entries(domainVoltage)) {
      if (normalizeDomain(candidateDomain) !== normalizedDomain) continue;
      if (typeof candidateVoltage === "number" && candidateVoltage > 0) return candidateVoltage;
    }
    return undefined;
  }

  private resolveBatteryVoltage(node: DomainNode) {
    const scenarioV = this.scenarioVoltageForDomain(node.primaryDomain);
    if (scenarioV) return scenarioV;

    const batteryV = numberParam(node.params, "nominalV");
    if (typeof batteryV === "number" && batteryV > 0) return batteryV;

    return resolveVoltageForDomain(node.primaryDomain, this.scenario, DEFAULT_DOMAIN_VOLTAGE);
  }

  // Build the flow model from enabled nodes and compatible edges.
  private mapGraph(graph: GraphInput, scenario: ScenarioInput) {
    const diagnostics: Diagnostic[] = [];
    const nodes: DomainNode[] = [];

    for (const node of graph.nodes) {
      // only include enabled nodes
      if (!isEnabled(node.id, scenario)) continue;

      const initialType = node.type;
      const mappedType = nodeTypes.includes(initialType as NodeType)
        ? (initialType as NodeType)
        : "distribution";
      if (mappedType !== initialType) {
        diagnostics.push({
          severity: "warning",
          code: "UNSUPPORTED_NODE_TYPE",
          message: `Node type '${initialType}' is treated as distribution in flow mode.`,
          refs: [{ nodeId: node.id }]
        });
      }

      const primaryPort = node.ports[0];
      nodes.push({
        id: node.id,
        type: mappedType,
        typeId: (node as { typeId?: string }).typeId,
        primaryDomain: primaryPort?.domain,
        params: node.params
      });
    }

    // Quick lookup for ports by nodeId:portId.
    const portByKey = new Map<string, Port>();
    for (const node of graph.nodes) {
      if (!isEnabled(node.id, scenario)) continue;
      for (const port of node.ports) {
        portByKey.set(`${node.id}:${port.id}`, port);
      }
    }

    // Include only edges that connect enabled nodes and have compatible domains/conductors.
    const edges: FlowEdge[] = [];
    for (const edge of graph.edges) {
      if (!isEnabled(edge.from.nodeId, scenario) || !isEnabled(edge.to.nodeId, scenario)) continue;
      if (edge.from.nodeId === edge.to.nodeId) continue;

      const fromKey = `${edge.from.nodeId}:${edge.from.portId}`;
      const toKey = `${edge.to.nodeId}:${edge.to.portId}`;
      const fromPort = portByKey.get(fromKey) as Port;
      const toPort = portByKey.get(toKey) as Port;

      if (!fromPort || !toPort) {
        diagnostics.push({
          severity: "error",
          code: "EDGE_PORT_MISSING",
          message: "Edge references a missing port.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      if (!isSupportedDomain(fromPort.domain) || !isSupportedDomain(toPort.domain)) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_DOMAIN_UNSUPPORTED",
          message: "Edge domain is unsupported; ignored in flow mode.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      if (normalizeDomain(fromPort.domain) !== normalizeDomain(toPort.domain)) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_DOMAIN_MISMATCH",
          message: "Edge connects ports with different domains; add a converter component.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      if (!isSupportedConductor(fromPort.conductor) || !isSupportedConductor(toPort.conductor)) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_CONDUCTOR_UNSUPPORTED",
          message: "Edge conductor is unsupported; ignored in flow mode.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      if (fromPort.conductor !== toPort.conductor) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_CONDUCTOR_MISMATCH",
          message: "Edge connects ports with different conductors; ignored in flow mode.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      const domain = normalizeDomain(fromPort.domain);
      // Voltage is resolved once at mapping time so all downstream visitors
      // use a stable domain voltage reference for this edge.
      const voltageV = resolveVoltageForDomain(fromPort.domain, scenario, DEFAULT_DOMAIN_VOLTAGE);
      edges.push({
        id: edge.id,
        from: edge.from.nodeId,
        to: edge.to.nodeId,
        fromPortId: edge.from.portId,
        toPortId: edge.to.portId,
        fromPortDir: fromPort.dir,
        toPortDir: toPort.dir,
        domain,
        voltageV,
        wire: { maxA: edge.wire?.maxA, lengthM: edge.wire?.lengthM },
        fuseA: edge.protection?.fuseA
      });
    }

    return { nodes, edges, diagnostics };
  }

  private sumBatteryCurrent(
    batteryId: string,
    edges: Record<string, EdgeFlow>,
    edgeById: Map<string, SchemaEdge>
  ) {
    let netA = 0;
    for (const [edgeId, flow] of Object.entries(edges)) {
      if (!flow) continue;
      const edge = edgeById.get(edgeId);
      if (!edge) continue;
      if (edge.to.nodeId === batteryId) netA += flow.currentA;
      if (edge.from.nodeId === batteryId) netA -= flow.currentA;
    }
    return netA;
  }

  private finish(
    status: FlowOutput["status"],
    diagnostics: Diagnostic[],
    edges: Record<string, EdgeFlow>,
    nodes: Record<string, NodeFlow>,
    loadW: number,
    supplyW: number,
    primaryDomain: string | undefined
  ): FlowOutput {
    const totalsDomain = normalizeDomain(primaryDomain) || DEFAULT_TOTALS_DOMAIN;

    return {
      status,
      diagnostics,
      edges,
      nodes,
      totals: {
        byDomain: {
          [totalsDomain]: {
            loadW,
            supplyW,
            lossW: 0
          }
        }
      }
    };
  }
}

export const computeFlow = (input: FlowInput): FlowOutput => {
  return new FlowEngine(input).run();
};
