import type { Rule } from './rule-types'
import { error, issueId } from './rule-utils'

export const componentVoltageDomainRule: Rule = {
  id: 'component-voltage-domain',
  description: 'Error when component voltage does not match its domain.',
  run: ({ schema }) => {
    return schema.components
      .filter((component) => {
        const voltage = Number(component.props.voltage)
        if (!voltage) return false
        const domain = component.derived.voltageDomain || component.props.voltageDomain
        if (!domain) return false
        if (domain === '12V') return voltage > 14
        if (domain === '24V') return voltage < 20 || voltage > 28
        if (domain === '48V') return voltage < 40 || voltage > 56
        return false
      })
      .map((component) =>
        error({
          id: issueId('voltage-domain', component.id),
          message: `Voltage ${component.props.voltage}V conflicts with the declared domain.`,
          targetType: 'component',
          targetId: component.id,
          suggestion: 'Adjust voltage or change the component domain.',
        }),
      )
  },
}
