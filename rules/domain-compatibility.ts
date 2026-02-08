import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'

const intersects = (a: string[], b: string[]) => a.some((item) => b.includes(item))

export const domainCompatibilityRule: Rule = {
  id: 'domain-compatibility',
  description: 'Error when connected components have incompatible electrical domains.',
  run: ({ graph }) => {
    const issues = []

    graph.edges.forEach((cable) => {
      const sourceDomains = graph.nodeDomains.get(cable.sourceId) ?? []
      const targetDomains = graph.nodeDomains.get(cable.targetId) ?? []
      if (sourceDomains.length === 0 || targetDomains.length === 0) return
      if (intersects(sourceDomains, targetDomains)) return

      issues.push(
        error({
          id: issueId('domain-mismatch', cable.id),
          message: `Domain mismatch between connected components (${sourceDomains.join(
            ', ',
          )} → ${targetDomains.join(', ')}).`,
          targetType: 'cable',
          targetId: cable.id,
          suggestion: 'Insert a converter or connect matching domains.',
          category: 'Compatibility',
          blame: {
            nodes: [cable.sourceId, cable.targetId],
            edges: [cable.id],
          },
        }),
      )
    })

    return issues
  },
}
