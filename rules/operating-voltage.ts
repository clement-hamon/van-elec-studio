import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'
import { createVoltageResolver, resolveVoltageRole } from '~/services/voltage'

export const operatingVoltageRule: Rule = {
  id: 'operating-voltage',
  description: 'Error when input voltage exceeds a component max input voltage.',
  run: ({ graph }) => {
    const voltage = createVoltageResolver(graph)
    const issues = []

    graph.edges.forEach((cable) => {
      const source = graph.nodesById.get(cable.sourceId)
      const target = graph.nodesById.get(cable.targetId)
      if (!source || !target) return

      const sourceVoltage = voltage.getOutputVoltage(source.id)
      const targetMaxInput = voltage.getMaxInputVoltage(target.id)
      if (!targetMaxInput || sourceVoltage <= targetMaxInput) return

      const targetType = graph.typesById.get(target.typeId)
      const targetRole = resolveVoltageRole(targetType)
      const isBattery = targetRole === 'storage' || targetType?.id === 'battery'

      issues.push(
        error({
          id: issueId(isBattery ? 'battery-charge-voltage' : 'operating-voltage', target.id),
          message: isBattery
            ? `Charge voltage (${sourceVoltage}V) exceeds battery max input voltage (${targetMaxInput}V).`
            : `Input voltage (${sourceVoltage}V) exceeds max input voltage (${targetMaxInput}V).`,
          targetType: 'component',
          targetId: target.id,
          suggestion: isBattery
            ? 'Lower the charger output voltage or adjust the battery max input voltage.'
            : 'Use a higher-voltage rated component or change the circuit voltage.',
          category: 'Voltage',
          blame: {
            nodes: [source.id, target.id],
            edges: [cable.id],
          },
        }),
      )
    })

    return issues
  },
}
