import { computeFlow, type FlowInput } from "../services/flow-engine";

function run(input: FlowInput) {
  return computeFlow(input);
}

// Test 1: Simple battery -> load (original test)
const test1: FlowInput = {
  graph: {
    nodes: [
      {
        id: "bat1",
        type: "storage",
        ports: [
          { id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" },
          { id: "p-", domain: "DC_12V", conductor: "NEG", dir: "bidirectional" }
        ],
        params: { nominalV: 12.8, maxDischargeA: 200, maxChargeA: 100 }
      },
      {
        id: "bus_pos",
        type: "distribution",
        ports: [{ id: "in", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxA: 300 }
      },
      {
        id: "fridge",
        type: "load",
        ports: [
          { id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" },
          { id: "in-", domain: "DC_12V", conductor: "NEG", dir: "in" }
        ],
        params: { watts: 60, dutyCycle: 1.0 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "bat1", portId: "p+" },
        to: { nodeId: "bus_pos", portId: "in" },
        wire: { maxA: 200, lengthM: 1 },
        protection: { fuseA: 200 }
      },
      {
        id: "e2",
        from: { nodeId: "bus_pos", portId: "in" },
        to: { nodeId: "fridge", portId: "in+" },
        wire: { maxA: 20, lengthM: 5 },
        protection: { fuseA: 15 }
      }
    ]
  },
  scenario: {
    enabledNodes: { fridge: true, bat1: true },
    dispatchPolicy: "priority_order",
    sourcePriority: ["bat1"]
  }
};

// Test 2: Multiple loads on same battery
const test2: FlowInput = {
  graph: {
    nodes: [
      {
        id: "bat1",
        type: "storage",
        ports: [
          { id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" },
          { id: "p-", domain: "DC_12V", conductor: "NEG", dir: "bidirectional" }
        ],
        params: { maxDischargeA: 100, maxChargeA: 50 }
      },
      {
        id: "busbar",
        type: "distribution",
        ports: [{ id: "p1", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: {}
      },
      {
        id: "lights",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 30 }
      },
      {
        id: "fridge",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 60 }
      },
      {
        id: "water_pump",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { amps: 5, dutyCycle: 0.3 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "bat1", portId: "p+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 150 }
      },
      {
        id: "e2",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "lights", portId: "in+" },
        wire: { maxA: 10 }
      },
      {
        id: "e3",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "fridge", portId: "in+" },
        wire: { maxA: 20 }
      },
      {
        id: "e4",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "water_pump", portId: "in+" },
        wire: { maxA: 15 }
      }
    ]
  },
  scenario: {
    enabledNodes: { lights: true, fridge: true, water_pump: true }
  }
};

// Test 3: Solar + Battery with charging scenario
const test3: FlowInput = {
  graph: {
    nodes: [
      {
        id: "solar",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { availableW: 200 }
      },
      {
        id: "bat1",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 100, maxChargeA: 40 }
      },
      {
        id: "load1",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 50 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "solar", portId: "out+" },
        to: { nodeId: "bat1", portId: "p+" },
        wire: { maxA: 50 }
      },
      {
        id: "e2",
        from: { nodeId: "bat1", portId: "p+" },
        to: { nodeId: "load1", portId: "in+" },
        wire: { maxA: 30 }
      }
    ]
  },
  scenario: {
    sourcePriority: ["solar", "bat1"]
  }
};

// Test 4: DC-DC converter scenario (12V to 24V)
const test4: FlowInput = {
  graph: {
    nodes: [
      {
        id: "bat_12v",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 100 }
      },
      {
        id: "dc_dc_converter",
        type: "conversion",
        ports: [
          { id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" },
          { id: "out+", domain: "DC_24V", conductor: "POS", dir: "out" }
        ],
        params: { efficiency: 0.92, maxOutA: 20 }
      },
      {
        id: "load_24v",
        type: "load",
        ports: [{ id: "in+", domain: "DC_24V", conductor: "POS", dir: "in" }],
        params: { watts: 200 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "bat_12v", portId: "p+" },
        to: { nodeId: "dc_dc_converter", portId: "in+" },
        wire: { maxA: 100 }
      },
      {
        id: "e2",
        from: { nodeId: "dc_dc_converter", portId: "out+" },
        to: { nodeId: "load_24v", portId: "in+" },
        wire: { maxA: 25 }
      }
    ]
  },
  scenario: {}
};

