import type { Issue, SchemaState, ComponentType } from '~/types/schema'
import type { AnalysisOptions, Rule, ValidationResult } from './types'
import { buildGraph } from './graph'

const severityRank: Record<Issue['level'], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const ensureArray = (input: string[] | undefined) => input ?? []

const sortDiagnostics = (diagnostics: Issue[]) => {
  return [...diagnostics].sort((a, b) => {
    const rank = severityRank[a.level] - severityRank[b.level]
    if (rank !== 0) return rank

    const categoryA = a.category ?? 'General'
    const categoryB = b.category ?? 'General'
    const categoryCompare = categoryA.localeCompare(categoryB)
    if (categoryCompare !== 0) return categoryCompare

    const targetCompare = (a.targetId ?? '').localeCompare(b.targetId ?? '')
    if (targetCompare !== 0) return targetCompare

    return a.id.localeCompare(b.id)
  })
}

const indexDiagnostics = (diagnostics: Issue[]) => {
  const index: Record<string, string[]> = {}

  const push = (entityId: string | undefined, issueId: string) => {
    if (!entityId) return
    if (!index[entityId]) index[entityId] = []
    if (!index[entityId].includes(issueId)) index[entityId].push(issueId)
  }

  diagnostics.forEach((issue) => {
    push(issue.targetId, issue.id)
    issue.blame?.nodes?.forEach((id) => push(id, issue.id))
    issue.blame?.edges?.forEach((id) => push(id, issue.id))
    issue.blame?.ports?.forEach((id) => push(id, issue.id))
  })

  return index
}

const validateInputModel = (schema: SchemaState, registry: ComponentType[]): Issue[] => {
  const issues: Issue[] = []
  const componentIds = new Set<string>()
  const cableIds = new Set<string>()

  schema.components.forEach((component) => {
    if (componentIds.has(component.id)) {
      issues.push({
        id: `input-duplicate-component-${component.id}`,
        level: 'error',
        category: 'InputModel',
        message: `Duplicate component id detected: ${component.id}.`,
        targetType: 'component',
        targetId: component.id,
      })
    }
    componentIds.add(component.id)

    const hasType = registry.some((item) => item.id === component.typeId)
    if (!hasType) {
      issues.push({
        id: `input-unknown-type-${component.id}`,
        level: 'warning',
        category: 'InputModel',
        message: `Unknown component type: ${component.typeId}.`,
        targetType: 'component',
        targetId: component.id,
      })
    }
  })

  schema.cables.forEach((cable) => {
    if (cableIds.has(cable.id)) {
      issues.push({
        id: `input-duplicate-cable-${cable.id}`,
        level: 'error',
        category: 'InputModel',
        message: `Duplicate cable id detected: ${cable.id}.`,
        targetType: 'cable',
        targetId: cable.id,
      })
    }
    cableIds.add(cable.id)

    if (!componentIds.has(cable.sourceId) || !componentIds.has(cable.targetId)) {
      issues.push({
        id: `input-cable-endpoint-${cable.id}`,
        level: 'error',
        category: 'InputModel',
        message: 'Cable references a missing component endpoint.',
        targetType: 'cable',
        targetId: cable.id,
        suggestion: 'Reconnect the cable to valid components.',
      })
    }
  })

  return issues
}

const filterRules = (rules: Rule[], options: AnalysisOptions) => {
  const enabled = new Set(ensureArray(options.enabledRules))
  const disabled = new Set(ensureArray(options.disabledRules))

  return rules.filter((rule) => {
    if (enabled.size > 0 && !enabled.has(rule.id)) return false
    if (disabled.has(rule.id)) return false
    return true
  })
}

const applySeverityOverrides = (issues: Issue[], overrides?: Record<string, Issue['level']>) => {
  if (!overrides) return issues
  return issues.map((issue) => {
    const override = issue.ruleId ? overrides[issue.ruleId] : undefined
    if (!override) return issue
    return { ...issue, level: override }
  })
}

export const analyzeSchema = (
  schema: SchemaState,
  registry: ComponentType[],
  options: AnalysisOptions,
): ValidationResult => {
  const graph = buildGraph(schema, registry)
  const rules = filterRules(options.rules ?? [], options)

  const inputDiagnostics = validateInputModel(schema, registry)
  const ruleDiagnostics = rules.flatMap((rule) => {
    const diagnostics = rule.run({ schema, registry, graph, settings: options.settings })
    return diagnostics.map((issue) => ({
      ...issue,
      ruleId: issue.ruleId ?? rule.id,
    }))
  })

  const allDiagnostics = applySeverityOverrides(
    [...inputDiagnostics, ...ruleDiagnostics],
    options.severityOverrides,
  )
  const sorted = sortDiagnostics(allDiagnostics)
  const diagnosticsByEntityId = indexDiagnostics(sorted)

  const counts = sorted.reduce(
    (acc, issue) => {
      acc[issue.level] += 1
      return acc
    },
    { error: 0, warning: 0, info: 0 },
  )

  return {
    graph,
    diagnostics: sorted,
    diagnosticsByEntityId,
    stats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      nets: graph.nets.length,
      counts,
    },
  }
}

export type { AnalysisOptions, Rule, ValidationResult } from './types'
export { buildGraph } from './graph'
