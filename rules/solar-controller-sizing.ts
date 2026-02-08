import type { Rule } from './rule-types'

export const solarControllerSizingRule: Rule = {
  id: 'solar-controller-sizing',
  description: 'Error when solar panel input exceeds controller limits.',
  run: () => [],
}
