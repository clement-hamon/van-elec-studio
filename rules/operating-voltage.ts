import type { ComponentInstance, ComponentType } from '~/types/schema'
import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'
const getCircuitVoltage = (
  componentId: string,
  schema: { cables: { targetId: string; derived: { circuitVoltageV: number } }[] },
) => {
  const incoming = schema.cables.find((cable) => cable.targetId === componentId)
  return incoming?.derived.circuitVoltageV ?? null
}

const getOperatingVoltage = (props: Record<string, unknown>): number | null => {
  if (typeof props.maxInputVoltage === 'number') return props.maxInputVoltage
  if (typeof props.operatingVoltage === 'number') return props.operatingVoltage
  if (typeof props.voltage === 'number') return props.voltage
  if (typeof props.inputVoltage === 'number') return props.inputVoltage
  if (typeof props.outputVoltage === 'number') return props.outputVoltage
  return null
}

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

const getBatteryMaxVoltage = (
  component: ComponentInstance,
  type: ComponentType | undefined,
): number | null =>
  numericProp(component, type, 'maxInputVoltage') ??
  numericProp(component, type, 'chargeCutoffVoltage') ??
  numericProp(component, type, 'recommendedChargeVoltage') ??
  getOperatingVoltage(component.props)

export const operatingVoltageRule: Rule = {
  id: 'operating-voltage',
  description: 'Error when component operating voltage is below circuit voltage.',
  run: ({ schema, registry }) => {
    const typeById = new Map(registry.map((item) => [item.id, item]))
    return schema.components
      .map((component) => {
        const type = typeById.get(component.typeId)
        if (type?.energyRole === 'charger') return null
        if (type?.chargePathRole === 'controller' || type?.chargePathRole === 'charger') return null

        const isBattery = type?.chargePathRole === 'battery' || type?.id === 'battery'

        const circuitVoltage = getCircuitVoltage(component.id, schema)
        if (!circuitVoltage) return null

        if (isBattery) {
          const maxVoltage = getBatteryMaxVoltage(component, type)
          if (!maxVoltage || circuitVoltage <= maxVoltage) return null
          return error({
            id: issueId('battery-charge-voltage', component.id),
            message: `Charge voltage (${circuitVoltage}V) exceeds battery max input voltage (${maxVoltage}V).`,
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Lower the charger output voltage or adjust the battery max input voltage.',
          })
        }

        const operatingVoltage = getOperatingVoltage(component.props)
        if (!operatingVoltage || operatingVoltage >= circuitVoltage) return null

        return error({
          id: issueId('operating-voltage', component.id),
          message: `Operating voltage (${operatingVoltage}V) is below circuit voltage (${circuitVoltage}V).`,
          targetType: 'component',
          targetId: component.id,
          suggestion: 'Use a higher-voltage rated component or change the circuit voltage.',
        })
      })
      .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
  },
}
