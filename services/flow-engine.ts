/* =========================================================
 * Simple Flow Engine (12V only)
 * - Compatible signature with flow-engine.ts
 * - Nodes: battery(storage), distribution, load, source
 * - Charging supported, no converters, POS only
 *
 * Architecture:
 *   spanning-tree.ts   — Pure tree data structure + generic walker
 *   visitors/
 *     tree-visitor.ts  — Visitor interface + pipeline runner
 *     power-balance.ts — Computes load/source balance, battery state
 *     fuse-check.ts    — Opens fuses on overcurrent, marks blocked nodes
 *     edge-current.ts  — Assigns signed current to each tree edge
 *   flow-engine.ts     — Orchestrator (this file)
 * ========================================================= */

import type {
  BaseNode,
  Diagnostic,
  Edge,
  EdgeFlow,
  FlowInput,
  FlowOutput,
  GraphInput,
  NodeFlow,
  Port,
  ScenarioInput, NodeType 
} from "~/types/schema";

import { buildAdjacency, buildSpanningTree } from "./spanning-tree";
import { runVisitors } from "./visitors/tree-visitor";
import { PowerBalanceVisitor, type DomainNode } from "./visitors/power-balance";
import { FuseCheckVisitor } from "./visitors/fuse-check";
import { EdgeCurrentVisitor } from "./visitors/edge-current";

export type {
  BaseNode,
  Diagnostic,
  Edge,
  EdgeFlow,
  FlowInput,
  FlowOutput,
  GraphInput,
  NodeFlow,
  Port,
  ScenarioInput
};

interface Edge {
  id: string;
  from: string;
  to: string;
  wire?: { maxA?: number };
  fuseA?: number;
}

const DEFAULT_V = 12;
const SUPPORTED_DOMAIN = "dc";
const SUPPORTED_CONDUCTOR = "POS";

const isEnabled = (nodeId: string, scenario: ScenarioInput) => {
  const enabled = scenario.enabledNodes?.[nodeId];
  return enabled !== false;
};

const isSupportedDomain = (domain: string) => {
  const lower = domain.toLowerCase();
  return lower === "dc" || lower.startsWith("dc");
};

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

class FlowEngine {
  private readonly scenario: ScenarioInput;

  constructor(private readonly input: FlowInput) {
    this.scenario = input.scenario ?? {};
  }

  run(): FlowOutput {
    const diagnostics: Diagnostic[] = [];
    const edgesOut: Record<string, EdgeFlow> = {};
    const nodesOut: Record<string, NodeFlow> = {};

    // Phase 1: map the rich graph into a small 12V POS-only model.
    const { nodes, edges, diagnostics: mapDiagnostics } = this.mapGraph(this.input.graph, this.scenario);
    diagnostics.push(...mapDiagnostics);

    const batteries = nodes.filter((n) => n.type === "battery");
    if (batteries.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "NO_BATTERY",
        message: "No battery node found; cannot solve flow."
      });
      return this.finish("failed", diagnostics, edgesOut, nodesOut, 0, 0);
    }

    if (batteries.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "MULTIPLE_BATTERIES",
        message: "Multiple batteries found; using the first one."
      });
    }

    const battery = batteries[0];
    const V = this.resolveVoltage(battery);

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
    const powerBalance = new PowerBalanceVisitor<Edge>(nodes, battery, V, this.scenario);
    const fuseCheck = new FuseCheckVisitor<Edge>(nodes, powerBalance.injectionsA);
    const edgeCurrent = new EdgeCurrentVisitor<Edge>(
      fuseCheck.subtreeA,
      fuseCheck.blockedNodes,
      fuseCheck.blownEdges
    );

    const visitorDiag = runVisitors(tree, [powerBalance, fuseCheck, edgeCurrent]);
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
    for (const edge of this.input.graph.edges) {
      if (!edgesOut[edge.id]) edgesOut[edge.id] = { currentA: 0 };
    }

    // Derive battery net current from solved edge flows.
    const edgeById = new Map<string, Edge>(this.input.graph.edges.map((e: Edge) => [e.id, e]));
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

    return this.finish(status, diagnostics, edgesOut, nodesOut, powerBalance.totalDemandW, powerBalance.totalSupplyW);
  }

  private resolveVoltage(node: DomainNode) {
    const scenarioV = this.scenario.domainVoltage?.[SUPPORTED_DOMAIN];
    if (typeof scenarioV === "number" && scenarioV > 0) return scenarioV;
    const batteryV = numberParam(node.params, "nominalV");
    if (typeof batteryV === "number" && batteryV > 0) return batteryV;
    return DEFAULT_V;
  }

  // Reduce to a simple model: only DC POS edges and enabled nodes.
  private mapGraph(graph: GraphInput, scenario: ScenarioInput) {
    const diagnostics: Diagnostic[] = [];
    const nodes: DomainNode[] = [];

    for (const node of graph.nodes) {
      if (!isEnabled(node.id, scenario)) continue;

      let type: NodeType;
      if (node.type === "battery") type = "battery";
      else if (node.type === "distribution") type = "distribution";
      else if (node.type === "load") type = "load";
      else if (node.type === "source") type = "source";
      else {
        type = "distribution";
        diagnostics.push({
          severity: "warning",
          code: "UNSUPPORTED_NODE_TYPE",
          message: `Node type '${node.type}' is treated as distribution in simple mode.`,
          refs: [{ nodeId: node.id }]
        });
      }

      nodes.push({ id: node.id, type, params: node.params });
    }

    const portByKey = new Map<string, Port>();
    for (const node of graph.nodes) {
      if (!isEnabled(node.id, scenario)) continue;
      for (const port of node.ports) {
        portByKey.set(`${node.id}:${port.id}`, port);
      }
    }

    const edges: Edge[] = [];
    for (const edge of graph.edges) {
      if (!isEnabled(edge.from.nodeId, scenario) || !isEnabled(edge.to.nodeId, scenario)) continue;
      if (edge.from.nodeId === edge.to.nodeId) continue;

      const fromKey = `${edge.from.nodeId}:${edge.from.portId}`;
      const toKey = `${edge.to.nodeId}:${edge.to.portId}`;
      const fromPort = portByKey.get(fromKey);
      const toPort = portByKey.get(toKey);

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
          message: "Edge domain is not DC; ignored in simple mode.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      if (fromPort.conductor !== SUPPORTED_CONDUCTOR || toPort.conductor !== SUPPORTED_CONDUCTOR) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_CONDUCTOR_UNSUPPORTED",
          message: "Edge conductor is not POS; ignored in simple mode.",
          refs: [{ edgeId: edge.id }]
        });
        continue;
      }

      edges.push({
        id: edge.id,
        from: edge.from.nodeId,
        to: edge.to.nodeId,
        wire: { maxA: edge.wire?.maxA },
        fuseA: edge.protection?.fuseA
      });
    }

    return { nodes, edges, diagnostics };
  }

  private sumBatteryCurrent(
    batteryId: string,
    edges: Record<string, EdgeFlow>,
    edgeById: Map<string, Edge>
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
    supplyW: number
  ): FlowOutput {
    return {
      status,
      diagnostics,
      edges,
      nodes,
      totals: {
        byDomain: {
          [SUPPORTED_DOMAIN]: {
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
