import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'

const intersects = (a: string[], b: string[]) => a.some((item) => b.includes(item))

export const domainCompatibilityRule: Rule = {
  id: 'domain-compatibility',
  description: 'Error when connected components have incompatible electrical domains.',
  run: ({ graph }) => {
    const issues = []

    graph.logicalNodeIds.forEach((sourceId) => {
      const sourceDomains = graph.nodeDomains.get(sourceId) ?? []
      if (sourceDomains.length === 0) return

      const targets = graph.logicalNeighbors.get(sourceId) ?? []
      targets.forEach((target) => {
        if (sourceId.localeCompare(target.nodeId) >= 0) return
        const targetDomains = graph.nodeDomains.get(target.nodeId) ?? []
        if (targetDomains.length === 0) return
        if (intersects(sourceDomains, targetDomains)) return

        const edgeId = target.pathEdgeIds[0]
        issues.push(
          error({
            id: issueId('domain-mismatch', `${sourceId}-${target.nodeId}`),
            message: `Domain mismatch between connected components (${sourceDomains.join(
              ', ',
            )} → ${targetDomains.join(', ')}).`,
            targetType: edgeId ? 'cable' : 'component',
            targetId: edgeId ?? sourceId,
            suggestion: 'Insert a converter or connect matching domains.',
            category: 'Compatibility',
            blame: {
              nodes: [sourceId, target.nodeId],
              edges: target.pathEdgeIds.length > 0 ? target.pathEdgeIds : undefined,
            },
          }),
        )
      })
    })

    return issues
  },
}
