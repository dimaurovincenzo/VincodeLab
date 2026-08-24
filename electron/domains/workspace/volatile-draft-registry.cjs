const { Buffer } = require('node:buffer')

const ALLOWED_SCOPES = new Set([
  'project-editor',
  'project-instructions',
  'project-skill',
  'settings-package-source',
  'settings-new-skill',
  'settings-system-skill',
  'database-sql',
  'database-connection',
  'database-grid',
])

const MAX_DRAFTS = 128
const MAX_IDENTITY_BYTES = 4_096
const MAX_CONTENT_BYTES = 1_000_000

function assertBoundedString(value, label, maxBytes) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} della bozza non valido.`)
  }
  return value
}

function normalizeIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Identità della bozza non valida.')
  if (!ALLOWED_SCOPES.has(value.scope)) throw new Error('Ambito della bozza non valido.')
  return {
    scope: value.scope,
    workspace: assertBoundedString(value.workspace, 'Workspace', MAX_IDENTITY_BYTES),
    resource: assertBoundedString(value.resource, 'Risorsa', MAX_IDENTITY_BYTES),
  }
}

function normalizeDraft(value) {
  const identity = normalizeIdentity(value)
  return {
    ...identity,
    content: assertBoundedString(value.content, 'Contenuto', MAX_CONTENT_BYTES),
    baseline: assertBoundedString(value.baseline, 'Baseline', MAX_CONTENT_BYTES),
  }
}

function keyOf(identity) {
  return JSON.stringify([identity.scope, identity.workspace, identity.resource])
}

function createVolatileDraftRegistry({ maxDrafts = MAX_DRAFTS } = {}) {
  if (!Number.isInteger(maxDrafts) || maxDrafts < 1 || maxDrafts > MAX_DRAFTS) throw new Error('Limite bozze non valido.')
  const entries = new Map()
  let sequence = 0

  function trim() {
    while (entries.size > maxDrafts) {
      let oldestKey = null
      let oldestSequence = Number.POSITIVE_INFINITY
      for (const [key, entry] of entries) {
        if (entry.sequence >= oldestSequence) continue
        oldestKey = key
        oldestSequence = entry.sequence
      }
      if (oldestKey === null) return
      entries.delete(oldestKey)
    }
  }

  return {
    list() {
      return [...entries.values()]
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ sequence: _sequence, ...entry }) => ({ ...entry }))
    },
    write(value) {
      const draft = normalizeDraft(value)
      const key = keyOf(draft)
      if (draft.content === draft.baseline) {
        entries.delete(key)
        return { stored: false }
      }
      entries.set(key, { ...draft, sequence: ++sequence })
      trim()
      return { stored: true }
    },
    discard(value) {
      return { discarded: entries.delete(keyOf(normalizeIdentity(value))) }
    },
    clear() {
      const cleared = entries.size
      entries.clear()
      sequence = 0
      return { cleared }
    },
  }
}

module.exports = {
  ALLOWED_SCOPES,
  MAX_CONTENT_BYTES,
  MAX_DRAFTS,
  createVolatileDraftRegistry,
  normalizeDraft,
  normalizeIdentity,
}
