import type { ComponentType, Issue, SchemaState } from '~/types/schema'

export type RuleContext = {
  schema: SchemaState
  registry: ComponentType[]
}

export type Rule = {
  id: string
  description: string
  run: (ctx: RuleContext) => Issue[]
}
