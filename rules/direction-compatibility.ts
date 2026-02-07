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

    graph.edges.forEach((cable) => {
      const source = graph.nodesById.get(cable.sourceId)
      const target = graph.nodesById.get(cable.targetId)
      const sourceType = source ? graph.typesById.get(source.typeId) : undefined
      const targetType = target ? graph.typesById.get(target.typeId) : undefined

      const sourceClass = classifyDirection(sourceType)
      const targetClass = classifyDirection(targetType)

      if (sourceClass === 'unknown' || targetClass === 'unknown') return
      if (sourceClass === 'bidirectional' || targetClass === 'bidirectional') return
      if (sourceClass !== targetClass) return

      issues.push(
        error({
          id: issueId('direction-mismatch', cable.id),
          message: 'Connection is between two components with the same directionality.',
          targetType: 'cable',
          targetId: cable.id,
          suggestion: 'Connect a source to a sink or insert a compatible converter.',
          category: 'Topology',
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
