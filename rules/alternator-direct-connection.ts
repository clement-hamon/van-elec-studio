import type { Rule } from './rule-types'

export const alternatorDirectConnectionRule: Rule = {
  id: 'alternator-direct-connection',
  description: 'Warn when alternator connects directly to a battery without a DC-DC charger.',
  run: () => [],
}
