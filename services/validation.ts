import type { Issue, SchemaState } from '~/types/schema'
import { rules } from '~/rules'

export const runValidation = (schema: SchemaState): Issue[] => {
  return rules.flatMap((rule) => rule.run({ schema }))
}
