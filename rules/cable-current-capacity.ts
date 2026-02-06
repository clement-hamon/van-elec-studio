import type { Rule } from './rule-types'
import { issueId, warning } from './rule-utils'

export const cableCurrentCapacityRule: Rule = {
  id: 'cable-current-capacity',
  description: 'Warn when cable current capacity is below expected current.',
  run: ({ schema }) => {
    return schema.cables
      .filter((cable) => cable.derived.maxCurrentA < 50)
      .map((cable) =>
        warning({
          id: issueId('ampacity', cable.id),
          message: `Cable ampacity (${cable.derived.maxCurrentA}A) is low for main feeds.`,
          targetType: 'cable',
          targetId: cable.id,
          suggestion: 'Increase gauge or reduce expected current draw.',
        }),
      )
  },
}
