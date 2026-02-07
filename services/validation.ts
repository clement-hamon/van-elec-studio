import type { ComponentType, Issue, SchemaState } from '~/types/schema'
import { rules } from '~/rules'
import { analyzeSchema } from '~/src/circuit-graph'

export const runValidation = (schema: SchemaState, registry: ComponentType[]): Issue[] => {
  const result = analyzeSchema(schema, registry, { rules })
  return result.diagnostics
}