// Test 5: Multiple sources with priority dispatch
const test5: FlowInput = {
  graph: {
    nodes: [
      {
        id: "shore_power",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { availableW: 500 }
      },
      {
        id: "solar",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { availableW: 150 }
      },
      {
        id: "alternator",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { maxOutA: 50 }
      },
      {
        id: "battery",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 100, maxChargeA: 60 }
      },
      {
        id: "busbar",
        type: "distribution",
        ports: [{ id: "p1", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: {}
      },
      {
        id: "heavy_load",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 300 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "shore_power", portId: "out+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 100 }
      },
      {
        id: "e2",
        from: { nodeId: "solar", portId: "out+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 30 }
      },
      {
        id: "e3",
        from: { nodeId: "alternator", portId: "out+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 60 }
      },
      {
        id: "e4",
        from: { nodeId: "battery", portId: "p+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 120 }
      },
      {
        id: "e5",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "heavy_load", portId: "in+" },
        wire: { maxA: 50 }
      }
    ]
  },
  scenario: {
    dispatchPolicy: "priority_order",
    sourcePriority: ["shore_power", "solar", "alternator", "battery"]
  }
};

// Test 6: Overload scenario (demand exceeds supply)
const test6: FlowInput = {
  graph: {
    nodes: [
      {
        id: "small_battery",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 30, maxChargeA: 20 }
      },
      {
        id: "huge_load",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 500 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "small_battery", portId: "p+" },
        to: { nodeId: "huge_load", portId: "in+" },
        wire: { maxA: 50 }
      }
    ]
  },
  scenario: {}
};

// Test 7: Proportional dispatch
const test7: FlowInput = {
  graph: {
    nodes: [
      {
        id: "source_a",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { availableW: 100 }
      },
      {
        id: "source_b",
        type: "source",
        ports: [{ id: "out+", domain: "DC_12V", conductor: "POS", dir: "out" }],
        params: { availableW: 200 }
      },
      {
        id: "busbar",
        type: "distribution",
        ports: [{ id: "p1", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: {}
      },
      {
        id: "load",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 150 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "source_a", portId: "out+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 50 }
      },
      {
        id: "e2",
        from: { nodeId: "source_b", portId: "out+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 50 }
      },
      {
        id: "e3",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "load", portId: "in+" },
        wire: { maxA: 40 }
      }
    ]
  },
  scenario: {
    dispatchPolicy: "share_proportionally"
  }
};

// Test 8: Disabled nodes scenario
const test8: FlowInput = {
  graph: {
    nodes: [
      {
        id: "battery",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 100 }
      },
      {
        id: "busbar",
        type: "distribution",
        ports: [{ id: "p1", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: {}
      },
      {
        id: "fridge",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 60 }
      },
      {
        id: "lights",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 30 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "battery", portId: "p+" },
        to: { nodeId: "busbar", portId: "p1" },
        wire: { maxA: 100 }
      },
      {
        id: "e2",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "fridge", portId: "in+" },
        wire: { maxA: 20 }
      },
      {
        id: "e3",
        from: { nodeId: "busbar", portId: "p1" },
        to: { nodeId: "lights", portId: "in+" },
        wire: { maxA: 10 }
      }
    ]
  },
  scenario: {
    enabledNodes: { fridge: false, lights: true }
  }
};

// Test 9: Wire capacity exceeded
const test9: FlowInput = {
  graph: {
    nodes: [
      {
        id: "battery",
        type: "storage",
        ports: [{ id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" }],
        params: { maxDischargeA: 200 }
      },
      {
        id: "heavy_load",
        type: "load",
        ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
        params: { watts: 200 }
      }
    ],
    edges: [
      {
        id: "e1",
        from: { nodeId: "battery", portId: "p+" },
        to: { nodeId: "heavy_load", portId: "in+" },
        wire: { maxA: 10 },
        protection: { fuseA: 15 }
      }
    ]
  },
  scenario: {}
};

describe("flow-engine", () => {
  it("Test 1: Simple battery -> load", () => {
    const result = run(test1);
    expect(result.status).toBe("ok");
    expect(result.nodes.fridge?.demandW).toBeCloseTo(60);
  });

  it("Test 2: Multiple loads", () => {
    const result = run(test2);
    console.log(result.nodes.bat1?.supplyW);
    expect(result.status).toBe("ok");
    expect(result.nodes.lights?.demandW).toBeCloseTo(30);
    expect(result.nodes.fridge?.demandW).toBeCloseTo(60);
    expect(result.nodes.bat1?.supplyW).toBeCloseTo(30 * 12 + 60 * 12 + 5 * 12 * 0.3);
  });

  it("Test 3: Solar charging battery", () => {
    const result = run(test3);
    expect(result.status).toBe("ok");
    expect(result.nodes.solar?.supplyW).toBeCloseTo(50);
    expect(result.nodes.bat1?.state).toBe("idle");
  });

  it("Test 4: DC-DC converter", () => {
    const result = run(test4);
    expect(result.status).toBe("ok");
    expect(result.nodes.load_24v?.demandW).toBeCloseTo(200);
  });

  it("Test 5: Multiple sources with priority", () => {
    const result = run(test5);
    expect(result.status).toBe("ok");
    console.log(result);
    expect(result.nodes.shore_power?.supplyW).toBeCloseTo(300);
  });

  it("Test 6: Overload scenario", () => {
    const result = run(test6);
    expect(result.status).toBe("partial");
    expect(result.diagnostics.some(d => d.code === "UNSERVED_DEMAND")).toBe(true);
  });

  it("Test 7: Proportional dispatch", () => {
    const result = run(test7);
    expect(result.status).toBe("ok");
    expect(result.nodes.source_a?.supplyW).toBeCloseTo(50);
    expect(result.nodes.source_b?.supplyW).toBeCloseTo(100);
  });

  it("Test 8: Disabled nodes", () => {
    const result = run(test8);
    expect(result.status).toBe("ok");
    expect(result.nodes.fridge).toBeUndefined();
    expect(result.nodes.lights?.demandW).toBeCloseTo(30);
  });

  it("Test 9: Wire capacity exceeded", () => {
    const result = run(test9);
    expect(result.status).toBe("ok");
    expect(result.edges.e1?.limitedBy).toEqual(["wire.maxA", "fuseA"]);
  });
});
