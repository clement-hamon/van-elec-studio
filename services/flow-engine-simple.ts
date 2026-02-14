/* =========================================================
 * Simple Flow Engine (12V only)
 * - Compatible signature with flow-engine.ts
 * - Nodes: battery(storage), distribution, load
 * - No converters, no charging, POS only
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
  ScenarioInput
} from "~/services/flow-engine";

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

type SimpleNodeType = "battery" | "distribution" | "load";

interface SimpleNode {
  id: string;
  type: SimpleNodeType;
  params?: Record<string, unknown>;
}

interface SimpleEdge {
  id: string;
  from: string;
  to: string;
  wire?: { maxA?: number };
  fuseA?: number;
}

const DEFAULT_V = 12;
const SUPPORTED_DOMAIN = "DC_12V";
const SUPPORTED_CONDUCTOR = "POS";

const isEnabled = (nodeId: string, scenario: ScenarioInput) => {
  const enabled = scenario.enabledNodes?.[nodeId];
  return enabled !== false;
};

const numberParam = (params: Record<string, unknown> | undefined, key: string) => {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const loadDemandW = (node: SimpleNode, V: number) => {
  const watts = numberParam(node.params, "watts");
  const amps = numberParam(node.params, "amps");
  const duty = numberParam(node.params, "dutyCycle") ?? 1;
  const baseW = typeof watts === "number" ? watts : typeof amps === "number" ? amps * V : 0;
  return Math.max(0, baseW) * Math.max(0, duty);
};

class SimpleFlowEngine {
  private readonly scenario: ScenarioInput;

  constructor(private readonly input: FlowInput) {
    this.scenario = input.scenario ?? {};
  }

  run(): FlowOutput {
    const diagnostics: Diagnostic[] = [];
    const edgesOut: Record<string, EdgeFlow> = {};
    const nodesOut: Record<string, NodeFlow> = {};

    const { nodes, edges, diagnostics: mapDiagnostics } = this.mapGraph(this.input.graph, this.scenario);
    diagnostics.push(...mapDiagnostics);

    const batteries = nodes.filter((node) => node.type === "battery");
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

    const adjacency = this.buildAdjacency(edges);
    const tree = this.buildTree(battery.id, adjacency, edges);

    if (tree.nonTreeEdges.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "NON_TREE_EDGE_IGNORED",
        message: "Graph has cycles or extra edges; non-tree edges carry 0A in this model."
      });
    }

    const disconnectedLoads = nodes.filter(
      (node) => node.type === "load" && !tree.parent.has(node.id)
    );
    for (const node of disconnectedLoads) {
      diagnostics.push({
        severity: "warning",
        code: "DISCONNECTED_LOAD",
        message: "Load is disconnected from the battery; it will not be served.",
        refs: [{ nodeId: node.id }]
      });
    }

    const demandByNode = new Map<string, number>();
    let totalDemandW = 0;
    let connectedDemandW = 0;

    for (const node of nodes) {
      if (node.type !== "load") continue;
      const demandW = loadDemandW(node, V);
      demandByNode.set(node.id, demandW);
      totalDemandW += demandW;
      if (tree.parent.has(node.id)) connectedDemandW += demandW;
    }

    const maxDischargeA = numberParam(battery.params, "maxDischargeA") ?? Number.POSITIVE_INFINITY;
    const maxDischargeW = maxDischargeA * V;
    const servedFactor = connectedDemandW > 0 ? Math.min(1, maxDischargeW / connectedDemandW) : 1;

    if (servedFactor < 1) {
      diagnostics.push({
        severity: "warning",
        code: "BATTERY_CLAMPED",
        message: "Battery max discharge exceeded; loads scaled proportionally."
      });
    }

    for (const node of nodes) {
      if (node.type !== "load") continue;
      nodesOut[node.id] = { demandW: demandByNode.get(node.id) ?? 0 };
    }

    const subtreeA = new Map<string, number>();
    const subtreeNodes = new Map<string, Set<string>>();
    const blockedNodes = new Set<string>();
    const blownEdges = new Set<string>();

    for (const node of nodes) {
      const demandW = demandByNode.get(node.id) ?? 0;
      const servedW = node.type === "load" && tree.parent.has(node.id) ? demandW * servedFactor : 0;
      subtreeA.set(node.id, V > 0 ? servedW / V : 0);
      subtreeNodes.set(node.id, new Set([node.id]));
    }

    for (const nodeId of tree.postorder) {
      const children = tree.children.get(nodeId) ?? [];
      let sum = subtreeA.get(nodeId) ?? 0;
      const nodesInSubtree = subtreeNodes.get(nodeId) ?? new Set([nodeId]);

      for (const child of children) {
        sum += subtreeA.get(child) ?? 0;
        const childNodes = subtreeNodes.get(child);
        if (childNodes) childNodes.forEach((id) => nodesInSubtree.add(id));
      }

      const edge = tree.parentEdge.get(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      const nodeFuseA = numberParam(node?.params, "ratingA");
      const edgeFuseA = edge?.fuseA;
      const fuseA = edgeFuseA ?? nodeFuseA;

      if (edge && fuseA && sum > fuseA + 1e-6) {
        blownEdges.add(edge.id);
        nodesInSubtree.forEach((id) => blockedNodes.add(id));
        diagnostics.push({
          severity: "warning",
          code: "FUSE_OPEN",
          message: "Fuse opened due to overcurrent; downstream loads are unserved.",
          refs: [{ edgeId: edge.id }]
        });
        sum = 0;
      }

      subtreeA.set(nodeId, sum);
      subtreeNodes.set(nodeId, nodesInSubtree);
    }

    for (const nodeId of blockedNodes) {
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

    const rootCurrentA = subtreeA.get(battery.id) ?? 0;
    nodesOut[battery.id] = {
      netA: -rootCurrentA,
      state: rootCurrentA > 1e-6 ? "discharging" : "idle",
      clampedBy: servedFactor < 1 ? ["battery.maxDischargeA"] : undefined
    };

    for (const [child, edge] of tree.parentEdge.entries()) {
      if (!edge) continue; // root
      const parent = tree.parent.get(child) as string;
      if (blownEdges.has(edge.id)) {
        edgesOut[edge.id] = { currentA: 0, limitedBy: ["fuseA"] };
        continue;
      }
      if (blockedNodes.has(child) || blockedNodes.has(parent)) {
        edgesOut[edge.id] = { currentA: 0 };
        continue;
      }

      const flowA = subtreeA.get(child) ?? 0;
      let signedA = edge.from === parent && edge.to === child ? flowA : -flowA;

      if (!(edge.from === parent && edge.to === child) && !(edge.from === child && edge.to === parent)) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_DIRECTION_MISMATCH",
          message: "Edge direction does not match tree connection; current sign may be wrong.",
          refs: [{ edgeId: edge.id }]
        });
        signedA = flowA;
      }

      const maxA = edge.wire?.maxA;
      const utilization = maxA ? Math.abs(signedA) / maxA : undefined;
      const limitedBy: string[] = [];
      if (maxA && Math.abs(signedA) > maxA + 1e-6) limitedBy.push("wire.maxA");

      edgesOut[edge.id] = {
        currentA: signedA,
        utilization,
        limitedBy: limitedBy.length ? limitedBy : undefined
      };
    }

    for (const edge of this.input.graph.edges) {
      if (!edgesOut[edge.id]) edgesOut[edge.id] = { currentA: 0 };
    }

    const hasError = diagnostics.some((d) => d.severity === "error");
    const hasUnserved = servedFactor < 1 || disconnectedLoads.length > 0;
    const status: FlowOutput["status"] = hasError ? "failed" : hasUnserved ? "partial" : "ok";

    const deliveredW = rootCurrentA * V;
    return this.finish(status, diagnostics, edgesOut, nodesOut, totalDemandW, deliveredW);
  }

  private resolveVoltage(battery: SimpleNode) {
    const scenarioV = this.scenario.domainVoltage?.[SUPPORTED_DOMAIN];
    if (typeof scenarioV === "number" && scenarioV > 0) return scenarioV;
    const batteryV = numberParam(battery.params, "nominalV");
    if (typeof batteryV === "number" && batteryV > 0) return batteryV;
    return DEFAULT_V;
  }

  private mapGraph(graph: GraphInput, scenario: ScenarioInput) {
    const diagnostics: Diagnostic[] = [];
    const nodes: SimpleNode[] = [];

    for (const node of graph.nodes) {
      if (!isEnabled(node.id, scenario)) continue;

      let type: SimpleNodeType;
      if (node.type === "storage") type = "battery";
      else if (node.type === "distribution") type = "distribution";
      else if (node.type === "load") type = "load";
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

    const edges: SimpleEdge[] = [];
    for (const edge of graph.edges) {
      if (!isEnabled(edge.from.nodeId, scenario) || !isEnabled(edge.to.nodeId, scenario)) continue;
      if (edge.from.nodeId === edge.to.nodeId) continue; // internal wiring ignored

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

      if (fromPort.domain !== SUPPORTED_DOMAIN || toPort.domain !== SUPPORTED_DOMAIN) {
        diagnostics.push({
          severity: "warning",
          code: "EDGE_DOMAIN_UNSUPPORTED",
          message: "Edge domain is not DC_12V; ignored in simple mode.",
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

  private buildAdjacency(edges: SimpleEdge[]) {
    const adjacency = new Map<string, { edge: SimpleEdge; other: string }[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push({ edge, other: edge.to });
      adjacency.get(edge.to)!.push({ edge, other: edge.from });
    }
    console.dir(adjacency);
    return adjacency;
  }

  private buildTree(
    rootId: string,
    adjacency: Map<string, { edge: SimpleEdge; other: string }[]>,
    edges: SimpleEdge[]
  ) {
    const parent = new Map<string, string | null>();
    const parentEdge = new Map<string, SimpleEdge | null>();
    const children = new Map<string, string[]>();
    const postorder: string[] = [];
    const treeEdgeIds = new Set<string>();

    parent.set(rootId, null);
    parentEdge.set(rootId, null);

    const queue: string[] = [rootId];
    while (queue.length) {
      const current = queue.shift() as string;
      const neighbors = adjacency.get(current) ?? [];
      for (const { edge, other } of neighbors) {
        if (parent.has(other)) continue;
        parent.set(other, current);
        parentEdge.set(other, edge);
        treeEdgeIds.add(edge.id);
        queue.push(other);
      }
    }

    for (const [nodeId, parentId] of parent.entries()) {
      if (!parentId) continue;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId)!.push(nodeId);
    }

    const visit = (nodeId: string) => {
      for (const child of children.get(nodeId) ?? []) visit(child);
      postorder.push(nodeId);
    };
    visit(rootId);

    const nonTreeEdges = edges.filter((edge) => !treeEdgeIds.has(edge.id));

    return { parent, parentEdge, children, postorder, nonTreeEdges };
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
  return new SimpleFlowEngine(input).run();
};
