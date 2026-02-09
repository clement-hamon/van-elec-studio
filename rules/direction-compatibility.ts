import type { ComponentType } from '~/types/schema'
import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'

const classifyDirection = (type: ComponentType | undefined) => {
  if (!type?.ports || type.ports.length === 0) return 'unknown'
  let hasIn = false
  let hasOut = false
  let hasBidir = false

  type.ports.forEach((port) => {
    if (port.direction === 'in') hasIn = true
    if (port.direction === 'out') hasOut = true
    if (port.direction === 'bidirectional') hasBidir = true
  })

  if (hasBidir || (hasIn && hasOut)) return 'bidirectional'
  if (hasOut && !hasIn) return 'source'
  if (hasIn && !hasOut) return 'sink'
  return 'unknown'
}

export const directionCompatibilityRule: Rule = {
  id: 'direction-compatibility',
  description: 'Error when two components with the same terminal direction are connected.',
  run: ({ graph }) => {
    const issues = []

    graph.logicalNodeIds.forEach((sourceId) => {
      const source = graph.nodesById.get(sourceId)
      if (!source) return
      const sourceType = graph.typesById.get(source.typeId)
      const sourceClass = classifyDirection(sourceType)
      if (sourceClass === 'unknown' || sourceClass === 'bidirectional') return

      const targets = graph.logicalNeighbors.get(sourceId) ?? []
      targets.forEach((target) => {
        if (sourceId.localeCompare(target.nodeId) >= 0) return
        const targetNode = graph.nodesById.get(target.nodeId)
        const targetType = targetNode ? graph.typesById.get(targetNode.typeId) : undefined
        const targetClass = classifyDirection(targetType)

        if (targetClass === 'unknown' || targetClass === 'bidirectional') return
        if (sourceClass !== targetClass) return

        const edgeId = target.pathEdgeIds[0]
        issues.push(
          error({
            id: issueId('direction-mismatch', `${sourceId}-${target.nodeId}`),
            message: 'Connection is between two components with the same directionality.',
            targetType: edgeId ? 'cable' : 'component',
            targetId: edgeId ?? sourceId,
            suggestion: 'Connect a source to a sink or insert a compatible converter.',
            category: 'Topology',
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
