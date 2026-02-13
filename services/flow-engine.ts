/* =========================================================
 * Flow Engine MVP (steady-state DC, planning-grade)
 * ========================================================= */

type NodeType = "source" | "storage" | "conversion" | "distribution" | "load";

type Domain = "DC_12V" | "DC_24V" | "AC_230V" | string;
type Conductor = "POS" | "NEG" | "CHASSIS" | "L" | "N" | "PE";

type Direction = "in" | "out" | "bidirectional";

type Severity = "info" | "warning" | "error";

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

/* =========================================================
 * Helpers
 * ========================================================= */

function defaultVoltageForDomain(domain: Domain): number {
  if (domain === "DC_12V") return 12.8;
  if (domain === "DC_24V") return 25.6;
  if (domain === "AC_230V") return 230;
  return 12.0;
}

function isEnabled(nodeId: string, scenario: ScenarioInput): boolean {
  const e = scenario.enabledNodes?.[nodeId];
  return e !== false;
}

function edgeEnabled(edge: Edge): boolean {
  // if a switch/breaker is modeled in protection, allow disabling the edge
  const enabled = edge.protection?.enabled;
  return enabled !== false;
}

/* =========================================================
 * DSU (Union Find) to build electrical nets per (domain, conductor)
 * ========================================================= */
class DSU {
  parent: number[];
  rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
  }
}

/* =========================================================
 * Domain logic assumptions for MVP:
 *
 * - Solve per domain on POS conductor only.
 * - Within each domain POS net component:
 *   - Loads consume power (W) -> demandW
 *   - Sources provide power (W) -> supplyW (limited)
 *   - Storage (battery) balances remaining (limited charge/discharge)
 * - Cable currents computed on a spanning tree:
 *   - detect cycles; pick BFS tree from chosen root; warn about cycles
 *   - assign subtree power balance; edge current = subtreeW / V
 *
 * - Converters:
 *   - Represent as a node with one input DC domain and one output DC domain (POS+NEG pairs).
 *   - Output demandW causes input demandW += outputW / efficiency
 *   - Limited by maxOutA or maxOutW; report clamping
 * ========================================================= */

/** Identify a converter's input/output domains (MVP heuristic) */
function classifyConverterPorts(node: BaseNode): {
  inPos?: Port;
  outPos?: Port;
  efficiency: number;
  maxOutA?: number;
  maxOutW?: number;
  lossModel: "efficiency";
} {
  const eff = typeof node.params?.efficiency === "number" ? node.params.efficiency : 0.95;
  const maxOutA = typeof node.params?.maxOutA === "number" ? node.params.maxOutA : undefined;
  const maxOutW = typeof node.params?.maxOutW === "number" ? node.params.maxOutW : undefined;

  // MVP heuristic:
  // - choose active conductor ports (POS or L) with dir "in" or "bidirectional" as input candidate
  // - choose active conductor ports (POS or L) with dir "out" or "bidirectional" as output candidate
  const activePorts = node.ports.filter(p => p.conductor === "POS" || p.conductor === "L");
  const inPos = activePorts.find(p => p.dir === "in") ?? activePorts.find(p => p.dir === "bidirectional");
  const outPos = activePorts.find(p => p.dir === "out") ?? activePorts.find(p => p.dir === "bidirectional" && p !== inPos);

  return { inPos, outPos, efficiency: eff, maxOutA, maxOutW, lossModel: "efficiency" };
}

/** Load demand in W (supports either watts or amps param) */
function computeLoadDemandW(node: BaseNode, V: number): number {
  const watts = node.params?.watts;
  const amps = node.params?.amps;
  const duty = typeof node.params?.dutyCycle === "number" ? node.params.dutyCycle : 1.0;

  if (typeof watts === "number") return Math.max(0, watts) * duty;
  if (typeof amps === "number") return Math.max(0, amps) * V * duty;

  // fallback: 0W unknown load
  return 0;
}

/** Source supply capacity in W (supports availableW or maxOutA) */
function computeSourceSupplyCapW(node: BaseNode, V: number): number {
  const availableW = node.params?.availableW; // e.g. PV available power, shore power cap, etc.
  if (typeof availableW === "number") return Math.max(0, availableW);

  const maxOutA = node.params?.maxOutA;
  if (typeof maxOutA === "number") return Math.max(0, maxOutA) * V;

  return 0;
}

/** Storage max discharge/charge in W */
function computeStorageLimitsW(node: BaseNode, V: number): { maxDischargeW: number; maxChargeW: number } {
  const maxDischargeA = typeof node.params?.maxDischargeA === "number" ? node.params.maxDischargeA : 999999;
  const maxChargeA = typeof node.params?.maxChargeA === "number" ? node.params.maxChargeA : 999999;
  return { maxDischargeW: maxDischargeA * V, maxChargeW: maxChargeA * V };
}

