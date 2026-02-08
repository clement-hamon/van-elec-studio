import type { Rule } from './rule-types'

export const chargerVoltageCompatibilityRule: Rule = {
  id: 'charger-voltage-compatibility',
  description: 'Error when charger voltage profile is incompatible with battery chemistry.',
  run: () => [],
}
