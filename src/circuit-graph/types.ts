import type { Cable, ComponentInstance, ComponentType, Issue, SchemaState } from '~/types/schema'

export type Net = {
  id: string
  nodeIds: string[]
  edgeIds: string[]
  domains: string[]
}

export type LogicalNeighbor = {
  nodeId: string
  pathNodeIds: string[]
  pathEdgeIds: string[]
}

export type LogicalNet = {
  id: string
  nodeIds: string[]
}

export type CircuitGraph = {
  nodes: ComponentInstance[]
  edges: Cable[]
  nodesById: Map<string, ComponentInstance>
  edgesById: Map<string, Cable>
  typesById: Map<string, ComponentType>
  outgoing: Map<string, string[]>
  incoming: Map<string, string[]>
  adjacency: Map<string, { neighborId: string; edgeId: string }[]>
  nodeDomains: Map<string, string[]>
  nets: Net[]
  logicalNodeIds: string[]
  logicalNeighbors: Map<string, LogicalNeighbor[]>
  logicalAdjacency: Map<string, string[]>
  logicalNets: LogicalNet[]
}

export type AnalysisSettings = {
  strictness?: 'lenient' | 'standard' | 'strict'
  allowedDomains?: string[]
}

export type RuleContext = {
  schema: SchemaState
  registry: ComponentType[]
  graph: CircuitGraph
  settings?: AnalysisSettings
}

export type Rule = {
  id: string
  description: string
  run: (ctx: RuleContext) => Issue[]
}

export type AnalysisOptions = {
  rules: Rule[]
  enabledRules?: string[]
  disabledRules?: string[]
  severityOverrides?: Record<string, Issue['level']>
  settings?: AnalysisSettings
}

export type ValidationStats = {
  nodes: number
  edges: number
  nets: number
  counts: Record<Issue['level'], number>
}

export type ValidationResult = {
  graph: CircuitGraph
  diagnostics: Issue[]
  diagnosticsByEntityId: Record<string, string[]>
  stats: ValidationStats
}
