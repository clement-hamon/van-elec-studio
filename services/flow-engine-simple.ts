/* =========================================================
 * Simple Flow Engine (12V only)
 * - Compatible signature with flow-engine.ts
 * - Nodes: battery(storage), distribution, load, source
 * - Charging supported, no converters, POS only
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
} from "~/types/flow";

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

type NodeType = "battery" | "distribution" | "load" | "source";

interface SimpleNode {
  id: string;
  type: NodeType;
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

// Convert a load's params into watts (demand side of the balance).
const loadDemandW = (node: SimpleNode, V: number) => {
  const watts = numberParam(node.params, "watts");
  const amps = numberParam(node.params, "amps");
  const duty = numberParam(node.params, "dutyCycle") ?? 1;
  const baseW = typeof watts === "number" ? watts : typeof amps === "number" ? amps * V : 0;
  return Math.max(0, baseW) * Math.max(0, duty);
};

// Convert a source's params into a max available power (watts).
const sourceCapW = (node: SimpleNode, V: number) => {
  const availableW = numberParam(node.params, "availableW");
  const maxOutA = numberParam(node.params, "maxOutA");
  if (typeof availableW === "number") return Math.max(0, availableW);
  if (typeof maxOutA === "number") return Math.max(0, maxOutA) * V;
  return 0;
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

    // Phase 1: map the rich graph into a small 12V POS-only model.
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

    // Phase 2: build a spanning tree from the battery to route currents.
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

    // Phase 3: balance power (sources -> loads, battery fills or absorbs the remainder).
    const balance = this.balance(nodes, tree, battery, V, diagnostics);
    Object.assign(nodesOut, balance.nodeFlows);

    // Phase 4: compute subtree current sums on the tree (positive = demand, negative = supply).
    const subtreeA = new Map<string, number>();
    const subtreeNodes = new Map<string, Set<string>>();
    const blockedNodes = new Set<string>();
    const blownEdges = new Set<string>();

    for (const node of nodes) {
      subtreeA.set(node.id, balance.injectionsA.get(node.id) ?? 0);
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

      // Fuse logic: if subtree current exceeds fuseA, open the fuse and zero that subtree.
      const edge = tree.parentEdge.get(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      const nodeFuseA = numberParam(node?.params, "ratingA");
      const edgeFuseA = edge?.fuseA;
      const fuseA = edgeFuseA ?? nodeFuseA;

      if (edge && fuseA && Math.abs(sum) > fuseA + 1e-6) {
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

    // Assign edge currents from subtree sums.
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

    // Derive battery net current from solved edge flows.
    const edgeById = new Map(this.input.graph.edges.map((edge) => [edge.id, edge]));
    const batteryNetA = this.sumBatteryCurrent(battery.id, edgesOut, edgeById);
    const batteryFlow = nodesOut[battery.id] ?? {};
    nodesOut[battery.id] = {
      ...batteryFlow,
      netA: batteryNetA,
      state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle"
    };

    const hasError = diagnostics.some((d) => d.severity === "error");
    const hasUnserved = balance.hasUnserved || disconnectedLoads.length > 0 || blockedNodes.size > 0;
    const status: FlowOutput["status"] = hasError ? "failed" : hasUnserved ? "partial" : "ok";

    return this.finish(status, diagnostics, edgesOut, nodesOut, balance.totalDemandW, balance.totalSupplyW);
  }

  private resolveVoltage(battery: SimpleNode) {
    const scenarioV = this.scenario.domainVoltage?.[SUPPORTED_DOMAIN];
    if (typeof scenarioV === "number" && scenarioV > 0) return scenarioV;
    const batteryV = numberParam(battery.params, "nominalV");
    if (typeof batteryV === "number" && batteryV > 0) return batteryV;
    return DEFAULT_V;
  }

  // Reduce to a simple model: only DC POS edges and enabled nodes.
  private mapGraph(graph: GraphInput, scenario: ScenarioInput) {
    const diagnostics: Diagnostic[] = [];
    const nodes: SimpleNode[] = [];

    for (const node of graph.nodes) {
      if (!isEnabled(node.id, scenario)) continue;

      let type: NodeType;
      if (node.type === "storage") type = "battery";
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

    const edges: SimpleEdge[] = [];
    for (const edge of graph.edges) {
      if (!isEnabled(edge.from.nodeId, scenario) || !isEnabled(edge.to.nodeId, scenario)) continue;
      if (edge.from.nodeId === edge.to.nodeId) continue; // internal wiring ignored in simple mode

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

  // Undirected adjacency; the flow direction is resolved later from the tree.
  private buildAdjacency(edges: SimpleEdge[]) {
    const adjacency = new Map<string, { edge: SimpleEdge; other: string }[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push({ edge, other: edge.to });
      adjacency.get(edge.to)!.push({ edge, other: edge.from });
    }
    return adjacency;
  }

  // BFS spanning tree: we route all currents through it (parallel paths ignored).
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

  // Determine how much each node injects (+) or supplies (-) in amps.
  // Loads are +A, sources are -A, battery takes the remainder (+charge or -discharge).
  private balance(
    nodes: SimpleNode[],
    tree: ReturnType<SimpleFlowEngine["buildTree"]>,
    battery: SimpleNode,
    V: number,
    diagnostics: Diagnostic[]
  ) {
    const nodeFlows: Record<string, NodeFlow> = {};
    const injectionsA = new Map<string, number>();

    const demandByNode = new Map<string, number>();
    const supplyCapByNode = new Map<string, number>();

    let totalDemandW = 0;
    let connectedDemandW = 0;

    // Build load demand and source capacities (only for connected nodes).
    for (const node of nodes) {
      if (node.type === "load") {
        const demandW = loadDemandW(node, V);
        demandByNode.set(node.id, demandW);
        totalDemandW += demandW;
        if (tree.parent.has(node.id)) connectedDemandW += demandW;
        nodeFlows[node.id] = { demandW };
      }

      if (node.type === "source" && tree.parent.has(node.id)) {
        const capW = sourceCapW(node, V);
        supplyCapByNode.set(node.id, capW);
      }
    }

    const maxDischargeA = numberParam(battery.params, "maxDischargeA") ?? Number.POSITIVE_INFINITY;
    const maxChargeA = numberParam(battery.params, "maxChargeA") ?? maxDischargeA;
    const maxDischargeW = maxDischargeA * V;
    const maxChargeW = maxChargeA * V;

    // If supply+discharge can't cover demand, scale loads proportionally.
    const totalSupplyCapW = Array.from(supplyCapByNode.values()).reduce((a, b) => a + b, 0) + maxDischargeW;
    const servedFactor = connectedDemandW > 0 ? Math.min(1, totalSupplyCapW / connectedDemandW) : 1;
    const servedDemandW = connectedDemandW * servedFactor;

    if (servedFactor < 1) {
      diagnostics.push({
        severity: "warning",
        code: "UNSERVED_DEMAND",
        message: "Demand exceeds available supply; loads scaled proportionally."
      });
    }

    for (const node of nodes) {
      if (node.type !== "load") continue;
      const demandW = demandByNode.get(node.id) ?? 0;
      const servedW = tree.parent.has(node.id) ? demandW * servedFactor : 0;
      injectionsA.set(node.id, V > 0 ? servedW / V : 0);
      if (servedFactor < 1 && servedW < demandW) {
        nodeFlows[node.id] = { ...nodeFlows[node.id], clampedBy: ["supply.shortage"] };
      }
    }

    // Supply budget: cover served demand first, then allow extra for charging if possible.
    const supplyBudgetW = servedDemandW + (servedFactor === 1 ? maxChargeW : 0);
    const sources = Array.from(supplyCapByNode.entries());
    const dispatchPolicy = this.scenario.dispatchPolicy ?? "priority_order";
    const priority = this.scenario.sourcePriority ?? [];

    if (dispatchPolicy === "priority_order" && priority.length > 0) {
      const rank = new Map(priority.map((id, idx) => [id, idx]));
      sources.sort((a, b) => (rank.get(a[0]) ?? 999999) - (rank.get(b[0]) ?? 999999));
    }

    let usedSupplyW = 0;
    if (dispatchPolicy === "share_proportionally") {
      const totalCap = sources.reduce((a, [, cap]) => a + cap, 0);
      for (const [id, cap] of sources) {
        const use = totalCap > 0 ? Math.min(cap, (cap / totalCap) * supplyBudgetW) : 0;
        usedSupplyW += use;
        nodeFlows[id] = { supplyW: use };
        injectionsA.set(id, V > 0 ? -use / V : 0);
      }
    } else {
      let remaining = supplyBudgetW;
      for (const [id, cap] of sources) {
        if (remaining <= 1e-6) {
          nodeFlows[id] = { supplyW: 0 };
          injectionsA.set(id, 0);
          continue;
        }
        const use = Math.min(cap, remaining);
        remaining -= use;
        usedSupplyW += use;
        nodeFlows[id] = { supplyW: use };
        injectionsA.set(id, V > 0 ? -use / V : 0);
      }
    }

    // Battery handles whatever the sources didn't (negative) or excess (positive).
    const netFromSourcesW = usedSupplyW - servedDemandW;
    let batteryNetA = 0;
    const batteryFlow: NodeFlow = {};

    if (netFromSourcesW >= 0) {
      const chargeW = Math.min(netFromSourcesW, maxChargeW);
      batteryNetA = V > 0 ? chargeW / V : 0;
      if (netFromSourcesW - chargeW > 1e-6) {
        diagnostics.push({
          severity: "warning",
          code: "EXCESS_SUPPLY",
          message: "Supply exceeds load and battery charge limit; excess is unused."
        });
        batteryFlow.clampedBy = ["battery.maxChargeA"];
      }
    } else {
      const dischargeW = Math.min(-netFromSourcesW, maxDischargeW);
      batteryNetA = V > 0 ? -dischargeW / V : 0;
      if (servedFactor === 1 && -netFromSourcesW - dischargeW > 1e-6) {
        diagnostics.push({
          severity: "warning",
          code: "UNSERVED_DEMAND",
          message: "Battery discharge limit prevents serving all demand."
        });
        batteryFlow.clampedBy = ["battery.maxDischargeA"];
      }
    }

    nodeFlows[battery.id] = {
      netA: batteryNetA,
      state: batteryNetA > 1e-6 ? "charging" : batteryNetA < -1e-6 ? "discharging" : "idle",
      ...batteryFlow
    };

    const hasUnserved = servedFactor < 1;
    const totalSupplyW = usedSupplyW + Math.max(0, -batteryNetA * V);

    return { injectionsA, nodeFlows, totalDemandW, totalSupplyW, hasUnserved };
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
  return new SimpleFlowEngine(input).run();
};