/* =========================================================
 * Build indices: ports, endpoints, nets
 * ========================================================= */
type PortKey = string; // `${nodeId}:${portId}`

function portKey(nodeId: string, portId: string): PortKey {
  return `${nodeId}:${portId}`;
}

interface IndexedGraph {
  nodeById: Map<string, BaseNode>;
  portByKey: Map<PortKey, Port>;
  edgeById: Map<string, Edge>;
  // for DSU
  portIndex: Map<PortKey, number>;
  indexToPortKey: PortKey[];
}

/** Index nodes/ports/edges */
function indexGraph(graph: GraphInput): IndexedGraph {
  const nodeById = new Map<string, BaseNode>();
  const portByKey = new Map<PortKey, Port>();
  const edgeById = new Map<string, Edge>();

  const portIndex = new Map<PortKey, number>();
  const indexToPortKey: PortKey[] = [];

  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
    for (const p of n.ports) {
      const k = portKey(n.id, p.id);
      portByKey.set(k, p);
      portIndex.set(k, indexToPortKey.length);
      indexToPortKey.push(k);
    }
  }

  for (const e of graph.edges) edgeById.set(e.id, e);

  return { nodeById, portByKey, edgeById, portIndex, indexToPortKey };
}

/** Net id is DSU root + domain+conductor scope */
type NetId = string; // `${domain}|${conductor}|${rootIndex}`

function makeNetId(domain: Domain, conductor: Conductor, root: number): NetId {
  return `${domain}|${conductor}|${root}`;
}

interface NetBuildResult {
  netOfPort: Map<PortKey, NetId>;
  nets: Set<NetId>;
  diagnostics: Diagnostic[];
  cyclesDetected: Set<string>; // key by `${domain}|${conductor}|componentRoot` (for reporting)
}

/** Build nets by unioning ports connected by enabled edges for same (domain, conductor). */
function buildNets(ix: IndexedGraph, scenario: ScenarioInput): NetBuildResult {
  const diag: Diagnostic[] = [];
  const dsu = new DSU(ix.indexToPortKey.length);

  // Union endpoints when:
  // - edge enabled
  // - both ports exist
  // - same domain + conductor
  // - SAME NODE (internal connections only)
  for (const e of ix.edgeById.values()) {
    if (!edgeEnabled(e)) continue;

    const kA = portKey(e.from.nodeId, e.from.portId);
    const kB = portKey(e.to.nodeId, e.to.portId);
    const pA = ix.portByKey.get(kA);
    const pB = ix.portByKey.get(kB);

    if (!pA || !pB) {
      diag.push({
        severity: "error",
        code: "EDGE_ENDPOINT_MISSING",
        message: "An edge endpoint port is missing.",
        refs: [{ edgeId: e.id }]
      });
      continue;
    }

    // Gate by enabled nodes (if node disabled, treat as disconnected)
    if (!isEnabled(e.from.nodeId, scenario) || !isEnabled(e.to.nodeId, scenario)) continue;

    if (pA.domain !== pB.domain || pA.conductor !== pB.conductor) {
      // This is typically invalid wiring; rule engine should catch.
      // For flow engine, we DO NOT union, we report and ignore union.
      diag.push({
        severity: "warning",
        code: "CROSS_DOMAIN_OR_CONDUCTOR_EDGE",
        message: "Edge connects ports with different domain or conductor; flow engine will ignore union.",
        refs: [{ edgeId: e.id, domain: pA.domain }]
      });
      continue;
    }

    // ONLY union ports on the same node (internal connections)
    // Inter-node connections create adjacency edges in the net graph
    if (e.from.nodeId === e.to.nodeId) {
      const iA = ix.portIndex.get(kA)!;
      const iB = ix.portIndex.get(kB)!;
      dsu.union(iA, iB);
    }
  }

  const netOfPort = new Map<PortKey, NetId>();
  const nets = new Set<NetId>();

  for (const [k, idx] of ix.portIndex.entries()) {
    const p = ix.portByKey.get(k)!;
    const root = dsu.find(idx);

    const netId = makeNetId(p.domain, p.conductor, root);
    netOfPort.set(k, netId);
    nets.add(netId);
  }

  return { netOfPort, nets, diagnostics: diag, cyclesDetected: new Set() };
}

/* =========================================================
 * Component graph (nets as vertices, edges are cables between nets)
 * We solve per (domain, POS).
 * ========================================================= */

interface NetAdjEdge {
  edgeId: string;
  a: NetId;
  b: NetId;
  wireMaxA?: number;
  fuseA?: number;
}

