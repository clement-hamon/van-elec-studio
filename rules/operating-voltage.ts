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

        const operatingVoltage = getOperatingVoltage(component.props)
        if (!operatingVoltage) return null

        const circuitVoltage = getCircuitVoltage(component.id, schema)
        if (!circuitVoltage) return null
        if (operatingVoltage >= circuitVoltage) return null

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
