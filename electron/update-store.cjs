const { getDatabase } = require('./workspace-store.cjs')
const { toPublicError } = require('./public-error.cjs')

const KINDS = new Set(['skill', 'pi-extension', 'pi-runtime'])
const POLICIES = new Set(['manual', 'automatic'])
const SOURCE_TYPES = new Set(['github', 'runtime'])
const MAX_TEXT_LENGTH = 4_096
const UPDATE_ERROR_MESSAGES = Object.freeze({
  UPDATE_FAILED: 'Operazione di aggiornamento non riuscita.',
  UPDATE_ACTIVATION_BUSY: 'Attivazione gia in corso; l aggiornamento resta pronto.',
  UPDATE_ACTIVATION_FAILED: 'Attivazione dell aggiornamento non riuscita.',
  UPDATE_ACTIVATION_INTERRUPTED: 'Un attivazione precedente e stata interrotta e ripristinata.',
  UPDATE_ACTIVATION_RECOVERY_FAILED: 'Attivazione non riuscita e ripristino automatico non completato.',
  UPDATE_HEALTH_CHECK_FAILED: 'Verifica della nuova versione non riuscita.',
  UPDATE_ROLLBACK_FAILED: 'Ripristino della versione precedente non riuscito.',
  UPDATE_ROLLBACK_RECOVERY_FAILED: 'Rollback non riuscito e ripristino automatico non completato.',
  UPDATE_STAGE_FAILED: 'Preparazione dell aggiornamento non riuscita.',
  UPDATE_STAGE_VALIDATION_FAILED: 'Verifica di integrita dell aggiornamento non riuscita.',
})

function normalizeUpdateErrorCode(error, fallbackCode) {
  const code = toPublicError(error, {
    code: fallbackCode,
    message: UPDATE_ERROR_MESSAGES[fallbackCode],
  }).code
  return Object.hasOwn(UPDATE_ERROR_MESSAGES, code) ? code : fallbackCode
}

function updateErrorMessage(value) {
  if (!value) return null
  const code = Object.hasOwn(UPDATE_ERROR_MESSAGES, value) ? value : 'UPDATE_FAILED'
  return `${UPDATE_ERROR_MESSAGES[code]} [${code}]`
}

function assertText(value, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} non valido.`)
    return null
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || [...value].some((character) => character.charCodeAt(0) < 32)) throw new Error(`${label} non valido.`)
  return value.trim() || (required ? (() => { throw new Error(`${label} non valido.`) })() : null)
}

function assertEnum(value, values, label) {
  if (!values.has(value)) throw new Error(`${label} non valido.`)
  return value
}

function ensureUpdateSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS managed_updates (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('skill', 'pi-extension', 'pi-runtime')),
      name TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('github', 'runtime')),
      source_url TEXT,
      owner TEXT,
      repository TEXT,
      ref TEXT,
      channel TEXT NOT NULL,
      active_version TEXT NOT NULL,
      rollback_version TEXT,
      available_version TEXT,
      changelog TEXT,
      policy TEXT NOT NULL DEFAULT 'manual' CHECK(policy IN ('manual', 'automatic')),
      status TEXT NOT NULL DEFAULT 'active',
      restart_required INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      last_error TEXT,
      activated_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS managed_updates_kind ON managed_updates(kind);
    CREATE INDEX IF NOT EXISTS managed_updates_restart_required ON managed_updates(restart_required);
  `)
  const columns = new Set(getDatabase().prepare('PRAGMA table_info(managed_updates)').all().map((column) => column.name))
  for (const [name, definition] of Object.entries({
    staged_version: 'TEXT',
    staging_path: 'TEXT',
    target_path: 'TEXT',
    backup_path: 'TEXT',
    activation_owner: 'TEXT',
    activation_pid: 'INTEGER',
    activation_host: 'TEXT',
    activation_started_at: 'INTEGER',
  })) {
    if (columns.has(name)) continue
    try {
      getDatabase().exec(`ALTER TABLE managed_updates ADD COLUMN ${name} ${definition}`)
      columns.add(name)
    } catch (error) {
      // Due istanze possono migrare lo stesso database al primo avvio. SQLite
      // serializza ALTER TABLE, ma la seconda puo aver letto lo schema precedente.
      const currentColumns = new Set(getDatabase().prepare('PRAGMA table_info(managed_updates)').all().map((column) => column.name))
      if (!currentColumns.has(name)) throw error
      columns.add(name)
    }
  }
}

