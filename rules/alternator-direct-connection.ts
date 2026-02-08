import type { ComponentType } from '~/types/schema'
import type { Rule } from './rule-types'
import { error, issueId, warning } from './rule-utils'

export const alternatorDirectConnectionRule: Rule = {
  id: 'alternator-direct-connection',
  description: 'Require a DC-DC charger between alternator and battery.',
  run: ({ schema, registry }) => {
    const typeById = new Map(registry.map((item) => [item.id, item]))
    const componentById = new Map(schema.components.map((item) => [item.id, item]))
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()

    schema.cables.forEach((cable) => {
      const out = outgoing.get(cable.sourceId) ?? []
      out.push(cable.targetId)
      outgoing.set(cable.sourceId, out)

      const inc = incoming.get(cable.targetId) ?? []
      inc.push(cable.sourceId)
      incoming.set(cable.targetId, inc)
    })

    const isBattery = (type: ComponentType | undefined) =>
      type?.chargePathRole === 'battery' || type?.id === 'battery'
    const isAlternator = (type: ComponentType | undefined) => type?.id === 'alternator'
    const isDcDc = (type: ComponentType | undefined) => type?.id === 'dc-dc-charger'

    const issues = []

    schema.components.forEach((component) => {
      const type = typeById.get(component.typeId)
      if (!isAlternator(type)) return

      const targets = outgoing.get(component.id) ?? []
      if (targets.length === 0) return

      const invalidTargets = targets.filter((targetId) => {
        const target = componentById.get(targetId)
        const targetType = target ? typeById.get(target.typeId) : undefined
        return !isDcDc(targetType)
      })

      if (invalidTargets.length > 0) {
        issues.push(
          error({
            id: issueId('alternator-dcdc-required', component.id),
            message: 'Alternator output must feed a DC-DC charger before the battery.',
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Connect the alternator output to a DC-DC charger.',
          }),
        )
      }
    })

    schema.components.forEach((component) => {
      const type = typeById.get(component.typeId)
      if (!isDcDc(type)) return

      const inputs = incoming.get(component.id) ?? []
      const outputs = outgoing.get(component.id) ?? []

      const invalidInputs = inputs.filter((sourceId) => {
        const source = componentById.get(sourceId)
        const sourceType = source ? typeById.get(source.typeId) : undefined
        return !isAlternator(sourceType)
      })

      const invalidOutputs = outputs.filter((targetId) => {
        const target = componentById.get(targetId)
        const targetType = target ? typeById.get(target.typeId) : undefined
        return !isBattery(targetType)
      })

      if (invalidInputs.length > 0) {
        issues.push(
          error({
            id: issueId('dcdc-invalid-input', component.id),
            message: 'DC-DC charger input must come from an alternator.',
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Connect the DC-DC charger input to an alternator.',
          }),
        )
      }

      if (invalidOutputs.length > 0) {
        issues.push(
          error({
            id: issueId('dcdc-invalid-output', component.id),
            message: 'DC-DC charger output must connect directly to a battery.',
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Connect the DC-DC charger output to a battery.',
          }),
        )
      }

      if ((inputs.length > 0 || outputs.length > 0) && inputs.length === 0) {
        issues.push(
          warning({
            id: issueId('dcdc-missing-input', component.id),
            message: 'DC-DC charger should be fed by an alternator.',
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Connect an alternator to the DC-DC charger input.',
          }),
        )
      }

      if ((inputs.length > 0 || outputs.length > 0) && outputs.length === 0) {
        issues.push(
          warning({
            id: issueId('dcdc-missing-output', component.id),
            message: 'DC-DC charger should feed a battery.',
            targetType: 'component',
            targetId: component.id,
            suggestion: 'Connect the DC-DC charger output to a battery.',
          }),
        )
      }
    })

    return issues
  },
}
