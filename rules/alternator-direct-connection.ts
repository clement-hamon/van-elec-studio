import type { ComponentType } from '~/types/schema'
import type { Rule } from './rule-types'
import { error, issueId, warning } from './rule-utils'

export const alternatorDirectConnectionRule: Rule = {
  id: 'alternator-direct-connection',
  description: 'Require a charger/controller between sources and batteries in the logical graph.',
  run: ({ registry, graph }) => {
    const typeById = new Map(registry.map((item) => [item.id, item]))

    const isBattery = (type: ComponentType | undefined) =>
      type?.chargePathRole === 'battery' || type?.id === 'battery'
    const isChargeSource = (type: ComponentType | undefined) =>
      type?.energyRole === 'source' ||
      type?.chargePathRole === 'source' ||
      type?.chargePathRole === 'inlet'
    const isChargeConverter = (type: ComponentType | undefined) =>
      type?.energyRole === 'charger' ||
      type?.chargePathRole === 'charger' ||
      type?.chargePathRole === 'controller'

    const issues = []

    graph.logicalNets.forEach((net) => {
      const netSources: string[] = []
      const netBatteries: string[] = []
      const netConverters: string[] = []

      net.nodeIds.forEach((nodeId) => {
        const component = graph.nodesById.get(nodeId)
        if (!component) return
        const type = typeById.get(component.typeId)
        if (isBattery(type)) netBatteries.push(nodeId)
        if (isChargeSource(type)) netSources.push(nodeId)
        if (isChargeConverter(type)) netConverters.push(nodeId)
      })

      if (netSources.length > 0 && netBatteries.length > 0 && netConverters.length === 0) {
        netSources.forEach((sourceId) => {
          issues.push(
            error({
              id: issueId('source-missing-charger', sourceId),
              message: 'Charging sources must feed a charger/controller before the battery.',
              targetType: 'component',
              targetId: sourceId,
              suggestion: 'Insert a charger/controller between the source and battery.',
              category: 'Topology',
              blame: {
                nodes: [...netSources, ...netBatteries],
              },
            }),
          )
        })
      }

      netConverters.forEach((converterId) => {
        const converter = graph.nodesById.get(converterId)
        const converterType = converter ? typeById.get(converter.typeId) : undefined
        const label = converterType?.label ?? 'Charger'
        const hasAnyConnections = (graph.logicalNeighbors.get(converterId) ?? []).length > 0

        if (hasAnyConnections && netSources.length === 0) {
          issues.push(
            warning({
              id: issueId('charger-missing-source', converterId),
              message: `${label} should be fed by a source.`,
              targetType: 'component',
              targetId: converterId,
              suggestion: `Connect a source to the ${label.toLowerCase()}.`,
            }),
          )
        }

        if (hasAnyConnections && netBatteries.length === 0) {
          issues.push(
            warning({
              id: issueId('charger-missing-battery', converterId),
              message: `${label} should feed a battery.`,
              targetType: 'component',
              targetId: converterId,
              suggestion: `Connect the ${label.toLowerCase()} output to a battery.`,
            }),
          )
        }
      })
    })

    return issues
  },
}
