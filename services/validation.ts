import type { ComponentType, Issue, SchemaState } from '~/types/schema'
import { rules } from '~/rules'

export const runValidation = (schema: SchemaState, registry: ComponentType[]): Issue[] => {
  return rules.flatMap((rule) => rule.run({ schema, registry }))
}