function toUpdate(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    owner: row.owner,
    repository: row.repository,
    ref: row.ref,
    channel: row.channel,
    activeVersion: row.active_version,
    rollbackVersion: row.rollback_version,
    availableVersion: row.available_version,
    changelog: row.changelog,
    policy: row.policy,
    status: row.status,
    restartRequired: Boolean(row.restart_required),
    lastCheckedAt: row.last_checked_at,
    lastError: updateErrorMessage(row.last_error),
    activatedAt: row.activated_at,
    stagedVersion: row.staged_version,
  }
}

function getManagedUpdate(id) {
  ensureUpdateSchema()
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  return toUpdate(getDatabase().prepare('SELECT * FROM managed_updates WHERE id = ?').get(validId))
}

function listManagedUpdates() {
  ensureUpdateSchema()
  return getDatabase().prepare('SELECT * FROM managed_updates ORDER BY kind, name COLLATE NOCASE').all().map(toUpdate)
}

function upsertManagedUpdate(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Aggiornamento non valido.')
  const id = assertText(input.id, 'Identificativo aggiornamento', true)
  const kind = assertEnum(input.kind, KINDS, 'Canale aggiornamento')
  const name = assertText(input.name, 'Nome aggiornamento', true)
  const sourceType = assertEnum(input.sourceType, SOURCE_TYPES, 'Sorgente aggiornamento')
  const sourceUrl = assertText(input.sourceUrl, 'URL sorgente')
  const owner = assertText(input.owner, 'Proprietario sorgente')
  const repository = assertText(input.repository, 'Repository sorgente')
  const ref = assertText(input.ref, 'Riferimento sorgente')
  const channel = assertText(input.channel, 'Canale aggiornamento', true)
  const activeVersion = assertText(input.activeVersion, 'Versione attiva', true)
  const targetPath = assertText(input.targetPath, 'Destinazione aggiornamento')
  if (targetPath && !require('node:path').isAbsolute(targetPath)) throw new Error('Destinazione aggiornamento non valida.')
  if (sourceType === 'github' && (!owner || !repository || !ref)) throw new Error('Sorgente GitHub non valida.')

  ensureUpdateSchema()
  getDatabase().prepare(`
    INSERT INTO managed_updates (id, kind, name, source_type, source_url, owner, repository, ref, channel, active_version, target_path, policy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, name = excluded.name, source_type = excluded.source_type,
      source_url = excluded.source_url, owner = excluded.owner, repository = excluded.repository,
      ref = excluded.ref, channel = excluded.channel,
      available_version = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.available_version WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.available_version END,
      staged_version = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.staged_version WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.staged_version END,
      staging_path = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.staging_path WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.staging_path END,
      rollback_version = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.rollback_version WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.rollback_version END,
      backup_path = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.backup_path WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.backup_path END,
      activation_owner = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.activation_owner WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.activation_owner END,
      activation_pid = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.activation_pid WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.activation_pid END,
      activation_host = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.activation_host WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.activation_host END,
      activation_started_at = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.activation_started_at WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.activation_started_at END,
      restart_required = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.restart_required WHEN managed_updates.active_version != excluded.active_version THEN 0 ELSE managed_updates.restart_required END,
      status = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.status WHEN managed_updates.active_version != excluded.active_version THEN 'active' ELSE managed_updates.status END,
      last_error = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.last_error WHEN managed_updates.active_version != excluded.active_version THEN NULL ELSE managed_updates.last_error END,
      active_version = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.active_version ELSE excluded.active_version END,
      target_path = CASE WHEN managed_updates.status = 'activating' THEN managed_updates.target_path ELSE COALESCE(excluded.target_path, managed_updates.target_path) END,
      updated_at = excluded.updated_at
  `).run(id, kind, name, sourceType, sourceUrl, owner, repository, ref, channel, activeVersion, targetPath, now)
  return getManagedUpdate(id)
}

function recordAvailableUpdate(id, available, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  if (!available || typeof available !== 'object' || Array.isArray(available)) throw new Error('Aggiornamento disponibile non valido.')
  const version = assertText(available.availableVersion, 'Versione disponibile')
  const changelog = assertText(available.changelog, 'Changelog')
  const checkedAt = Number.isFinite(available.checkedAt) ? available.checkedAt : now
  ensureUpdateSchema()
  const result = getDatabase().prepare(`
    UPDATE managed_updates
    SET available_version = ?, changelog = ?, status = ?, last_checked_at = ?, last_error = NULL, updated_at = ?
    WHERE id = ? AND restart_required = 0 AND status != 'activating'
  `).run(version, changelog, version ? 'available' : 'active', checkedAt, now, validId)
  if (result.changes !== 1 && !getManagedUpdateInternal(validId)) throw new Error('Aggiornamento non trovato.')
  return getManagedUpdate(validId)
}

