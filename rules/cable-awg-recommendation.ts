import type { Rule } from './rule-types'
import { warning, issueId } from './rule-utils'
import {
  findRequiredAwgForCurrent,
  findRequiredAwgForVoltageDrop,
  awgToMm2,
} from '~/services/cable'

const DEFAULT_VDROP_TARGET = 0.03

export const cableAwgRecommendationRule: Rule = {
  id: 'cable-awg-recommendation',
  description: 'Recommend a minimum AWG based on current and voltage drop.',
  run: ({ schema }) => {
    return schema.cables
      .map((cable) => {
        const current = cable.derived.expectedCurrentA
        const circuitVoltage = cable.derived.circuitVoltageV
        if (!current || !circuitVoltage) return null

        const maxDropV = circuitVoltage * DEFAULT_VDROP_TARGET
        const requiredByCurrent = findRequiredAwgForCurrent(current)
        const requiredByDrop = findRequiredAwgForVoltageDrop(maxDropV, cable.props.lengthM, current)
        const recommendedAwg = Math.min(requiredByCurrent, requiredByDrop)
        const currentGauge = cable.props.gaugeAwg

        if (currentGauge <= recommendedAwg) return null

        return warning({
          id: issueId('awg-recommendation', cable.id),
          message: `Cable gauge ${currentGauge} AWG may be too small for ${current.toFixed(
            1,
          )}A over ${cable.props.lengthM}m.`,
          targetType: 'cable',
          targetId: cable.id,
          suggestion: `Recommended: ${recommendedAwg} AWG (≈ ${awgToMm2(recommendedAwg).toFixed(
            2,
          )} mm²).`,
        })
      })
      .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
  },
}
