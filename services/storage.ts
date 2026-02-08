import type { SchemaState } from '~/types/schema'

const STORAGE_KEY = 'van-elec.schema.v1'
const SCHEMA_VERSION = 1

export type PersistedSchema = {
  version: number
  savedAt: string
  schema: SchemaState
}

const isClient = () => typeof window !== 'undefined'

export const loadSchema = (): SchemaState | null => {
  if (!isClient()) return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const payload = JSON.parse(raw) as PersistedSchema
    if (!payload || typeof payload !== 'object') return null
    if (payload.version !== SCHEMA_VERSION) return null
    if (!payload.schema) return null
    return payload.schema
  } catch (error) {
    console.error('Failed to load schema from storage', error)
    return null
  }
}

export const saveSchema = (schema: SchemaState) => {
  if (!isClient()) return
  const payload: PersistedSchema = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    schema,
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export const clearSchema = () => {
  if (!isClient()) return
  window.localStorage.removeItem(STORAGE_KEY)
}
