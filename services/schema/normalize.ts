import { mergeComponentPortsWithType } from '~/src/domain/components/ports'
import type { ComponentType, ScenarioInput, SchemaState } from '~/types/schema'

export const nowIso = () => new Date().toISOString()

export const defaultImageScaleRatio = (typeId: string) => (typeId === 'fuse' ? 0.7 : 1)

export const defaultScenario = (): ScenarioInput => ({
  enabledNodes: {},
  dcNegativeMode: 'warn',
  currentComputationMode: 'load_simulation',
  autoCableGauge: false,
  dispatchPolicy: 'priority_order',
  sourcePriority: [],
})

export const normalizeScenario = (scenario?: ScenarioInput): ScenarioInput => {
  const defaults = defaultScenario()
  return {
    ...defaults,
    ...scenario,
    enabledNodes: scenario?.enabledNodes ?? defaults.enabledNodes,
    sourcePriority: scenario?.sourcePriority ?? defaults.sourcePriority,
  }
}

export const normalizeSchema = (schema: SchemaState, registry: ComponentType[]): SchemaState => {
  const typeById = new Map(registry.map((type) => [type.id, type]))
  return {
    ...schema,
    components: schema.components.map((component) => ({
      ...component,
      ports: mergeComponentPortsWithType(component, typeById.get(component.typeId)),
      imageScaleRatio:
        typeof component.imageScaleRatio === 'number'
          ? component.imageScaleRatio
          : defaultImageScaleRatio(component.typeId),
    })),
    scenario: normalizeScenario(schema.scenario),
    updatedAt: schema.updatedAt ?? nowIso(),
  }
}
