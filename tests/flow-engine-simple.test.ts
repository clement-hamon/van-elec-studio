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

  it("sizes cable current from load demand envelope, not wire ampacity", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "fuse",
            type: "distribution",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { ratingA: 40 }
          },
          {
            id: "load",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 60 }
          }
        ],
        edges: [
          {
            id: "e1",
            from: { nodeId: "bat", portId: "p+" },
            to: { nodeId: "fuse", portId: "in" },
            wire: { maxA: 50 },
            protection: { fuseA: 40 }
          },
          { id: "e2", from: { nodeId: "fuse", portId: "in" }, to: { nodeId: "load", portId: "in" }, wire: { maxA: 25 } }
        ]
      },
      scenario: {
        currentComputationMode: "cable_sizing"
      }
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.edges.e1?.currentA).toBeCloseTo(5);
    expect(result.edges.e2?.currentA).toBeCloseTo(5);
    expect(result.edges.e1?.limitedBy).toEqual(["load.maxDemandA"]);
    expect(result.edges.e2?.limitedBy).toEqual(["load.maxDemandA"]);
  });

  it("sizes cable current from charger/source max delivery envelope", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "alt",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 40 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "alt", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 10 } }
        ]
      },
      scenario: {
        currentComputationMode: "cable_sizing",
        domainVoltage: { DC_12V: 12 }
      }
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.edges.e1?.currentA).toBeCloseTo(40);
    expect(result.edges.e1?.limitedBy).toEqual(["source.maxSupplyA"]);
  });

  it("caps charging cable current by battery max charge current", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { nominalV: 12, maxChargeA: 20, maxDischargeA: 120 }
          },
          {
            id: "alt",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 60 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "alt", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {
        currentComputationMode: "cable_sizing",
        domainVoltage: { DC_12V: 12 }
      }
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.edges.e1?.currentA).toBeCloseTo(20);
    expect(result.edges.e1?.limitedBy).toContain("battery.maxChargeA");
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

  it("caps source supply and edge current through converter max output current", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxChargeA: 100, maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "conv",
            type: "conversion",
            ports: [
              { id: "in", domain: "DC_12V", conductor: "POS", dir: "in" },
              { id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }
            ],
            params: { maxOutA: 20, outputV: 12, efficiency: 1 }
          },
          {
            id: "src",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 60 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "conv", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 80 } },
          { id: "e2", from: { nodeId: "src", portId: "out" }, to: { nodeId: "conv", portId: "in" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.src?.supplyW).toBeCloseTo(240);
    expect(Math.abs(result.edges.e1?.currentA ?? 0)).toBeCloseTo(20);
    expect(Math.abs(result.edges.e2?.currentA ?? 0)).toBeCloseTo(20);
  });

  it("caps source supply by maxOutA even when availableW is higher", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxChargeA: 100, maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "src",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { availableW: 1000, maxOutA: 20, outputV: 12 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "src", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.src?.supplyW).toBeCloseTo(240);
    expect(Math.abs(result.edges.e1?.currentA ?? 0)).toBeCloseTo(20);
  });

  it("charges battery when a direct source is connected", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxChargeA: 100, maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "src",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 20 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "src", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.bat?.state).toBe("charging");
    expect(result.nodes.bat?.netA).toBeCloseTo(20);
    expect(result.edges.e1?.currentA).toBeCloseTo(20);
  });

  it("keeps battery charging when source-battery edge endpoints are reversed", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxChargeA: 100, maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "src",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 20 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "src", portId: "out" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.bat?.state).toBe("charging");
    expect(result.nodes.bat?.netA).toBeCloseTo(20);
    expect(result.edges.e1?.currentA).toBeCloseTo(-20);
  });

  it("applies the strictest converter output cap when maxOutW and maxOutA are both defined", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxChargeA: 100, maxDischargeA: 120, nominalV: 12 }
          },
          {
            id: "conv",
            type: "conversion",
            ports: [
              { id: "in", domain: "DC_12V", conductor: "POS", dir: "in" },
              { id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }
            ],
            params: { maxOutW: 400, maxOutA: 20, outputV: 12, efficiency: 1 }
          },
          {
            id: "src",
            type: "source",
            ports: [{ id: "out", domain: "DC_12V", conductor: "POS", dir: "out" }],
            params: { maxOutA: 80 }
          }
        ],
        edges: [
          { id: "e1", from: { nodeId: "conv", portId: "out" }, to: { nodeId: "bat", portId: "p+" }, wire: { maxA: 80 } },
          { id: "e2", from: { nodeId: "src", portId: "out" }, to: { nodeId: "conv", portId: "in" }, wire: { maxA: 80 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(result.nodes.src?.supplyW).toBeCloseTo(240);
    expect(Math.abs(result.edges.e1?.currentA ?? 0)).toBeCloseTo(20);
    expect(Math.abs(result.edges.e2?.currentA ?? 0)).toBeCloseTo(20);
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

  it("flags direct overvoltage regardless of edge endpoint order", () => {
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
          // Same physical link as previous test, reversed edge endpoints.
          { id: "e1", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "solar", portId: "out" } }
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

  it("flags unprotected battery wire regardless of edge endpoint order", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          {
            id: "bat",
            type: "battery",
            ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
            params: { maxDischargeA: 100 }
          },
          {
            id: "load",
            type: "load",
            ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 60 }
          }
        ],
        edges: [
          // Reversed endpoint order: load -> battery.
          { id: "e1", from: { nodeId: "load", portId: "in" }, to: { nodeId: "bat", portId: "p+" }, wire: { lengthM: 1 } }
        ]
      },
      scenario: {}
    };

    const result = computeFlow(input);

    expect(result.diagnostics.some((d: { code: string }) => d.code === "UNPROTECTED_WIRE")).toBe(true);
  });
});
