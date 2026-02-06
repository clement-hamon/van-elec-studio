import type { Issue } from '~/types/schema'

export const issueId = (prefix: string, targetId: string) => `${prefix}-${targetId}`

export const warning = (payload: Omit<Issue, 'level'>): Issue => ({
  ...payload,
  level: 'warning',
})

export const error = (payload: Omit<Issue, 'level'>): Issue => ({
  ...payload,
  level: 'error',
})
