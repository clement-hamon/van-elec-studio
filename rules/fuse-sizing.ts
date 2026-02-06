import type { Rule } from './rule-types'
import { error, issueId, warning } from './rule-utils'
import type { Cable } from '~/types/schema'

export const fuseSizingRule: Rule = {
  id: 'fuse-sizing',
  description: 'Check that fuse rating is between expected current and cable ampacity.',
  run: ({ schema }) => {
    const fuseIds = schema.components
      .filter((component) => component.typeId === 'fuse')
      .map((component) => component.id)

    const issues = []

    fuseIds.forEach((fuseId) => {
      const fuse = schema.components.find((component) => component.id === fuseId)
      const rating = Number(fuse?.props.ratingA ?? 0)

      const outgoing = schema.cables.filter((cable) => cable.sourceId === fuseId)
      if (outgoing.length === 0) {
        issues.push(
          warning({
            id: issueId('fuse-no-cable', fuseId),
            message: 'Fuse has no protected cable connected.',
            targetType: 'component',
            targetId: fuseId,
            suggestion: 'Connect a cable downstream of the fuse.',
          }),
        )
        return
      }

      const minAmpacity = Math.min(...outgoing.map((cable: Cable) => cable.derived.ampacityA))
      const maxExpected = Math.max(
        ...outgoing.map((cable: Cable) => cable.derived.expectedCurrentA),
      )

      if (rating <= 0) {
        issues.push(
          error({
            id: issueId('fuse-missing-rating', fuseId),
            message: 'Fuse rating is missing or invalid.',
            targetType: 'component',
            targetId: fuseId,
            suggestion: 'Set a fuse rating in amps.',
          }),
        )
        return
      }

      if (rating < maxExpected) {
        issues.push(
          error({
            id: issueId('fuse-underrated', fuseId),
            message: `Fuse rating (${rating}A) is below expected current (${maxExpected.toFixed(
              1,
            )}A).`,
            targetType: 'component',
            targetId: fuseId,
            suggestion: 'Increase the fuse rating or reduce downstream load.',
          }),
        )
      }

      if (rating > minAmpacity) {
        issues.push(
          error({
            id: issueId('fuse-overrated', fuseId),
            message: `Fuse rating (${rating}A) exceeds cable ampacity (${minAmpacity}A).`,
            targetType: 'component',
            targetId: fuseId,
            suggestion: 'Reduce fuse rating or use a larger cable gauge.',
          }),
        )
      }

      if (rating >= maxExpected * 1.5 && rating <= minAmpacity) {
        issues.push(
          warning({
            id: issueId('fuse-high-margin', fuseId),
            message: `Fuse rating (${rating}A) is much higher than expected current (${maxExpected.toFixed(
              1,
            )}A).`,
            targetType: 'component',
            targetId: fuseId,
            suggestion: 'Consider a smaller fuse for better protection.',
          }),
        )
      }
    })

    return issues
  },
}
