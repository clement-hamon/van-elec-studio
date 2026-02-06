import type { Issue, SchemaState } from '~/types/schema'

export type RuleContext = {
  schema: SchemaState
}

export type Rule = {
  id: string
  description: string
  run: (ctx: RuleContext) => Issue[]
}
