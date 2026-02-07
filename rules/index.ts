import type { Rule } from './rule-types'
import { cableCurrentCapacityRule } from './cable-current-capacity'
import { cableAwgRecommendationRule } from './cable-awg-recommendation'
import { cableVoltageDropRule } from './cable-voltage-drop'
import { componentVoltageDomainRule } from './component-voltage-domain'
import { fuseSizingRule } from './fuse-sizing'
import { operatingVoltageRule } from './operating-voltage'
import { chargingCurrentLimitRule } from './charging-current-limit'
import { chargerVoltageCompatibilityRule } from './charger-voltage-compatibility'
import { alternatorDirectConnectionRule } from './alternator-direct-connection'
import { solarControllerSizingRule } from './solar-controller-sizing'
import { domainCompatibilityRule } from './domain-compatibility'
import { directionCompatibilityRule } from './direction-compatibility'

export const rules: Rule[] = [
  cableVoltageDropRule,
  cableCurrentCapacityRule,
  cableAwgRecommendationRule,
  componentVoltageDomainRule,
  domainCompatibilityRule,
  directionCompatibilityRule,
  fuseSizingRule,
  operatingVoltageRule,
  chargingCurrentLimitRule,
  chargerVoltageCompatibilityRule,
  alternatorDirectConnectionRule,
  solarControllerSizingRule,
]
