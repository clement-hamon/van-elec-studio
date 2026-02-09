import type { ComponentInstance, ComponentType } from '~/types/schema'
import { computeChargeOutputs } from '~/services/charging'
import type { Rule } from './rule-types'
import { issueId, warning } from './rule-utils'

const numericProp = (
  component: ComponentInstance,
  type: ComponentType | undefined,
  key: string,
): number | null => {
  const raw = component.props[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  const fallback = type?.defaultProps?.[key]
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback
  return null
}

const formatNumber = (value: number, digits = 1) => value.toFixed(digits)

export const chargingCurrentLimitRule: Rule = {
  id: 'charging-current-limit',
  description: 'Warn when total charge current exceeds battery limits.',
  run: ({ schema, registry }) => {
    const typeById = new Map(registry.map((item) => [item.id, item]))
    const outputById = computeChargeOutputs(schema, registry)
    const incoming = new Map<string, string[]>()

    schema.cables.forEach((cable) => {
      const list = incoming.get(cable.targetId) ?? []
      list.push(cable.sourceId)
      incoming.set(cable.targetId, list)
    })

    const issues = []

    schema.components.forEach((component) => {
      const type = typeById.get(component.typeId)
      const isBattery = type?.chargePathRole === 'battery' || type?.id === 'battery'
      if (!isBattery) return

      const incomingIds = incoming.get(component.id) ?? []
      const totalChargeA = incomingIds.reduce(
        (sum, sourceId) => sum + (outputById.get(sourceId) ?? 0),
        0,
      )

      if (totalChargeA <= 0) return

      const maxChargeA = numericProp(component, type, 'maxChargeCurrentA')
      const recommendedChargeA = numericProp(component, type, 'recommendedChargeCurrentA')

      if (typeof maxChargeA === 'number' && totalChargeA > maxChargeA) {
        issues.push(
          warning({
            id: issueId('charge-current-max', component.id),
            message: `Total charge current (${formatNumber(totalChargeA)}A) exceeds battery max (${formatNumber(
              maxChargeA,
            )}A).`,
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Reduce charging sources or increase the battery max charge current.',
          }),
        )
        return
      }

      if (typeof recommendedChargeA === 'number' && totalChargeA > recommendedChargeA) {
        issues.push(
          warning({
            id: issueId('charge-current-recommended', component.id),
            message: `Total charge current (${formatNumber(
              totalChargeA,
            )}A) exceeds the recommended charge current (${formatNumber(
              recommendedChargeA,
            )}A).`,
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Reduce charging sources or adjust the recommended charge current.',
          }),
        )
      }
    })

    return issues
  },
}