interface DomainComponent {
  domain: Domain;
  nets: NetId[];                 // POS nets only in this component
  adjacency: Map<NetId, NetAdjEdge[]>;
  // supply/demand in W at net level (POS)
  demandW: Map<NetId, number>;
  supplyCapW: Map<NetId, number>; // from sources (not storage)
  // storage nets (batteries) with limits
  storage: { net: NetId; nodeId: string; maxDischargeW: number; maxChargeW: number }[];
  // mapping for reporting
  netVoltage: number;
}

/** Extract POS network for a domain and build components */
function buildDomainComponents(ix: IndexedGraph, netOfPort: Map<PortKey, NetId>, scenario: ScenarioInput): {
  components: DomainComponent[];
  diagnostics: Diagnostic[];
  nodePrimaryPosNet: Map<string, NetId>; // used to place node demand/supply on a net
} {
  const diagnostics: Diagnostic[] = [];
  const nodePrimaryPosNet = new Map<string, NetId>();

  // Helper: pick a node's primary POS port net for a given domain (MVP: first POS port)
  function pickPrimaryPosNet(node: BaseNode): NetId | undefined {
    const p = node.ports.find(pp => pp.conductor === "POS" || pp.conductor === "L");
    if (!p) return undefined;
    return netOfPort.get(portKey(node.id, p.id));
  }

  // Build net-to-net adjacency for POS only, grouped by domain.
  const adjByDomain = new Map<Domain, Map<NetId, NetAdjEdge[]>>();
  const posNetsByDomain = new Map<Domain, Set<NetId>>();

  for (const e of ix.edgeById.values()) {
    if (!edgeEnabled(e)) continue;
    if (!isEnabled(e.from.nodeId, scenario) || !isEnabled(e.to.nodeId, scenario)) continue;
    const kA = portKey(e.from.nodeId, e.from.portId);
    const kB = portKey(e.to.nodeId, e.to.portId);
    const pA = ix.portByKey.get(kA);
    const pB = ix.portByKey.get(kB);
    if (!pA || !pB) continue;
    
    const activeA = pA.conductor === "POS" || pA.conductor === "L";
    const activeB = pB.conductor === "POS" || pB.conductor === "L";
    if (!activeA || !activeB) continue;
    if (pA.domain !== pB.domain) continue;
    
    const netA = netOfPort.get(kA)!;
    const netB = netOfPort.get(kB)!;

    if (netA === netB) continue; // same net, internal wire; ignore for adjacency

    const domain = pA.domain;

    if (!adjByDomain.has(domain)) adjByDomain.set(domain, new Map());
    if (!posNetsByDomain.has(domain)) posNetsByDomain.set(domain, new Set());

    posNetsByDomain.get(domain)!.add(netA);
    posNetsByDomain.get(domain)!.add(netB);

    const adj = adjByDomain.get(domain)!;
    if (!adj.has(netA)) adj.set(netA, []);
    if (!adj.has(netB)) adj.set(netB, []);

    const ne: NetAdjEdge = {
      edgeId: e.id,
      a: netA,
      b: netB,
      wireMaxA: e.wire?.maxA,
      fuseA: e.protection?.fuseA
    };

    adj.get(netA)!.push(ne);
    adj.get(netB)!.push(ne);
  }

  // Assign node primary nets and compute per-net demand/supply/storage
  // We do this later per component, but we need a map.
  for (const node of ix.nodeById.values()) {
    if (!isEnabled(node.id, scenario)) continue;
    const pn = pickPrimaryPosNet(node);
    if (pn) nodePrimaryPosNet.set(node.id, pn);
  }

  // Build connected components (POS nets) for each domain
  const components: DomainComponent[] = [];
  for (const [domain, netsSet] of posNetsByDomain.entries()) {
    const netVoltage = scenario.domainVoltage?.[domain] ?? defaultVoltageForDomain(domain);
    const adj = adjByDomain.get(domain)!;

    const visited = new Set<NetId>();
    for (const startNet of netsSet) {
      if (visited.has(startNet)) continue;

      // BFS to collect component
      const q: NetId[] = [startNet];
      visited.add(startNet);
      const compNets: NetId[] = [];
      const compAdj = new Map<NetId, NetAdjEdge[]>();

      while (q.length) {
        const n = q.shift()!;
        compNets.push(n);
        const edges = adj.get(n) ?? [];
        compAdj.set(n, edges);

        for (const ed of edges) {
          const other = ed.a === n ? ed.b : ed.a;
          if (!visited.has(other)) {
            visited.add(other);
            q.push(other);
          }
        }
      }

      const demandW = new Map<NetId, number>();
      const supplyCapW = new Map<NetId, number>();
      const storage: DomainComponent["storage"] = [];

      // Initialize maps
      for (const n of compNets) {
        demandW.set(n, 0);
        supplyCapW.set(n, 0);
      }

      // Place node effects onto nets (MVP: uses primary POS net)
      for (const node of ix.nodeById.values()) {
        if (!isEnabled(node.id, scenario)) continue;
        const posNet = nodePrimaryPosNet.get(node.id);
        if (!posNet) continue;
        if (!compNets.includes(posNet)) continue;

        if (node.type === "load") {
          const W = computeLoadDemandW(node, netVoltage);
          demandW.set(posNet, (demandW.get(posNet) ?? 0) + W);
        }

        if (node.type === "source") {
          const capW = computeSourceSupplyCapW(node, netVoltage);
          supplyCapW.set(posNet, (supplyCapW.get(posNet) ?? 0) + capW);
        }

        if (node.type === "storage") {
          const lim = computeStorageLimitsW(node, netVoltage);
          storage.push({ net: posNet, nodeId: node.id, ...lim });
        }
      }

      components.push({
        domain,
        nets: compNets,
        adjacency: compAdj,
        demandW,
        supplyCapW,
        storage,
        netVoltage
      });
    }
  }

  return { components, diagnostics, nodePrimaryPosNet };
}

