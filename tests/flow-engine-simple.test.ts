import { computeFlow, type FlowInput } from "../services/flow-engine";

describe("flow-engine", () => {
  it("computes currents for a small 12V tree", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
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
            type: "battery",
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
    expect(result.diagnostics.some((d: { code: string }) => d.code === "UNSERVED_DEMAND")).toBe(true);
  });

  it("opens a fuse and unserves downstream loads", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
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
    expect(result.diagnostics.some((d: { code: string }) => d.code === "FUSE_OPEN")).toBe(true);
    expect(result.diagnostics.some((d: { code: string }) => d.code === "LOAD_UNSERVED_FUSE")).toBe(true);
  });

  it("converts currents across voltage domains through a converter", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 200, nominalV: 12 }
          },
          {
            id: "inv",
            type: "conversion",
            ports: [
              { id: "dc-in", domain: "DC_12V", conductor: "POS", dir: "in" },
              { id: "ac-out", domain: "AC_230V", conductor: "L", dir: "out" }
            ],
            params: { efficiency: 0.9 }
          },
          {
            id: "ac-load",
            type: "load",
            ports: [{ id: "ac-in", domain: "AC_230V", conductor: "L", dir: "in" }],
            params: { amps: 2 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "inv", portId: "dc-in" }, wire: { maxA: 100 } },
          { id: "e2", from: { nodeId: "inv", portId: "ac-out" }, to: { nodeId: "ac-load", portId: "ac-in" }, wire: { maxA: 10 } }
        ]
      },
      scenario: {
        domainVoltage: {
          DC_12V: 12,
          AC_230V: 230
        }
      }
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes["ac-load"]?.demandW).toBeCloseTo(460);
    expect(result.edges.e2?.currentA).toBeCloseTo(2, 3);
    expect(result.edges.e1?.currentA).toBeCloseTo(42.5926, 3);
    expect(result.nodes.bat?.netA).toBeCloseTo(-42.5926, 3);
  });

  it("flags direct overvoltage connection from source to battery", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "dc", conductor: "POS", dir: "bidirectional" }],
            params: { nominalV: 12, maxVoltageV: 14.4, maxDischargeA: 200 }
          },
          {
            id: "solar",
            type: "source",
            ports: [{ id: "out", domain: "dc", conductor: "POS", dir: "out" }],
            params: { availableW: 200, outputV: 18 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "solar", portId: "out" }, to: { nodeId: "bat", portId: "p+" } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((d: { code: string }) => d.code === "EDGE_OVERVOLTAGE_INCOMPATIBLE")).toBe(true);
  });

  it("flags overvoltage through pass-through nodes on charging path", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "dc", conductor: "POS", dir: "bidirectional" }],
            params: { nominalV: 12, maxVoltageV: 14.4, maxDischargeA: 200 }
          },
          {
            id: "fuse",
            type: "distribution",
            ports: [{ id: "in", domain: "dc", conductor: "POS", dir: "in" }],
            params: { ratingA: 20 }
          },
          {
            id: "solar",
            type: "source",
            ports: [{ id: "out", domain: "dc", conductor: "POS", dir: "out" }],
            params: { availableW: 200, outputV: 18 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "solar", portId: "out" }, to: { nodeId: "fuse", portId: "in" } },
          { id: "e2", from: { nodeId: "fuse", portId: "in" }, to: { nodeId: "bat", portId: "p+" } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((d: { code: string }) => d.code === "EDGE_OVERVOLTAGE_INCOMPATIBLE")).toBe(true);
  });
});
