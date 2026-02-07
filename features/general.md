# Feature Backlog (Agile Requirements)

This backlog uses short, testable requirements with unique IDs. Each item is written as a user story with acceptance criteria. Update status as implementation progresses.

## Status Legend

- `Planned`
- `In Progress`
- `Blocked`
- `Done`

---

## Editor Interaction

**FE-001 — Connection Preview Line**  
Status: `Planned`  
User Story: As a user, I want to see a live preview line while connecting two components so I understand what will be created.  
Acceptance Criteria:

- When in Connect mode, clicking a source node shows a preview line.
- The preview line follows the cursor.
- Clicking a valid target completes the cable.
- Pressing `Esc` or clicking the background cancels the preview.

**FE-002 — Cancel Connect**  
Status: `Planned`  
User Story: As a user, I want to cancel a connection attempt without creating a cable.  
Acceptance Criteria:

- `Esc` cancels an in‑progress connection.
- Clicking on empty canvas cancels an in‑progress connection.
- No cable is created after cancellation.

**FE-003 — Snap to Grid**  
Status: `Planned`  
User Story: As a user, I want components to snap to a grid so layouts stay clean.  
Acceptance Criteria:

- A toolbar toggle enables/disables snapping.
- When enabled, node positions snap to 10px increments.
- Snapping applies during drag and drop.

**FE-004 — Multi‑Select**  
Status: `Planned`  
User Story: As a user, I want to select multiple nodes so I can move them together.  
Acceptance Criteria:

- Dragging a selection rectangle selects all intersecting nodes.
- Shift‑click adds/removes nodes from selection.
- Selected nodes move together when dragged.

**FE-005 — Context Menu**  
Status: `Planned`  
User Story: As a user, I want a right‑click menu for fast actions.  
Acceptance Criteria:

- Right‑click on node/cable opens a menu.
- Menu includes: delete, duplicate, rename.
- Clicking outside closes the menu.

---

## Validation UX

**FE-010 — Inline Validation Badges**  
Status: `Planned`  
User Story: As a user, I want to see validation warnings directly on the canvas so I can fix issues faster.  
Acceptance Criteria:

- Nodes/cables with warnings show a yellow badge.
- Nodes/cables with errors show a red badge.
- Badges update automatically when issues change.

**FE-011 — Issue Tooltip**  
Status: `Planned`  
User Story: As a user, I want to see the issue details on hover.  
Acceptance Criteria:

- Hovering a badge shows a tooltip with issue message and suggestion.
- Tooltip is positioned near the badge.

**FE-012 — Issue Focus**  
Status: `Planned`  
User Story: As a user, I want to click an issue and jump to its target.  
Acceptance Criteria:

- Clicking an issue in the list selects its node/cable.
- Canvas centers the selected item.
- Selected item is visually highlighted.

---

## Connection Rules

**FE-020 — Port Domain Compatibility**  
Status: `Planned`  
User Story: As a user, I want the editor to block AC↔DC connections.  
Acceptance Criteria:

- Connecting a DC port to an AC port is disallowed.
- The UI displays a clear warning when attempted.

**FE-021 — Port Direction Compatibility**  
Status: `Planned`  
User Story: As a user, I want connections to respect port direction.  
Acceptance Criteria:

- Output → Input is allowed.
- Input → Input and Output → Output are blocked.
- Bidirectional ports can connect to either direction.

**FE-022 — Highlight Valid Targets**  
Status: `Planned`  
User Story: As a user, I want valid targets highlighted during connect mode.  
Acceptance Criteria:

- When a source is selected, valid targets glow.
- Invalid targets are dimmed.

---

## Domain Model

**FE-030 — Cable Ampacity Table**  
Status: `Planned`  
User Story: As a user, I want cable ampacity to be calculated from a defined table for accuracy.  
Acceptance Criteria:

- Ampacity is derived from gauge and insulation rating.
- Temperature correction can be applied.

**FE-031 — Wire Gauge Conversion**  
Status: `Planned`  
User Story: As a user, I want to work in AWG or mm².  
Acceptance Criteria:

- Input accepts AWG or mm².
- Conversion is shown in the inspector.

**FE-032 — Component Inheritance**  
Status: `Planned`  
User Story: As a user, I want subsystems to enforce shared constraints.  
Acceptance Criteria:

- Groups enforce voltage/current constraints.
- Violations trigger validation issues.

---

## Charging the Battery (Epic)

Detailed epic requirements are in `/Users/clementhamon/Projects/van-elec/features/batery-charging.md`.

---

## UI & UX

**FE-040 — Inspector Sections**  
Status: `Done`  
User Story: As a user, I want property panels tailored to each component type.  
Acceptance Criteria:

- Battery fields differ from inverter fields.
- Only relevant fields are shown.

**FE-041 — Component Search**  
Status: `Planned`  
User Story: As a user, I want to search the library to find components quickly.  
Acceptance Criteria:

- Search filters the library list.
- No results shows a clear empty state.

---

## Export & Sharing

**FE-050 — Export JSON**  
Status: `Planned`  
User Story: As a user, I want to export my schema to JSON.  
Acceptance Criteria:

- Export includes components, cables, groups, settings.
- Exported file is valid JSON and versioned.

**FE-051 — Export PDF/SVG**  
Status: `Planned`  
User Story: As a user, I want a printable diagram.  
Acceptance Criteria:

- Exported diagram includes labels and cable paths.
- Output is PDF or SVG.