/* =========================================================
 * Converter propagation (cross-domain)
 *
 * We treat converter output demand as creating input demand / eff.
 * We do NOT route currents across domains here; we convert power.
 * ========================================================= */
function applyConverters(
  ix: IndexedGraph,
  netOfPort: Map<PortKey, NetId>,
  components: DomainComponent[],
  scenario: ScenarioInput
): { diagnostics: Diagnostic[]; lossesWByDomain: Map<Domain, number>; nodeFlows: Map<string, NodeFlow> } {
  const diagnostics: Diagnostic[] = [];
  const lossesWByDomain = new Map<Domain, number>();
  const nodeFlows = new Map<string, NodeFlow>();

  // Build quick lookup: netId -> component
  const compByPosNet = new Map<NetId, DomainComponent>();
  for (const c of components) for (const n of c.nets) compByPosNet.set(n, c);

  for (const node of ix.nodeById.values()) {
    if (!isEnabled(node.id, scenario)) continue;
    if (node.type !== "conversion") continue;

    const { inPos, outPos, efficiency, maxOutA, maxOutW } = classifyConverterPorts(node);

    if (!inPos || !outPos) {
      diagnostics.push({
        severity: "warning",
        code: "CONVERTER_PORTS_UNCLEAR",
        message: "Converter ports (in/out) could not be identified; ignoring converter in flow propagation.",
        refs: [{ nodeId: node.id }]
      });
      continue;
    }

    const inNet = netOfPort.get(portKey(node.id, inPos.id));
    const outNet = netOfPort.get(portKey(node.id, outPos.id));
    if (!inNet || !outNet) continue;

    const outComp = compByPosNet.get(outNet);
    const inComp = compByPosNet.get(inNet);

    // If converter ports are not in POS components (e.g. AC), ignore in MVP
    if (!outComp || !inComp) continue;

    const Vout = outComp.netVoltage;
    // const Vin = inComp.netVoltage;

    // Determine output demand placed on outNet already (by loads etc.)
    // We interpret converter as supplying outNet demand up to its capability.
    // For MVP: converter acts like a "source" on outNet with cap defined by maxOutA/W (or infinite if unspecified).
    const outDemandW = outComp.demandW.get(outNet) ?? 0;

    let outCapW = Number.POSITIVE_INFINITY;
    if (typeof maxOutW === "number") outCapW = Math.min(outCapW, maxOutW);
    if (typeof maxOutA === "number") outCapW = Math.min(outCapW, maxOutA * Vout);

    const eff = Math.max(0.01, Math.min(1, efficiency));

    const outServedW = Math.min(outDemandW, outCapW);
    const outUnservedW = outDemandW - outServedW;

    if (outUnservedW > 1e-6) {
      diagnostics.push({
        severity: "warning",
        code: "CONVERTER_CLAMPED",
        message: `Converter cannot meet downstream demand. Served ${outServedW.toFixed(
          1
        )}W of ${outDemandW.toFixed(1)}W.`,
        refs: [{ nodeId: node.id, domain: outComp.domain }]
      });
    }

    // Reduce demand on outNet by what converter serves (it becomes "supply" effectively)
    outComp.demandW.set(outNet, outDemandW - outServedW);

    // Add required input demand to inNet (power in = power out / eff)
    const inRequiredW = outServedW / eff;
    inComp.demandW.set(inNet, (inComp.demandW.get(inNet) ?? 0) + inRequiredW);
    const lossW = inRequiredW - outServedW;
    lossesWByDomain.set(inComp.domain, (lossesWByDomain.get(inComp.domain) ?? 0) + lossW);

    // Optional explicit charge demand (used for split batteries)
    const chargeDemandA =
      typeof node.params?.chargeDemandA === "number" ? node.params.chargeDemandA : undefined;
    const chargeDemandW =
      typeof node.params?.chargeDemandW === "number" ? node.params.chargeDemandW : undefined;

    let chargeClamped = false;
    if ((typeof chargeDemandA === "number" && chargeDemandA > 0) || (typeof chargeDemandW === "number" && chargeDemandW > 0)) {
      const rawChargeOutW =
        typeof chargeDemandW === "number" ? chargeDemandW : (chargeDemandA as number) * Vout;
      const remainingCapW = Math.max(0, outCapW - outServedW);
      const chargeOutW = Math.min(rawChargeOutW, remainingCapW);
      if (rawChargeOutW - chargeOutW > 1e-6) {
        chargeClamped = true;
        diagnostics.push({
          severity: "warning",
          code: "CONVERTER_CHARGE_CLAMPED",
          message: `Converter cannot meet requested charge demand. Served ${chargeOutW.toFixed(
            1
          )}W of ${rawChargeOutW.toFixed(1)}W.`,
          refs: [{ nodeId: node.id, domain: outComp.domain }]
        });
      }

      if (chargeOutW > 1e-6) {
        const chargeInW = chargeOutW / eff;
        inComp.demandW.set(inNet, (inComp.demandW.get(inNet) ?? 0) + chargeInW);
        const chargeLossW = chargeInW - chargeOutW;
        lossesWByDomain.set(inComp.domain, (lossesWByDomain.get(inComp.domain) ?? 0) + chargeLossW);
      }
    }

    const clampedBy: string[] = [];
    if (outUnservedW > 1e-6 || chargeClamped) clampedBy.push("converter.maxOut");

    nodeFlows.set(node.id, {
      clampedBy: clampedBy.length ? clampedBy : undefined
    });

    // Note: We did not model where converter gets its input supply (battery vs other sources);
    // that happens when solving the input domain component.
    // We also didn't add "supplyCapW" to outNet; we directly reduced outNet demand.
  }

  return { diagnostics, lossesWByDomain, nodeFlows };
}

