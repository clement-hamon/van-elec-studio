import { computeFlow, type FlowInput } from "../services/flow-engine-simple";

describe("flow-engine-simple", () => {
  it("computes currents for a small 12V tree", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "storage",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 20, nominalV: 12 }
          },
          {
            id: "bus",
            type: "distribution",
            ports: [{ id: "p1", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }]
          },
          {
            id: "load1",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 60 }
          },
          {
            id: "load2",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { amps: 3 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "bus", portId: "p1" }, wire: { maxA: 30 } },
          { id: "e2", from: { nodeId: "bus", portId: "p1" }, to: { nodeId: "load1", portId: "in" }, wire: { maxA: 10 } },
          { id: "e3", from: { nodeId: "bus", portId: "p1" }, to: { nodeId: "load2", portId: "in" }, wire: { maxA: 10 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.bat?.netA).toBeCloseTo(-8);
    expect(result.nodes.load1?.demandW).toBeCloseTo(60);
    expect(result.nodes.load2?.demandW).toBeCloseTo(36);
    expect(result.edges.e1?.currentA).toBeCloseTo(8);
    expect(result.edges.e2?.currentA).toBeCloseTo(5);
    expect(result.edges.e3?.currentA).toBeCloseTo(3);
  });

  it("clamps battery discharge when overloaded", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "storage",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 5 }
          },
          {
            id: "load",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 120 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in" }, wire: { maxA: 20 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("partial");
    expect(result.nodes.bat?.netA).toBeCloseTo(-5);
    expect(result.edges.e1?.currentA).toBeCloseTo(5);
    expect(result.diagnostics.some((d) => d.code === "BATTERY_CLAMPED")).toBe(true);
  });

  it("opens a fuse and unserves downstream loads", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "storage",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 10 }
          },
          {
            id: "fuse",
            type: "distribution",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { ratingA: 2 }
          },
          {
            id: "load",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 60 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "fuse", portId: "in" } },
          { id: "e2", from: { nodeId: "fuse", portId: "in" }, to: { nodeId: "load", portId: "in" } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("partial");
    expect(result.nodes.bat?.netA).toBeCloseTo(0);
    expect(result.edges.e1?.currentA).toBeCloseTo(0);
    expect(result.edges.e2?.currentA).toBeCloseTo(0);
    expect(result.diagnostics.some((d) => d.code === "FUSE_OPEN")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "LOAD_UNSERVED_FUSE")).toBe(true);
  });
});