function recordStagedUpdate(id, staged, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  if (!staged || typeof staged !== 'object' || Array.isArray(staged)) throw new Error('Staging aggiornamento non valido.')
  const stagedVersion = assertText(staged.stagedVersion, 'Versione staged', true)
  const stagingPath = assertText(staged.stagingPath, 'Percorso staging', true)
  if (!require('node:path').isAbsolute(stagingPath)) throw new Error('Percorso staging non valido.')
  ensureUpdateSchema()
  const current = getDatabase().prepare('SELECT available_version, restart_required, status FROM managed_updates WHERE id = ?').get(validId)
  if (!current || current.available_version !== stagedVersion) throw new Error('Versione staged non coerente con quella disponibile.')
  if (current.restart_required || current.status === 'activating') throw new Error('Un aggiornamento e gia pronto o in attivazione.')
  const changed = getDatabase().prepare(`
    UPDATE managed_updates
    SET staged_version = ?, staging_path = ?, status = 'ready', restart_required = 1,
        activation_owner = NULL, activation_pid = NULL, activation_host = NULL, activation_started_at = NULL,
        last_error = NULL, updated_at = ?
    WHERE id = ? AND available_version = ? AND restart_required = 0 AND status != 'activating'
  `).run(stagedVersion, stagingPath, now, validId, stagedVersion)
  if (changed.changes !== 1) throw new Error('Stato aggiornamento cambiato durante lo staging.')
  return getManagedUpdate(validId)
}

function claimManagedUpdateActivation(id, claim, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('Claim attivazione non valido.')
  const owner = assertText(claim.owner, 'Proprietario attivazione', true)
  const host = assertText(claim.host, 'Host attivazione', true)
  const pid = Number.isInteger(claim.pid) && claim.pid > 0 ? claim.pid : null
  if (!pid) throw new Error('Processo attivazione non valido.')
  const expectedOwner = assertText(claim.expectedOwner, 'Proprietario attivazione precedente')
  ensureUpdateSchema()

  const statement = expectedOwner
    ? getDatabase().prepare(`
        UPDATE managed_updates
        SET status = 'activating', activation_owner = ?, activation_pid = ?, activation_host = ?,
            activation_started_at = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'activating' AND activation_owner = ?
          AND restart_required = 1 AND staged_version IS NOT NULL AND staging_path IS NOT NULL
      `)
    : getDatabase().prepare(`
        UPDATE managed_updates
        SET status = 'activating', activation_owner = ?, activation_pid = ?, activation_host = ?,
            activation_started_at = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'ready'
          AND restart_required = 1 AND staged_version IS NOT NULL AND staging_path IS NOT NULL
      `)
  const parameters = expectedOwner
    ? [owner, pid, host, now, now, validId, expectedOwner]
    : [owner, pid, host, now, now, validId]
  const changed = statement.run(...parameters)
  return changed.changes === 1 ? getManagedUpdateInternal(validId) : null
}

function releaseManagedUpdateActivation(id, owner, error = null, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  const validOwner = assertText(owner, 'Proprietario attivazione', true)
  const errorCode = error === null ? null : normalizeUpdateErrorCode(error, 'UPDATE_ACTIVATION_BUSY')
  ensureUpdateSchema()
  const changed = getDatabase().prepare(`
    UPDATE managed_updates
    SET status = 'ready', activation_owner = NULL, activation_pid = NULL, activation_host = NULL,
        activation_started_at = NULL, last_error = ?, updated_at = ?
    WHERE id = ? AND status = 'activating' AND activation_owner = ? AND restart_required = 1
  `).run(errorCode, now, validId, validOwner)
  return changed.changes === 1
}

function recordActivationError(id, owner, error, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  const validOwner = assertText(owner, 'Proprietario attivazione', true)
  const errorCode = normalizeUpdateErrorCode(error, 'UPDATE_ACTIVATION_FAILED')
  ensureUpdateSchema()
  const changed = getDatabase().prepare(`
    UPDATE managed_updates
    SET status = 'error', last_error = ?, restart_required = 0,
        activation_owner = NULL, activation_pid = NULL, activation_host = NULL, activation_started_at = NULL,
        updated_at = ?
    WHERE id = ? AND status = 'activating' AND activation_owner = ?
  `).run(errorCode, now, validId, validOwner)
  return changed.changes === 1 ? getManagedUpdate(validId) : null
}

