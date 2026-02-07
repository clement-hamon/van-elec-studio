Graph-Based Electrical Schema Validation Module — Requirements Specification

1. Purpose

Define requirements for a framework-agnostic validation module that analyzes an electrical circuit schema represented as a graph and returns diagnostics per entity (components and cables). The module will be embedded in a Vue.js application, but must expose a clean API usable from any UI/runtime.

The module’s mission is to:

Validate arrangement (topology / connectivity),

Validate properties (ratings, domains, directions),

Validate system-level constraints (power distribution, protection, compatibility),

Produce actionable errors/warnings mapped to nodes and edges.

2. Scope
   In scope

Validation of graphs representing electrical schematics, including:

Components (producers, converters, distributors, loads, protection, switches, connectors, storage, etc.)

Cables/wires (edges or nodes, configurable)

Ports/terminals (explicit or embedded model)

Net inference (connected components / multi-drop connections)

Rule-based diagnostics (local, net-level, global)

Output formatting suitable for UI highlighting, lists, and “jump to element”

Extensibility: user-defined component types, properties, and custom rules

Incremental validation support (optional but recommended)

Out of scope (for initial release)

Full electrical simulation (SPICE-level)

Transient analysis, harmonic distortion, EMC analysis

Physical layout rules (clearance, creepage, routing geometry) unless expressed as properties

Real-time manufacturer database integration (can be added later via rule packs)

3. Definitions and Terminology

Graph: A set of entities representing the circuit and their connections.

Node: A component or optionally a cable/junction depending on representation.

Edge: A connection between terminals/ports (wire/cable) or between component and cable nodes.

Port/Terminal: A connection point belonging to a component (and optionally to cable objects).

Net: A connected component in the connectivity graph representing an electrically common node.

Domain: Type of electrical network (e.g., DC, AC, Signal, Protective Earth).

Diagnostic: An emitted issue (error/warning/info) with blame, message, and fix hints.

4. Stakeholders and Use Cases
   Stakeholders

End users designing schemas (electricians/engineers)

UI application (Vue.js) consuming results for highlighting and UX

System integrators defining component libraries and rule packs

Primary use cases

Validate whole schematic after load/open or before export.

Validate on edit (connect cable, change rating, delete component).

Display errors per entity (click component → see its issues).

Suggest fixes (choose recommended fuse rating, add converter, etc.).

Configure rules per project (DC-only rules, automotive rules, IEC/NEC packs, etc.).

5. Non-Functional Requirements
   NFR-1: Framework agnostic

No dependency on Vue/React DOM, no UI assumptions.

Pure library interface (JS/TS, WASM, or language-agnostic via JSON).

NFR-2: Deterministic and stable

Same input graph yields identical diagnostics (ordering stable).

NFR-3: Performance

Target: validate graphs up to:

10k entities (nodes + edges) with acceptable latency.

Full validation goal: < 200 ms for typical projects; < 1 s for large graphs (implementation-dependent).

Must avoid superlinear behavior in common cases.

NFR-4: Incremental capability (recommended)

Support validating only impacted region after edits:

connection changes, property changes, add/remove entity.

NFR-5: Extensible rules

Rules must be pluggable without modifying core engine.

Support project-specific rule packs and component libraries.

NFR-6: Internationalization readiness

Diagnostics must support message codes + parameters.

UI can localize messages outside module.

NFR-7: Testability

Rules and core must be unit-testable with deterministic fixtures.

Provide golden file tests for complex circuits.

6. Input Data Model Requirements

The module must accept an in-memory graph and/or a JSON-serializable structure.

6.1 Entity Identification

Every entity must have a stable unique ID string.

IDs must be preserved in diagnostics for UI mapping.

6.2 Graph Representation Options

Module must support at least one canonical representation; adapters may be provided for others.

Option A (recommended): “Ports + Cables as edges”

Component nodes contain ports.

