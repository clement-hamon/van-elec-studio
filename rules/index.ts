import type { Rule } from './rule-types'
import { cableCurrentCapacityRule } from './cable-current-capacity'
import { cableVoltageDropRule } from './cable-voltage-drop'
import { componentVoltageDomainRule } from './component-voltage-domain'
import { fuseSizingRule } from './fuse-sizing'

export const rules: Rule[] = [
  cableVoltageDropRule,
  cableCurrentCapacityRule,
  componentVoltageDomainRule,
  fuseSizingRule,
]