function listRestartRequiredUpdates() {
  ensureUpdateSchema()
  return getDatabase().prepare('SELECT * FROM managed_updates WHERE restart_required = 1 ORDER BY updated_at, id').all().map(toUpdate)
}

function getManagedUpdateInternal(id) {
  ensureUpdateSchema()
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  return getDatabase().prepare('SELECT * FROM managed_updates WHERE id = ?').get(validId) ?? null
}

function recordUpdateError(id, error, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  const errorCode = normalizeUpdateErrorCode(error, 'UPDATE_STAGE_FAILED')
  ensureUpdateSchema()
  getDatabase().prepare(`
    UPDATE managed_updates
    SET status = 'error', last_error = ?, restart_required = 0,
        activation_owner = NULL, activation_pid = NULL, activation_host = NULL, activation_started_at = NULL,
        updated_at = ?
    WHERE id = ? AND restart_required = 0 AND status != 'activating'
  `).run(errorCode, now, validId)
  return getManagedUpdate(validId)
}

function setManagedUpdatePolicy(id, policy, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  const validPolicy = assertEnum(policy, POLICIES, 'Policy aggiornamento')
  ensureUpdateSchema()
  const result = getDatabase().prepare('UPDATE managed_updates SET policy = ?, updated_at = ? WHERE id = ?').run(validPolicy, now, validId)
  if (result.changes !== 1) throw new Error('Aggiornamento non trovato.')
  return getManagedUpdate(validId)
}

function recordActivationResult(id, result, now = Date.now(), activationOwner = null) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Esito attivazione non valido.')
  const activeVersion = assertText(result.activeVersion, 'Versione attiva', true)
  const previousVersion = assertText(result.previousVersion, 'Versione precedente')
  const backupPath = assertText(result.backupPath, 'Percorso backup')
  if (backupPath && !require('node:path').isAbsolute(backupPath)) throw new Error('Percorso backup non valido.')
  if (result.success !== true) throw new Error('Esito attivazione non valido.')
  const validOwner = activationOwner === null ? null : assertText(activationOwner, 'Proprietario attivazione', true)
  ensureUpdateSchema()
  const update = getManagedUpdate(validId)
  if (!update) throw new Error('Aggiornamento non trovato.')
  const ownerConstraint = validOwner ? " AND status = 'activating' AND activation_owner = ? AND staged_version = ?" : ''
  const changed = getDatabase().prepare(`
    UPDATE managed_updates
    SET active_version = ?, rollback_version = ?, available_version = NULL, changelog = NULL,
        staged_version = NULL, staging_path = NULL, backup_path = ?, status = 'active', restart_required = 0,
        activation_owner = NULL, activation_pid = NULL, activation_host = NULL, activation_started_at = NULL,
        last_error = NULL, activated_at = ?, updated_at = ?
    WHERE id = ?${ownerConstraint}
  `).run(activeVersion, previousVersion, backupPath, now, now, validId, ...(validOwner ? [validOwner, activeVersion] : []))
  if (changed.changes !== 1) throw new Error('Claim attivazione non piu valido.')
  return getManagedUpdate(validId)
}

function recordRollbackResult(id, result, now = Date.now()) {
  const validId = assertText(id, 'Identificativo aggiornamento', true)
  const activeVersion = assertText(result?.activeVersion, 'Versione attiva', true)
  const rollbackVersion = assertText(result?.rollbackVersion, 'Versione rollback', true)
  ensureUpdateSchema()
  const changed = getDatabase().prepare("UPDATE managed_updates SET active_version = ?, rollback_version = ?, status = 'active', last_error = NULL, activated_at = ?, updated_at = ? WHERE id = ?").run(activeVersion, rollbackVersion, now, now, validId)
  if (changed.changes !== 1) throw new Error('Aggiornamento non trovato.')
  return getManagedUpdate(validId)
}

module.exports = {
  claimManagedUpdateActivation,
  getManagedUpdate,
  getManagedUpdateInternal,
  listManagedUpdates,
  listRestartRequiredUpdates,
  recordActivationError,
  recordActivationResult,
  recordAvailableUpdate,
  recordRollbackResult,
  recordStagedUpdate,
  recordUpdateError,
  releaseManagedUpdateActivation,
  setManagedUpdatePolicy,
  upsertManagedUpdate,
}
