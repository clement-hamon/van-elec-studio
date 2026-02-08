# Charging the Battery (Epic)

## Goal

Enable users to model battery charging (solar, alternator, shore) end-to-end so they can validate safety and performance directly in the canvas and inspector UI.

## Results When Done

- Users can add charging components and wire complete charging paths to a battery.
- A charge summary shows total charge current and estimated time to full.
- Validation warns or errors on unsafe or incompatible configurations.

## Integration Notes

- Extend the component library with new charging components (solar panel, charge controller, alternator, DC-DC charger, shore inlet, AC-DC charger).
- Extend the inspector to capture charging-specific fields on these components and on batteries.
- Extend the validation engine to compute charge totals and enforce compatibility rules.
- Keep storage schema compatible with existing graph/inspector models so export remains valid.

This file contains the detailed, testable requirements for the Charging the Battery epic.

**FE-061 — Battery Chemistry & Limits**  
Status: `Planned`  
User Story: As a user, I want to set my battery chemistry and limits so chargers can be validated accurately.  
Acceptance Criteria:

- Battery inspector includes chemistry selection (LiFePO4, AGM, etc.).
- Battery inspector includes max charge current and recommended charge voltages.
- Changes are visible immediately on the canvas (badge updates or summary changes).

**FE-062 — Solar Components & Path**  
Status: `Planned`  
User Story: As a user, I want to model solar charging so I can see expected charge current and limits.  
Acceptance Criteria:

- A solar panel component can be added with wattage and voltage specs.
- A charge controller component (MPPT/PWM) can be added with input/output limits.
- The solar path connects: panel → controller → battery.
- The path is visible in the canvas and selectable.

**FE-063 — Alternator Components & Path**  
Status: `Planned`  
User Story: As a user, I want to model alternator charging to validate safety and correct sizing.  
Acceptance Criteria:

- Alternator component includes rated current.
- DC‑DC charger component includes max output current.
- Alternator charging path connects: alternator → DC‑DC charger → battery.
- The path is visible in the canvas and selectable.

**FE-064 — Shore Components & Path**  
Status: `Planned`  
User Story: As a user, I want to model shore charging so I can validate AC→DC conversion.  
Acceptance Criteria:

- Shore power input supports 120/230V selection.
- AC‑DC charger component includes max output current and output voltage.
- Shore path connects: shore inlet → charger → battery.
- The path is visible in the canvas and selectable.

**FE-065 — Charge Summary**  
Status: `Planned`  
User Story: As a user, I want to see total charge current and time to full so I can judge performance.  
Acceptance Criteria:

- A charge summary panel appears when a battery is selected.
- Total charge current is shown and updates when sources change.
- Estimated time to full is shown and updates when sources or battery capacity change.

**FE-066 — Charge Current Validation**  
Status: `Planned`  
User Story: As a user, I want warnings if total charge current exceeds battery limits.  
Acceptance Criteria:

- Sum of charge sources into battery is computed.
- Warning badge is shown on the battery when total charge current exceeds battery max.
- The warning message states the computed total and the battery limit.

**FE-067 — Charger Voltage Compatibility**  
Status: `Planned`  
User Story: As a user, I want errors when charger voltage profile is incompatible with battery chemistry.  
Acceptance Criteria:

- Charger output voltage is validated against battery chemistry settings.
- Error badge is shown on the charger or battery when mismatched.
- The error message names the incompatible voltage/profile.

**FE-068 — Alternator Safety Warning**  
Status: `Planned`  
User Story: As a user, I want a warning if alternator is connected directly to the battery without a DC‑DC charger.  
Acceptance Criteria:

- Direct alternator → battery connection is detected.
- Warning badge is shown on the alternator or battery.
- Warning recommends adding a DC‑DC charger.

**FE-069 — Solar Controller Sizing Validation**  
Status: `Planned`  
User Story: As a user, I want errors if solar input exceeds controller specs.  
Acceptance Criteria:

- Panel voltage/current are checked against controller limits.
- Error badge is shown on the controller when limits are exceeded.
- The error message states the exceeded limit.