Cables are edges connecting two ports.

Option B: “Cables as nodes”

Cables are nodes with terminal endpoints.

Edges connect component ports to cable terminals.

Useful if cables have complex properties and need direct highlighting.

The module must define a canonical internal representation and provide normalization.

6.3 Component Node Requirements

Each component node must support:

id: string

kind: string (e.g., Producer, Converter, Distributor, Load, Protection, Switch, Storage, Ground, Connector, etc.)

type: string (library type, e.g., DC_SUPPLY_24V_10A)

properties: key-value bag (schema-defined by type)

ports: array of ports

6.4 Port Requirements

Each port must support:

id: string (unique within graph, or composite {nodeId}:{portName})

name: string

role: source | sink | bidir (directionality)

domain: DC | AC | Signal | PE | ...

Optional but commonly required:

polarity: + | - | none

voltage: nominal

voltageRange: [min, max]

currentMax

phase: single | three | none

frequencyRange for AC

isRequired: boolean (must be connected)

6.5 Cable/Edge Requirements

Each cable entity must support:

id: string

Endpoint references to ports:

fromPortId, toPortId (or unordered if nets are undirected)

properties (key-value):

domain (optional; may be inferred)

gauge, length, material

currentRating, voltageRating, temperatureRating

shielded, twisted, etc. for signal cables

For multi-drop nets:

Either represent as multiple edges sharing netId, or model junction nodes explicitly.

6.6 Metadata and Versioning

Graph input must include:

schemaVersion

Optional: project settings, rule pack selection, assumptions (ambient temperature, standard)

7. Output Requirements
   7.1 Diagnostic Model

A diagnostic must contain:

id: stable code (e.g., E_DOMAIN_MISMATCH)

severity: error | warning | info

message: human-readable string (optional if UI localizes)

messageKey: localization key (required if using localization)

params: dictionary for templating ({ expected: "DC", got: "AC" })

blame:

nodes: array of node IDs

edges: array of edge IDs

optionally ports: array of port IDs

category: e.g., Topology, Compatibility, Protection, Rating, Completeness

fixes (optional):

list of suggested actions (non-executing), each with:

kind: suggestion | quickfix

descriptionKey / description

optional patch (structured “apply change” instruction)

7.2 Per-Entity Index

Module must provide a derived structure:

diagnosticsByEntityId: Record<string, DiagnosticId[]>
so UI can display entity-specific issues instantly.

7.3 Stable Ordering

Diagnostics must be returned in stable order:

primarily by severity, then by category, then by deterministic entity ordering.

8. Validation Capabilities and Rule Categories

Rules must be organized into categories and be individually enable/disable-able.

8.1 Structural / Topology Rules

Detect unconnected required ports.

Detect isolated subgraphs (unless allowed).

Detect illegal direct connections between certain kinds (e.g., producer↔producer).

Detect missing return path / reference (e.g., no ground/negative in DC systems), if required by configuration.

Detect loops where forbidden (or require protection).

8.2 Compatibility Rules

Domain mismatch: AC connected to DC, Signal connected to Power, etc.

Voltage incompatibility: non-overlapping voltage ranges.

Polarity mismatch (DC + to -).

Phase mismatch: single vs three phase.

Frequency mismatch: 50/60 Hz constraints.

8.3 Ratings / Protection Rules

Cable ampacity < expected current.

Fuse/breaker rating inconsistent with downstream load or cable rating.

Protection device missing on branch (configurable).

Converter rating exceeded (input/output current limits).

8.4 Power Flow / Feasibility Rules (approximate)

Determine producers feeding nets and estimate downstream demand:

Sum load currents or convert from power via V.

Adjust via converter efficiencies where available.

Flag:

overloaded nets/branches,

multiple sources without combining device,

backfeeding into a source if disallowed.

8.5 Completeness and Data Quality Rules

Missing mandatory properties per component type.

Invalid property ranges (negative resistance, impossible rating).