/* =========================================================
 * Solve one domain component via spanning tree power balance
 * ========================================================= */

// interface TreeEdge {
//   parent: NetId;
//   child: NetId;
//   via: NetAdjEdge; // cable used to connect
// }

function solveComponent(
  comp: DomainComponent,
  scenario: ScenarioInput,
  nodePrimaryPosNet: Map<string, NetId>,
  ix: IndexedGraph,
  netOfPort: Map<PortKey, NetId>
): {
  edgeFlows: Map<string, EdgeFlow>;
  nodeFlows: Map<string, NodeFlow>;
  diagnostics: Diagnostic[];
  totals: { loadW: number; supplyW: number; lossW: number };
} {
  const diagnostics: Diagnostic[] = [];
  const edgeFlows = new Map<string, EdgeFlow>();
  const nodeFlows = new Map<string, NodeFlow>();

  const V = comp.netVoltage;

  // Total loadW (net demand before supply dispatch)
  const baseLoadW = Array.from(comp.demandW.values()).reduce((a, b) => a + b, 0);

  // Determine supplies by policy
  // - Non-storage sources contribute up to supplyCapW
  // - Storage balances remainder (clamped by charge/discharge)
  //
  // For spanning tree we want a root net. Choose:
  // 1) highest priority enabled source net if present
  // 2) else first storage net
  // 3) else arbitrary net

  const supplyNets: { net: NetId; capW: number; sourceNodeIds: string[] }[] = [];
  const netToSourceNodes = new Map<NetId, string[]>();

  // Build mapping of source nodes to nets
  for (const node of ix.nodeById.values()) {
    if (!isEnabled(node.id, scenario)) continue;
    if (node.type !== "source") continue;
    const pn = nodePrimaryPosNet.get(node.id);
    if (!pn) continue;
    if (!comp.nets.includes(pn)) continue;

    const capW = computeSourceSupplyCapW(node, V);
    if (capW <= 0) continue;

    if (!netToSourceNodes.has(pn)) netToSourceNodes.set(pn, []);
    netToSourceNodes.get(pn)!.push(node.id);
  }

  for (const [net, ids] of netToSourceNodes.entries()) {
    const capW = comp.supplyCapW.get(net) ?? 0;
    supplyNets.push({ net, capW, sourceNodeIds: ids });
  }

  // Root selection based on priority list
  const priority = scenario.sourcePriority ?? [];
  const priorityNet = (() => {
    for (const srcId of priority) {
      const pn = nodePrimaryPosNet.get(srcId);
      if (pn && comp.nets.includes(pn)) return pn;
    }
    return undefined;
  })();

  const root: NetId =
    priorityNet ??
    comp.storage[0]?.net ??
    comp.nets[0];

  // Detect cycles: edges count vs nodes count in component (rough test)
  // A connected undirected graph has a cycle if |E| >= |V|
  const uniqueEdges = new Set<string>();
  for (const n of comp.nets) {
    for (const e of comp.adjacency.get(n) ?? []) uniqueEdges.add(e.edgeId);
  }
  if (uniqueEdges.size >= comp.nets.length) {
    diagnostics.push({
      severity: "warning",
      code: "CYCLE_DETECTED",
      message: "Cycle detected in wiring graph; flow engine will pick a spanning tree for current allocation (results may differ from real parallel-path sharing).",
      refs: [{ domain: comp.domain }]
    });
  }

  // Build BFS spanning tree
  const parent = new Map<NetId, NetId | null>();
  const parentEdge = new Map<NetId, NetAdjEdge | null>();
  parent.set(root, null);
  parentEdge.set(root, null);

  const q: NetId[] = [root];
  while (q.length) {
    const u = q.shift()!;
    for (const ae of comp.adjacency.get(u) ?? []) {
      const v = ae.a === u ? ae.b : ae.a;
      if (!comp.nets.includes(v)) continue;
      if (parent.has(v)) continue;
      parent.set(v, u);
      parentEdge.set(v, ae);
      q.push(v);
    }
  }

  // If some nets unreachable (disconnected), mark partial
  for (const n of comp.nets) {
    if (!parent.has(n)) {
      diagnostics.push({
        severity: "warning",
        code: "DISCONNECTED_SUBGRAPH",
        message: "Some nets are disconnected from the chosen root; their demands may be unserved.",
        refs: [{ domain: comp.domain }]
      });
    }
  }

  // Supply dispatch:
  // We convert supplies into "negative demand" (i.e. net injection).
  // Later we compute subtree sum -> edge currents.
  //
  // For MVP, implement:
  // - priority_order: allocate supplies in priority order of source nodes if provided else arbitrary
  // - share_proportionally: allocate all sources proportionally to their caps
  //
  // Storage then balances remainder at its net (as injection or absorption) within limits.

  const netBalanceW = new Map<NetId, number>(); // + means needs power, - means has extra supply
  for (const n of comp.nets) netBalanceW.set(n, comp.demandW.get(n) ?? 0);

  const totalDemandW = Array.from(netBalanceW.values()).reduce((a, b) => a + b, 0);

  // Flatten sources in desired order
  const orderedSources: { nodeId: string; net: NetId; capW: number }[] = [];
  for (const s of supplyNets) {
    for (const id of s.sourceNodeIds) orderedSources.push({ nodeId: id, net: s.net, capW: computeSourceSupplyCapW(ix.nodeById.get(id)!, V) });
  }

  // Sort by priority list if provided
  if ((scenario.dispatchPolicy ?? "priority_order") === "priority_order" && priority.length) {
    const rank = new Map<string, number>();
    priority.forEach((id, i) => rank.set(id, i));
    orderedSources.sort((a, b) => (rank.get(a.nodeId) ?? 999999) - (rank.get(b.nodeId) ?? 999999));
  }

  let remainingDemandW = totalDemandW;
  let usedSupplyW = 0;

  if ((scenario.dispatchPolicy ?? "priority_order") === "share_proportionally") {
    const totalCap = orderedSources.reduce((a, s) => a + s.capW, 0);
    if (totalCap > 0) {
      for (const s of orderedSources) {
        const share = (s.capW / totalCap) * totalDemandW;
        const use = Math.min(s.capW, share);
        netBalanceW.set(s.net, (netBalanceW.get(s.net) ?? 0) - use);
        usedSupplyW += use;
        remainingDemandW -= use;
        nodeFlows.set(s.nodeId, { supplyW: use });
      }
    }
  } else {
    // priority_order
    for (const s of orderedSources) {
      if (remainingDemandW <= 1e-6) {
        nodeFlows.set(s.nodeId, { supplyW: 0 });
        continue;
      }
      const use = Math.min(s.capW, remainingDemandW);
      netBalanceW.set(s.net, (netBalanceW.get(s.net) ?? 0) - use);
      usedSupplyW += use;
      remainingDemandW -= use;
      nodeFlows.set(s.nodeId, { supplyW: use });
    }
  }

  // Storage balancing: use first storage as slack (MVP). You can extend to multiple batteries later.
  let batteryNetW = 0;
  if (comp.storage.length) {
    const batt = comp.storage[0];
    if (remainingDemandW > 1e-6) {
      // discharging
      const dischargeW = Math.min(remainingDemandW, batt.maxDischargeW);
      netBalanceW.set(batt.net, (netBalanceW.get(batt.net) ?? 0) - dischargeW);
      batteryNetW = -dischargeW; // negative means supplying power to network
      remainingDemandW -= dischargeW;
      nodeFlows.set(batt.nodeId, { netA: -(dischargeW / V), state: dischargeW > 1e-6 ? "discharging" : "idle" });
      if (remainingDemandW > 1e-6) {
        diagnostics.push({
          severity: "warning",
          code: "UNSERVED_DEMAND",
          message: `Demand exceeds supply + battery discharge limit by ${remainingDemandW.toFixed(1)}W.`,
          refs: [{ nodeId: batt.nodeId, domain: comp.domain }]
        });
      }
    } else if (remainingDemandW < -1e-6) {
      // excess supply; charge battery (negative remainingDemandW means supply exceeded demand)
      const excessW = -remainingDemandW;
      const chargeW = Math.min(excessW, batt.maxChargeW);
      netBalanceW.set(batt.net, (netBalanceW.get(batt.net) ?? 0) + chargeW); // battery absorbs power => increases net demand
      batteryNetW = +chargeW;
      remainingDemandW += chargeW;
      nodeFlows.set(batt.nodeId, { netA: +(chargeW / V), state: chargeW > 1e-6 ? "charging" : "idle" });
      // if still excess, we just "waste" it for MVP
    } else {
      nodeFlows.set(batt.nodeId, { netA: 0, state: "idle" });
    }
  } else {
    if (remainingDemandW > 1e-6) {
      diagnostics.push({
        severity: "warning",
        code: "NO_STORAGE_AND_INSUFFICIENT_SUPPLY",
        message: `Demand exceeds supply by ${remainingDemandW.toFixed(1)}W and no storage is present to balance.`,
        refs: [{ domain: comp.domain }]
      });
    }
  }

  // Record load node flows for explainability
  for (const node of ix.nodeById.values()) {
    if (!isEnabled(node.id, scenario)) continue;
    if (node.type !== "load") continue;
    const pn = nodePrimaryPosNet.get(node.id);
    if (!pn || !comp.nets.includes(pn)) continue;
    nodeFlows.set(node.id, { demandW: computeLoadDemandW(node, V) });
  }

  // Compute subtree sums for spanning tree (postorder)
  const children = new Map<NetId, NetId[]>();
  for (const n of comp.nets) children.set(n, []);
  for (const [n, p] of parent.entries()) {
    if (p && children.has(p)) children.get(p)!.push(n);
  }

  const postorder: NetId[] = [];
  function dfs(u: NetId) {
    for (const v of children.get(u) ?? []) dfs(v);
    postorder.push(u);
  }
  dfs(root);

  const subtreeW = new Map<NetId, number>();
  for (const n of comp.nets) subtreeW.set(n, netBalanceW.get(n) ?? 0);
  for (const u of postorder) {
    const sumChildren = (children.get(u) ?? []).reduce((a, v) => a + (subtreeW.get(v) ?? 0), 0);
    subtreeW.set(u, (subtreeW.get(u) ?? 0) + sumChildren);
  }

  // Assign currents to tree edges
  for (const n of comp.nets) {
    const p = parent.get(n);
    const pe = parentEdge.get(n);
    if (!p || !pe) continue; // root or disconnected

    // Interpretation:
    // subtreeW(n) is net power demand of the child subtree after supply injections.
    // If subtreeW(n) > 0 => parent must deliver power to child.
    // If subtreeW(n) < 0 => child subtree has excess supply => flows from child to parent.
    const Wflow = subtreeW.get(n) ?? 0;
    const I = Wflow / V;

    // Determine sign relative to cable edge orientation (edge.from -> edge.to)
    // Our tree edge is undirected between nets. We need to map to the actual edge direction:
    // If cable is defined from netA->netB based on edge endpoints, use that to sign.
    const actualEdge = ix.edgeById.get(pe.edgeId)!;

    const fromNet = (() => {
      const fk = portKey(actualEdge.from.nodeId, actualEdge.from.portId);
      return netOfPort.get(fk)!;
    })();
    const toNet = (() => {
      const tk = portKey(actualEdge.to.nodeId, actualEdge.to.portId);
      return netOfPort.get(tk)!;
    })();

    // Our conceptual flow is parent -> child if Wflow>0, else child -> parent.
    const conceptualFrom = Wflow >= 0 ? p : n;
    const conceptualTo = Wflow >= 0 ? n : p;

    let signedI = Math.abs(I);
    // Map conceptual direction onto actual edge direction
    if (!(fromNet === conceptualFrom && toNet === conceptualTo)) {
      // if actual matches reversed, sign is negative
      if (fromNet === conceptualTo && toNet === conceptualFrom) signedI = -signedI;
      else {
        // Shouldn't happen if nets resolved correctly; mark diagnostic
        diagnostics.push({
          severity: "warning",
          code: "EDGE_NET_DIRECTION_MISMATCH",
          message: "Edge/net direction mismatch while assigning flow; sign may be incorrect.",
          refs: [{ edgeId: pe.edgeId, domain: comp.domain }]
        });
      }
    }

    const maxA = actualEdge.wire?.maxA;
    const utilization = maxA ? Math.min(999, Math.abs(signedI) / maxA) : undefined;

    const limitedBy: string[] = [];
    if (maxA && Math.abs(signedI) > maxA + 1e-6) limitedBy.push("wire.maxA");
    if (actualEdge.protection?.fuseA && Math.abs(signedI) > actualEdge.protection.fuseA + 1e-6) limitedBy.push("fuseA");

    edgeFlows.set(pe.edgeId, {
      currentA: signedI,
      utilization,
      limitedBy: limitedBy.length ? limitedBy : undefined
    });
  }

  // Any cable not in tree gets 0A (MVP). In real life, parallel paths share current.
  for (const eId of uniqueEdges) {
    if (!edgeFlows.has(eId)) {
      edgeFlows.set(eId, { currentA: 0 });
    }
  }

  const totals = {
    loadW: baseLoadW,
    supplyW: usedSupplyW + (-batteryNetW > 0 ? -batteryNetW : 0), // battery discharge counts as supply
    lossW: 0 // converters losses tracked separately
  };

  return { edgeFlows, nodeFlows, diagnostics, totals };
}

