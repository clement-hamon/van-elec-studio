import type { SchemaState } from '~/types/schema'

const STORAGE_KEY = 'van-elec.schema.v1'
const HISTORY_KEY = 'van-elec.schema.history.v1'
const SCHEMA_VERSION = 1
const HISTORY_LIMIT = 50

export type PersistedSchema = {
  version: number
  savedAt: string
  schema: SchemaState
}

type HistoryEntry = {
  savedAt: string
  schema: SchemaState
}

type PersistedHistory = {
  version: number
  entries: HistoryEntry[]
}

const isClient = () => typeof window !== 'undefined'

const readPersistedSchema = (): PersistedSchema | null => {
  if (!isClient()) return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as PersistedSchema
    if (!payload || typeof payload !== 'object') return null
    if (payload.version !== SCHEMA_VERSION) return null
    if (!payload.schema) return null
    return payload
  } catch (error) {
    console.error('Failed to load schema from storage', error)
    return null
  }
}

const readHistory = (): PersistedHistory => {
  if (!isClient()) return { version: SCHEMA_VERSION, entries: [] }
  const raw = window.localStorage.getItem(HISTORY_KEY)
  if (!raw) return { version: SCHEMA_VERSION, entries: [] }
  try {
    const payload = JSON.parse(raw) as PersistedHistory
    if (!payload || typeof payload !== 'object') return { version: SCHEMA_VERSION, entries: [] }
    if (payload.version !== SCHEMA_VERSION) return { version: SCHEMA_VERSION, entries: [] }
    if (!Array.isArray(payload.entries)) return { version: SCHEMA_VERSION, entries: [] }
    return payload
  } catch (error) {
    console.error('Failed to load schema history from storage', error)
    return { version: SCHEMA_VERSION, entries: [] }
  }
}

const writeSchema = (payload: PersistedSchema) => {
  if (!isClient()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

const writeHistory = (payload: PersistedHistory) => {
  if (!isClient()) return
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(payload))
}

export const loadSchema = (): SchemaState | null => {
  const payload = readPersistedSchema()
  return payload?.schema ?? null
}

export const saveSchema = (schema: SchemaState) => {
  if (!isClient()) return
  const currentPayload = readPersistedSchema()
  const currentSchemaRaw = currentPayload ? JSON.stringify(currentPayload.schema) : null
  const nextSchemaRaw = JSON.stringify(schema)

  if (currentPayload && currentSchemaRaw !== nextSchemaRaw) {
    const history = readHistory()
    history.entries.push({
      savedAt: currentPayload.savedAt,
      schema: currentPayload.schema,
    })
    if (history.entries.length > HISTORY_LIMIT) {
      history.entries.splice(0, history.entries.length - HISTORY_LIMIT)
    }
    writeHistory(history)
  }

  const payload: PersistedSchema = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    schema,
  }
  writeSchema(payload)
}

export const clearSchema = () => {
  if (!isClient()) return
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(HISTORY_KEY)
}

export const getHistoryDepth = () => {
  const history = readHistory()
  return history.entries.length
}

export const undoSchema = (): SchemaState | null => {
  if (!isClient()) return null
  const history = readHistory()
  if (history.entries.length === 0) return null
  const previous = history.entries.pop()
  writeHistory(history)
  if (!previous) return null
  writeSchema({
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    schema: previous.schema,
  })
  return previous.schema
}