Unknown component type without a library definition (warning or error depending on strictness).

9. Rule Engine Requirements
   9.1 Rule Interface

Rules must be implemented as independent modules with a standard signature, e.g.:

Inputs: analysis context (graph + computed nets + indices + settings)

Output: diagnostics array

9.2 Rule Context / Precomputation

The engine must compute and provide:

adjacency lists

port-to-node mapping

net list (connected components)

net inferred attributes (domain set, voltage range intersection, attached sources/loads)

9.3 Configuration and Settings

Support:

enable/disable rules by ID

severity overrides per rule

project assumptions:

default ambient temperature

standard pack (IEC/NEC/custom)

allowable domains

“strictness level”

9.4 Extensibility

Users can register:

component type definitions (port schemas, required properties)

custom rules

custom domain compatibility matrix

9.5 Deterministic Blame Assignment

Each diagnostic must identify the minimal set of entities causing the violation when feasible:

Prefer blame ports + the connecting cable for compatibility issues.

For net-level issues, include:

relevant source(s), load(s), and the net’s cables/junctions.

10. Normalization and Validation of Inputs

The module must validate its input graph prior to electrical checks:

No missing IDs

No duplicate IDs

Edge endpoints reference existing ports

Ports reference existing nodes

Optional: detect invalid cycles in “cable as node” representation

If the input graph is invalid structurally, return diagnostics under category InputModel.

11. Incremental Validation Requirements (Recommended)

If supporting incremental validation, module should expose:

A way to compute an “impact set” given changed entities:

changed node properties

changed cable endpoints

added/removed entities

Strategy:

recompute affected nets

rerun rules scoped to impacted nets plus global rules that depend on them

If incremental is not implemented initially, architecture must not block adding it later.

12. Public API Requirements
    12.1 Core API

Provide a minimal API surface:

analyze(graph, options) -> AnalysisResult

validate(graph, options) -> ValidationResult (alias or same)

Where:

options includes rule config, strictness, component library, and caching hooks.

12.2 Result Types

ValidationResult:

diagnostics: Diagnostic[]

diagnosticsByEntityId: Record<EntityId, DiagnosticId[]>

stats (optional): counts by severity, timing breakdown, nets count

12.3 Error Handling

Never throw for user data errors; return InputModel diagnostics.

Only throw for programmer errors (misconfigured rule pack, internal invariants).

13. Component Library Requirements

The module must support a “component library” describing:

component kinds and types

port templates and constraints

required/optional properties with types and ranges

derived properties (e.g., load current from power and voltage)

Library must be versioned and composable (merge multiple packs).

14. Diagnostics Quality Requirements

Diagnostics must be:

Specific: identify exact entity and port when possible

Actionable: include fix suggestions when possible

Non-duplicative: avoid emitting multiple diagnostics for the same root cause (dedup rules)

Configurable: allow switching some classes to warnings

15. Security and Safety Requirements

Module must not execute arbitrary code from graph input.

Custom rules must be explicitly registered by host application.

Avoid prototype pollution risks when parsing JSON (in JS environments).

16. Testing Requirements
    16.1 Unit tests

Net computation

Compatibility matrix logic

Representative rules (domain mismatch, unconnected required port, overcurrent)

16.2 Integration tests

Full circuit examples with expected diagnostics

Regression suite for rule packs

16.3 Property-based tests (optional)

Random graph generation with invariants

Ensure analyzer does not crash and produces deterministic output

17. Acceptance Criteria

The module is considered complete when:

It accepts a graph model with components, ports, and cables.

It returns diagnostics with stable codes, severities, blame sets, and per-entity indexing.

It correctly computes nets and runs rule packs deterministically.

It supports at least:

unconnected required port detection

domain mismatch detection

direction mismatch detection

basic rating/protection checks (configurable)

It provides configuration hooks for enabling/disabling rules and providing component libraries.
