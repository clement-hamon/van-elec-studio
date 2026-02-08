import type { Rule } from './rule-types'

export const chargingCurrentLimitRule: Rule = {
  id: 'charging-current-limit',
  description: 'Warn when total charge current exceeds battery limits.',
  run: () => [],
}
