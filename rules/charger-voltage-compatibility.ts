import type { ComponentInstance, ComponentType } from '~/types/schema'
import type { Rule } from './rule-types'
import { error, issueId, warning } from './rule-utils'

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

export const chargerVoltageCompatibilityRule: Rule = {
  id: 'charger-voltage-compatibility',
  description: 'Error when charger voltage profile is incompatible with battery chemistry.',
  run: ({ schema, registry, graph }) => {
    const typeById = new Map(registry.map((item) => [item.id, item]))

    const isBattery = (type: ComponentType | undefined) =>
      type?.chargePathRole === 'battery' || type?.id === 'battery'
    const isCharger = (type: ComponentType | undefined) =>
      type?.energyRole === 'charger' ||
      type?.chargePathRole === 'charger' ||
      type?.chargePathRole === 'controller'
    const isPassThrough = (type: ComponentType | undefined) => type?.passThrough === true

    const nextActiveNeighbors = (startId: string, direction: 'in' | 'out') => {
      const visited = new Set<string>()
      const result: string[] = []
      const queue =
        direction === 'out'
          ? [...(graph.outgoing.get(startId) ?? [])]
          : [...(graph.incoming.get(startId) ?? [])]

      while (queue.length > 0) {
        const candidateId = queue.shift()
        if (!candidateId || visited.has(candidateId)) continue
        visited.add(candidateId)

        const candidate = graph.nodesById.get(candidateId)
        const candidateType = candidate ? graph.typesById.get(candidate.typeId) : undefined
        if (isPassThrough(candidateType)) {
          const next =
            direction === 'out'
              ? graph.outgoing.get(candidateId) ?? []
              : graph.incoming.get(candidateId) ?? []
          next.forEach((nextId) => {
            if (!visited.has(nextId)) queue.push(nextId)
          })
          continue
        }

        result.push(candidateId)
      }

      return result
    }

    const issues = []

    schema.components.forEach((component) => {
      const type = typeById.get(component.typeId)
      if (!isBattery(type)) return

      const maxInputV =
        numericProp(component, type, 'maxInputVoltage') ??
        numericProp(component, type, 'chargeCutoffVoltage')
      const recommendedV = numericProp(component, type, 'recommendedChargeVoltage')
      const cutoffMs = numericProp(component, type, 'chargeCutoffDurationMs')
      if (!maxInputV && !recommendedV) return

      const upstreamIds = nextActiveNeighbors(component.id, 'in')
      if (upstreamIds.length === 0) return

      upstreamIds.forEach((sourceId) => {
        const source = graph.nodesById.get(sourceId)
        const sourceType = source ? graph.typesById.get(source.typeId) : undefined
        if (!source || !isCharger(sourceType)) return

        const outputV = numericProp(source, sourceType, 'outputVoltage')
        if (!outputV) return

        const batteryName = component.name ?? 'battery'
        const chargerName = source.name ?? 'charger'
        const cutoffSuffix =
          cutoffMs && cutoffMs > 0 ? ` for ${formatNumber(cutoffMs, 0)} ms` : ''

        if (maxInputV && outputV > maxInputV) {
          issues.push(
            error({
              id: issueId('charge-voltage-cutoff', `${component.id}-${sourceId}`),
              message: `${chargerName} output voltage (${formatNumber(
                outputV,
              )}V) exceeds ${batteryName} max input voltage (${formatNumber(
                maxInputV,
              )}V${cutoffSuffix}).`,
              targetType: 'component',
              targetId: component.id,
              suggestion: 'Lower the charger output voltage or update the battery max input voltage.',
            }),
          )
          return
        }

        if (recommendedV && outputV > recommendedV) {
          issues.push(
            warning({
              id: issueId('charge-voltage-recommended', `${component.id}-${sourceId}`),
              message: `${chargerName} output voltage (${formatNumber(
                outputV,
              )}V) exceeds ${batteryName} recommended charge voltage (${formatNumber(
                recommendedV,
              )}V).`,
              targetType: 'component',
              targetId: component.id,
              suggestion:
                'Lower the charger output voltage or adjust the recommended charge voltage.',
            }),
          )
        }
      })
    })

    return issues
  },
}