/* =========================================================
 * Main entry
 * ========================================================= */

export function computeFlow(input: FlowInput): FlowOutput {
  const { graph, scenario } = input;
  const ix = indexGraph(graph);

  const edgesOut: Record<string, EdgeFlow> = {};
  const nodesOut: Record<string, NodeFlow> = {};
  const diagnostics: Diagnostic[] = [];

  // 1) Build nets
  const netRes = buildNets(ix, scenario);
  diagnostics.push(...netRes.diagnostics);

  // 2) Build domain components (POS only)
  const compRes = buildDomainComponents(ix, netRes.netOfPort, scenario);
  diagnostics.push(...compRes.diagnostics);

  // 3) Apply converters (cross-domain power propagation)
  const convRes = applyConverters(ix, netRes.netOfPort, compRes.components, scenario);
  diagnostics.push(...convRes.diagnostics);

  // 4) Solve each domain component
  const totalsByDomain: Record<string, { loadW: number; supplyW: number; lossW: number }> = {};

  for (const comp of compRes.components) {
    const solved = solveComponent(comp, scenario, compRes.nodePrimaryPosNet, ix, netRes.netOfPort);
    diagnostics.push(...solved.diagnostics);

    // merge edge flows (if edges appear in multiple domains, last wins; usually they won't)
    for (const [eid, ef] of solved.edgeFlows.entries()) edgesOut[eid] = ef;

    // merge node flows
    for (const [nid, nf] of solved.nodeFlows.entries()) {
      nodesOut[nid] = { ...(nodesOut[nid] ?? {}), ...nf };
    }

    const lossW = convRes.lossesWByDomain.get(comp.domain) ?? 0;

    totalsByDomain[comp.domain] = totalsByDomain[comp.domain] ?? { loadW: 0, supplyW: 0, lossW: 0 };
    totalsByDomain[comp.domain].loadW += solved.totals.loadW;
    totalsByDomain[comp.domain].supplyW += solved.totals.supplyW;
    totalsByDomain[comp.domain].lossW += lossW;
  }

  // add converter node flows
  for (const [nid, nf] of convRes.nodeFlows.entries()) {
    nodesOut[nid] = { ...(nodesOut[nid] ?? {}), ...nf };
  }

  // Determine status
  const hasError = diagnostics.some(d => d.severity === "error");
  const hasUnserved = diagnostics.some(d => d.code === "UNSERVED_DEMAND" || d.code === "NO_STORAGE_AND_INSUFFICIENT_SUPPLY");
  const status: FlowOutput["status"] = hasError ? "failed" : hasUnserved ? "partial" : "ok";

  return {
    status,
    diagnostics,
    edges: edgesOut,
    nodes: nodesOut,
    totals: { byDomain: totalsByDomain }
  };
}
