import type { Rule } from './rule-types'
import { issueId, warning } from './rule-utils'

const MAX_DROP_V = 0.4

export const cableVoltageDropRule: Rule = {
  id: 'cable-voltage-drop',
  description: 'Warn when voltage drop exceeds the target threshold.',
  run: ({ schema }) => {
    return schema.cables
      .filter((cable) => cable.derived.voltageDropV > MAX_DROP_V)
      .map((cable) =>
        warning({
          id: issueId('drop', cable.id),
          message: `Voltage drop is ${cable.derived.voltageDropV.toFixed(
            2,
          )}V. Consider thicker gauge or shorter run.`,
          targetType: 'cable',
          targetId: cable.id,
          suggestion: 'Try 8 AWG or reduce cable length.',
        }),
      )
  },
}
