# Technical Stack and Architecture (Nuxt 3 + Konva)

This document describes the technical stack and overall architecture for a long‑term, high‑quality electrical schema editor. It focuses on how the system is structured, how parts communicate, and how data is stored locally on the user’s machine.

## Stack Summary

- UI Framework: Nuxt 3 (Vue 3 + Composition API)
- Language: TypeScript
- Build Tooling: Nuxt (Vite-based)
- State Management: Pinia
- Diagram Rendering: Konva (Canvas)
- Persistence: Browser Local Storage

## Goals of the Architecture

- Separate domain logic from rendering.
- Make validation and recommendations deterministic and explainable.
- Keep rendering fast and interactive.
- Allow long‑term evolution without rewristing core logic.
- Ensure user data is stored locally and can be migrated over time.

## High‑Level Architecture

The system is split into four main layers:

1. **Domain Layer**  
   The core electrical model and rules. This layer is UI‑agnostic.

2. **State Layer**  
   A single source of truth (Pinia) that holds the current schema, derived properties, and validation results.

3. **Rendering Layer**  
   Konva renders the schema visually based on the state. It does not contain business logic.

4. **UI Layer**  
   Vue components provide the editor, property panels, toolbars, and navigation.

## Domain Layer (Model + Rules)

### Core Entities

- **ComponentType**  
  Defines a type of component (battery, fuse, inverter) and its default properties, constraints, and port schema.

- **ComponentInstance**  
  A concrete component placed by the user. Holds its own editable properties and derived values.

- **Cable**  
  A connection between components with its own properties (length, gauge) and derived values (voltage drop, max current).

- **Group / Subsystem**  
  A container for components that imposes inherited constraints (e.g., max voltage).

### Rules and Recommendations

Rules are pure functions that take a read‑only snapshot of the model and produce:

- **Issues** (warnings/errors)
- **Suggestions** (recommended fixes)

Rules do not mutate the state directly. They only produce results that are stored and displayed.

## State Layer (Pinia)

The Pinia store acts as the integration point between UI, rendering, and domain logic.

### Responsibilities

- Store all components, cables, groups, and selection state.
- Apply user actions as immutable updates (add, update, remove).
- Recompute derived properties (e.g., current draw, voltage drop).
- Run rules and attach resulting issues and suggestions to the state.
- Orchestrate persistence to local storage.

### Example Store Data

- `schema`: components, cables, groups, layout positions
- `derived`: computed values (drop, max current, aggregated loads)
- `validation`: issues + suggestions
- `ui`: selection, zoom, viewport

## Rendering Layer (Konva)

Konva is responsible for drawing and interaction. It reads state and raises user interaction events.

### Responsibilities

- Render components and cables as canvas shapes.
- Handle zoom, pan, drag, and selection.
- Emit events like `nodeMoved`, `nodeSelected`, `cableCreated`.
- Visualize issues (e.g., highlight invalid cables).

### What Konva Does Not Do

- No validation rules.
- No data mutation directly.
- No storage logic.

All mutations go through the Pinia store, which then updates the Konva view via reactive state.

## UI Layer (Vue)

### Key UI Components

- **Editor View**: wraps the Konva stage and handles editor tools.
- **Property Panel**: edits properties of selected components or cables.
- **Component Library**: catalog of parts the user can add.
- **Validation Panel**: lists issues and suggestions.

### Communication Flow

1. User action in UI (drag, edit, connect)
2. UI emits an action to Pinia
3. Pinia updates the domain model
4. Rules re‑run and derived state updates
5. Vue and Konva re‑render based on updated state

## Data Persistence (Local Storage)

All user data is stored locally in the browser to keep the project self‑contained and offline‑friendly.

### Storage Strategy

- Persist a serialized `schema` object in local storage.
- Use a single key namespace, for example: `van-elec.schema.v1`.
- Include a `version` field for migrations.

### Save Timing

- Save on every meaningful change (debounced).
- Save on explicit user actions (manual save).

### Loading

- On app load, retrieve the saved schema.
- Validate and migrate if version is older.
- If missing or invalid, start with a default empty schema.

## Component Interactions (Concrete Examples)

### Example: User Adds a Battery

1. User selects “Battery” in the library.
2. UI calls `store.addComponent("battery", position)`.
3. Store creates a ComponentInstance from ComponentType defaults.
4. State updates; Konva renders the new battery.

### Example: User Creates a Cable

1. User drags from a component port to another.
2. UI calls `store.addCable(sourceId, targetId, props)`.
3. Store validates connection constraints.
4. Rules compute voltage drop and max current.
5. Issues or suggestions appear if needed.

### Example: User Edits Cable Gauge

1. Property panel changes `gaugeAwg`.
2. Store updates cable props.
3. Derived values recompute.
4. Rules re‑run.
5. Warnings update in the UI and on the canvas.

## Extensibility Plan

- New component types are added to a registry without changing rendering logic.
- New validation rules can be added without touching the UI.
- Rendering style can be upgraded while keeping domain logic intact.
