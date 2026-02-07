import type { Rule } from './rule-types'
import { cableCurrentCapacityRule } from './cable-current-capacity'
import { cableAwgRecommendationRule } from './cable-awg-recommendation'
import { cableVoltageDropRule } from './cable-voltage-drop'
import { componentVoltageDomainRule } from './component-voltage-domain'
import { fuseSizingRule } from './fuse-sizing'
import { operatingVoltageRule } from './operating-voltage'

export const rules: Rule[] = [
  cableVoltageDropRule,
  cableCurrentCapacityRule,
  cableAwgRecommendationRule,
  componentVoltageDomainRule,
  fuseSizingRule,
  operatingVoltageRule,
]
