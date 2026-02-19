import { computeFlow, type FlowInput } from "../services/flow-engine";

const findDiagnostic = (input: ReturnType<typeof computeFlow>, code: string) =>
  input.diagnostics.find((diagnostic) => diagnostic.code === code);

describe("flow-engine dc negative return", () => {
  const baseNodes: FlowInput["graph"]["nodes"] = [
    {
      id: "bat",
      type: "battery",
      ports: [
        { id: "p+", domain: "DC_12V", conductor: "POS", dir: "bidirectional" },
        { id: "p-", domain: "DC_12V", conductor: "NEG", dir: "bidirectional" },
      ],
      params: { nominalV: 12, maxDischargeA: 50 },
    },
    {
      id: "load",
      type: "load",
      ports: [
        { id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" },
        { id: "in-", domain: "DC_12V", conductor: "NEG", dir: "in" },
      ],
      params: { watts: 60 },
    },
  ];

  it("warns when a connected DC load has no negative return path", () => {
    const input: FlowInput = {
      graph: {
        nodes: baseNodes,
        edges: [
          { id: "e-pos", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in+" } },
        ],
      },
      scenario: { dcNegativeMode: "warn" },
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(findDiagnostic(result, "DC_NEG_RETURN_MISSING")?.severity).toBe("warning");
  });

  it("warns when a DC load has no negative port at all", () => {
    const input: FlowInput = {
      graph: {
        nodes: [
          baseNodes[0],
          {
            id: "load",
            type: "load",
            ports: [{ id: "in+", domain: "DC_12V", conductor: "POS", dir: "in" }],
            params: { watts: 60 },
          },
        ],
        edges: [{ id: "e-pos", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in+" } }],
      },
      scenario: { dcNegativeMode: "warn" },
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(findDiagnostic(result, "DC_LOAD_NEG_PORT_MISSING")?.severity).toBe("warning");
  });

  it("treats missing negative return as an error in enforce mode", () => {
    const input: FlowInput = {
      graph: {
        nodes: baseNodes,
        edges: [
          { id: "e-pos", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in+" } },
        ],
      },
      scenario: { dcNegativeMode: "enforce" },
    };

    const result = computeFlow(input);

    expect(result.status).toBe("failed");
    expect(findDiagnostic(result, "DC_NEG_RETURN_MISSING")?.severity).toBe("error");
  });

  it("accepts a complete DC loop with positive and negative cables", () => {
    const input: FlowInput = {
      graph: {
        nodes: baseNodes,
        edges: [
          { id: "e-pos", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in+" } },
          { id: "e-neg", from: { nodeId: "bat", portId: "p-" }, to: { nodeId: "load", portId: "in-" } },
        ],
      },
      scenario: { dcNegativeMode: "warn" },
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(findDiagnostic(result, "DC_NEG_RETURN_MISSING")).toBeUndefined();
    expect(findDiagnostic(result, "EDGE_CONDUCTOR_UNSUPPORTED")).toBeUndefined();
  });

  it("accepts reverse endpoint order on the negative cable", () => {
    const input: FlowInput = {
      graph: {
        nodes: baseNodes,
        edges: [
          { id: "e-pos", from: { nodeId: "bat", portId: "p+" }, to: { nodeId: "load", portId: "in+" } },
          { id: "e-neg", from: { nodeId: "load", portId: "in-" }, to: { nodeId: "bat", portId: "p-" } },
        ],
      },
      scenario: { dcNegativeMode: "warn" },
    };

    const result = computeFlow(input);

    expect(result.status).toBe("ok");
    expect(findDiagnostic(result, "DC_NEG_RETURN_MISSING")).toBeUndefined();
  });
});
