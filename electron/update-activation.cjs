const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createPublicError, toPublicError } = require('./public-error.cjs')
const {
  claimManagedUpdateActivation,
  getManagedUpdateInternal,
  listRestartRequiredUpdates,
  recordActivationError,
  recordActivationResult,
  recordRollbackResult,
  releaseManagedUpdateActivation,
} = require('./update-store.cjs')
const { validateStagedContent } = require('./update-downloader.cjs')

const LOCK_VERSION = 1
const DEFAULT_STALE_LOCK_MS = 15 * 60 * 1000
const MAX_LOCK_JOURNAL_BYTES = 32 * 1024

class ActivationBusyError extends Error {
  constructor(message = 'Attivazione gia in corso.') {
    super(message)
    this.code = 'UPDATE_ACTIVATION_BUSY'
  }
}

function assertSafeTarget(targetPath) {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath === path.parse(targetPath).root) throw new Error('Destinazione aggiornamento non valida.')
  return path.normalize(targetPath)
}

function pathsOverlap(left, right) {
  const relativeLeft = path.relative(left, right)
  const relativeRight = path.relative(right, left)
  return relativeLeft === '' || (!relativeLeft.startsWith('..') && !path.isAbsolute(relativeLeft)) || (!relativeRight.startsWith('..') && !path.isAbsolute(relativeRight))
}

function lockPathFor(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.vincodelab-update-lock`)
}

function managedSiblingPath(targetPath, label, owner) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.vincodelab-${label}-${owner}`)
}

function isManagedSiblingPath(candidate, targetPath, label, allowLegacy = false) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || path.dirname(candidate) !== path.dirname(targetPath)) return false
  const basename = path.basename(candidate)
  const prefix = `.${path.basename(targetPath)}.vincodelab-${label}`
  return basename.startsWith(`${prefix}-`) || (allowLegacy && basename === prefix)
}

function removeManagedSibling(candidate, targetPath, label, allowLegacy = false) {
  if (!candidate || !isManagedSiblingPath(candidate, targetPath, label, allowLegacy)) return false
  fs.rmSync(candidate, { recursive: true, force: true })
  return true
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function operationEnvironment(dependencies = {}) {
  return {
    host: dependencies.host ?? os.hostname(),
    isProcessAlive: dependencies.isProcessAlive ?? processIsAlive,
    now: dependencies.now ?? Date.now,
    pid: dependencies.pid ?? process.pid,
    staleLockMs: dependencies.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  }
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

function readLockJournal(lockPath) {
  const lockStats = fs.lstatSync(lockPath)
  if (!lockStats.isDirectory() || lockStats.isSymbolicLink()) throw new Error('Lock aggiornamento non valido.')
  const journalPath = path.join(lockPath, 'journal.json')
  if (!fs.existsSync(journalPath)) return { journal: null, modifiedAt: lockStats.mtimeMs }
  const journalStats = fs.lstatSync(journalPath)
  if (!journalStats.isFile() || journalStats.isSymbolicLink() || journalStats.size > MAX_LOCK_JOURNAL_BYTES) throw new Error('Journal aggiornamento non valido.')
  let journal
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  } catch {
    throw new Error('Journal aggiornamento non valido.')
  }
  if (!journal || journal.version !== LOCK_VERSION || typeof journal.owner !== 'string' || typeof journal.targetPath !== 'string') throw new Error('Journal aggiornamento non valido.')
  return { journal, modifiedAt: Math.max(lockStats.mtimeMs, journalStats.mtimeMs) }
}

function writeLockJournal(lock, patch = {}) {
  const next = { ...lock.journal, ...patch, updatedAt: lock.environment.now() }
  atomicWriteJson(path.join(lock.path, 'journal.json'), next)
  lock.journal = next
  return next
}

function activationClaimIsStale(record, environment) {
  if (record?.status !== 'activating' || !record.activation_owner) return false
  if (record.activation_host === environment.host && Number.isInteger(record.activation_pid) && record.activation_pid > 0) {
    return !environment.isProcessAlive(record.activation_pid)
  }
  const startedAt = Number.isFinite(record.activation_started_at) ? record.activation_started_at : 0
  return environment.now() - startedAt >= environment.staleLockMs
}

function targetLockIsStale(lockState, environment) {
  const { journal, modifiedAt } = lockState
  if (journal?.host === environment.host && Number.isInteger(journal.pid) && journal.pid > 0) {
    return !environment.isProcessAlive(journal.pid)
  }
  const timestamp = Number.isFinite(journal?.updatedAt) ? journal.updatedAt : Number.isFinite(journal?.createdAt) ? journal.createdAt : modifiedAt
  return environment.now() - timestamp >= environment.staleLockMs
}

function activationWasCommitted(journal) {
  const record = getManagedUpdateInternal(journal.updateId)
  return Boolean(record
    && record.status === 'active'
    && record.restart_required === 0
    && record.active_version === journal.stagedVersion)
}

function rollbackWasCommitted(journal) {
  const record = getManagedUpdateInternal(journal.updateId)
  return Boolean(record
    && record.status === 'active'
    && record.active_version === journal.rollbackVersion
    && record.rollback_version === journal.activeVersion)
}

function assertActivationJournalPaths(journal) {
  const targetPath = assertSafeTarget(journal.targetPath)
  if (lockPathFor(targetPath) !== journal.lockPath) throw new Error('Journal attivazione non coerente.')
  if (journal.nextPath !== managedSiblingPath(targetPath, 'next', journal.owner)) throw new Error('Percorso temporaneo attivazione non valido.')
  if (journal.backupPath !== managedSiblingPath(targetPath, 'backup', journal.owner)) throw new Error('Percorso backup attivazione non valido.')
  return targetPath
}

function assertRollbackJournalPaths(journal) {
  const targetPath = assertSafeTarget(journal.targetPath)
  if (lockPathFor(targetPath) !== journal.lockPath) throw new Error('Journal rollback non coerente.')
  if (journal.currentPath !== managedSiblingPath(targetPath, 'current', journal.owner)) throw new Error('Percorso temporaneo rollback non valido.')
  if (!isManagedSiblingPath(journal.backupPath, targetPath, 'backup', true)) throw new Error('Percorso backup rollback non valido.')
  return targetPath
}

function restoreActivationFilesystem(journal) {
  const targetPath = assertActivationJournalPaths(journal)
  const backupExists = fs.existsSync(journal.backupPath)
  const nextExists = fs.existsSync(journal.nextPath)
  const targetExists = fs.existsSync(targetPath)

  if (backupExists) {
    if (targetExists) fs.rmSync(targetPath, { recursive: true, force: true })
    fs.renameSync(journal.backupPath, targetPath)
  } else if (journal.hadPreviousTarget === false && targetExists && !nextExists) {
    fs.rmSync(targetPath, { recursive: true, force: true })
  } else if (journal.hadPreviousTarget === true && !targetExists && !nextExists) {
    throw new Error('Versione precedente non recuperabile dopo attivazione interrotta.')
  }
  removeManagedSibling(journal.nextPath, targetPath, 'next')
}

function restoreRollbackFilesystem(journal) {
  const targetPath = assertRollbackJournalPaths(journal)
  const currentExists = fs.existsSync(journal.currentPath)
  const backupExists = fs.existsSync(journal.backupPath)
  const targetExists = fs.existsSync(targetPath)

  if (currentExists) {
    if (targetExists && !backupExists) fs.renameSync(targetPath, journal.backupPath)
    else if (targetExists && backupExists) throw new Error('Stato filesystem rollback ambiguo.')
    fs.renameSync(journal.currentPath, targetPath)
    return
  }

  if (targetExists && backupExists && ['swapping-backup', 'backup-swapped', 'committing'].includes(journal.phase)) {
    fs.renameSync(targetPath, journal.currentPath)
    fs.renameSync(journal.backupPath, targetPath)
    fs.renameSync(journal.currentPath, journal.backupPath)
  }
}

function recoverAbandonedTargetLock(lockPath, lockState) {
  const journal = lockState.journal
  if (!journal) {
    fs.rmSync(lockPath, { recursive: true, force: true })
    return
  }
  if (journal.lockPath !== lockPath) throw new Error('Journal aggiornamento non coerente con il lock.')

  if (journal.operation === 'activate') {
    if (activationWasCommitted(journal)) {
      const targetPath = assertActivationJournalPaths(journal)
      removeManagedSibling(journal.nextPath, targetPath, 'next')
      if (journal.previousBackupPath !== journal.backupPath) removeManagedSibling(journal.previousBackupPath, targetPath, 'backup', true)
    } else {
      restoreActivationFilesystem(journal)
      releaseManagedUpdateActivation(journal.updateId, journal.owner, createPublicError('UPDATE_ACTIVATION_INTERRUPTED', 'Attivazione precedente interrotta e ripristinata.'))
    }
  } else if (journal.operation === 'rollback') {
    if (!rollbackWasCommitted(journal)) restoreRollbackFilesystem(journal)
  } else {
    throw new Error('Operazione del journal aggiornamento non valida.')
  }
  fs.rmSync(lockPath, { recursive: true, force: true })
}

function acquireTargetLock(initialJournal, environment) {
  const targetPath = assertSafeTarget(initialJournal.targetPath)
  const lockPath = lockPathFor(targetPath)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      const lock = {
        environment,
        journal: {
          ...initialJournal,
          version: LOCK_VERSION,
          lockPath,
          createdAt: environment.now(),
          updatedAt: environment.now(),
        },
        path: lockPath,
      }
      try {
        atomicWriteJson(path.join(lockPath, 'journal.json'), lock.journal)
      } catch (error) {
        fs.rmSync(lockPath, { recursive: true, force: true })
        throw error
      }
      return lock
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const lockState = readLockJournal(lockPath)
      if (!targetLockIsStale(lockState, environment)) throw new ActivationBusyError('La destinazione e gia interessata da un aggiornamento.')
      recoverAbandonedTargetLock(lockPath, lockState)
    }
  }
  throw new ActivationBusyError('Impossibile acquisire il lock della destinazione aggiornamento.')
}

function releaseTargetLock(lock) {
  if (!lock || !fs.existsSync(lock.path)) return
  try {
    const { journal } = readLockJournal(lock.path)
    if (journal?.owner !== lock.journal.owner) return
    fs.rmSync(lock.path, { recursive: true, force: true })
  } catch {
    // Un lock non verificabile resta sul disco per il recovery, invece di rischiare
    // di rimuovere il lock appartenente a un altro processo.
  }
}

function copyStagedToSibling(stagingPath, nextPath) {
  fs.rmSync(nextPath, { recursive: true, force: true })
  fs.cpSync(stagingPath, nextPath, { recursive: true, errorOnExist: true, force: false })
}

function cleanupCommittedActivation(record, journal) {
  fs.rmSync(record.staging_path, { recursive: true, force: true })
  if (journal.previousBackupPath !== journal.backupPath) removeManagedSibling(journal.previousBackupPath, journal.targetPath, 'backup', true)
  removeManagedSibling(journal.nextPath, journal.targetPath, 'next')
}

async function activateClaimed(record, owner, dependencies, environment) {
  const targetPath = assertSafeTarget(record.target_path)
  if (!record.staging_path || !record.staged_version) throw new Error('Staging aggiornamento non valido.')
  const stagingPath = assertSafeTarget(record.staging_path)
  if (pathsOverlap(stagingPath, targetPath)) throw new Error('Staging e destinazione aggiornamento non possono sovrapporsi.')
  const journal = {
    operation: 'activate',
    owner,
    updateId: record.id,
    pid: environment.pid,
    host: environment.host,
    targetPath,
    stagingPath,
    stagedVersion: record.staged_version,
    activeVersion: record.active_version,
    previousBackupPath: record.backup_path ?? null,
    nextPath: managedSiblingPath(targetPath, 'next', owner),
    backupPath: managedSiblingPath(targetPath, 'backup', owner),
    phase: 'claimed',
    hadPreviousTarget: null,
  }
  let lock
  let releaseLock = true
  try {
    lock = acquireTargetLock(journal, environment)
    validateStagedContent(record, stagingPath)
    const hadPreviousTarget = fs.existsSync(targetPath)
    writeLockJournal(lock, { phase: 'preparing', hadPreviousTarget })
    copyStagedToSibling(stagingPath, journal.nextPath)
    writeLockJournal(lock, { phase: 'prepared' })

    if (hadPreviousTarget) {
      writeLockJournal(lock, { phase: 'moving-previous' })
      fs.renameSync(targetPath, journal.backupPath)
      writeLockJournal(lock, { phase: 'previous-moved' })
    }
    writeLockJournal(lock, { phase: 'installing' })
    fs.renameSync(journal.nextPath, targetPath)
    writeLockJournal(lock, { phase: 'installed' })

    const healthy = await (dependencies.healthCheck ?? (async ({ targetPath: installedPath }) => validateStagedContent(record, installedPath)))({ id: record.id, kind: record.kind, targetPath })
    if (!healthy) throw createPublicError('UPDATE_HEALTH_CHECK_FAILED', 'Verifica della nuova versione non riuscita.')
    writeLockJournal(lock, { phase: 'committing' })
    const result = recordActivationResult(record.id, {
      activeVersion: record.staged_version,
      previousVersion: record.active_version,
      backupPath: hadPreviousTarget ? journal.backupPath : null,
      success: true,
    }, environment.now(), owner)
    try { writeLockJournal(lock, { phase: 'committed' }) } catch { /* Il commit SQLite e gia autorevole. */ }
    try { cleanupCommittedActivation(record, lock.journal) } catch { /* La prossima fase di staging ripulisce gli artefatti residui. */ }
    return result
  } catch (error) {
    if (error instanceof ActivationBusyError) {
      const publicError = toPublicError(error, { code: 'UPDATE_ACTIVATION_BUSY', message: 'Attivazione gia in corso; l aggiornamento resta pronto.' })
      releaseManagedUpdateActivation(record.id, owner, publicError, environment.now())
      throw publicError
    }
    if (lock) {
      try {
        restoreActivationFilesystem(lock.journal)
        try { writeLockJournal(lock, { phase: 'rolled-back' }) } catch { /* Recovery gia completato sul filesystem. */ }
      } catch (recoveryError) {
        releaseLock = false
        const publicError = createPublicError('UPDATE_ACTIVATION_RECOVERY_FAILED', 'Attivazione non riuscita e ripristino automatico non completato.', recoveryError)
        recordActivationError(record.id, owner, publicError, environment.now())
        throw publicError
      }
    }
    const publicError = toPublicError(error, { code: 'UPDATE_ACTIVATION_FAILED', message: 'Attivazione dell aggiornamento non riuscita.' })
    recordActivationError(record.id, owner, publicError, environment.now())
    throw publicError
  } finally {
    if (releaseLock) releaseTargetLock(lock)
  }
}

async function activatePendingUpdatesInternal(dependencies = {}) {
  const results = []
  const environment = operationEnvironment(dependencies)
  for (const update of listRestartRequiredUpdates()) {
    const observed = getManagedUpdateInternal(update.id)
    const owner = randomUUID()
    const expectedOwner = activationClaimIsStale(observed, environment) ? observed.activation_owner : null
    const record = claimManagedUpdateActivation(update.id, {
      owner,
      pid: environment.pid,
      host: environment.host,
      expectedOwner,
    }, environment.now())
    if (!record) {
      results.push({ id: update.id, success: false, error: createPublicError('UPDATE_ACTIVATION_BUSY', 'Attivazione gia in corso o non piu disponibile.').message })
      continue
    }
    try {
      results.push({ id: update.id, success: true, update: await activateClaimed(record, owner, dependencies, environment) })
    } catch (error) {
      // Copre anche errori di validazione precedenti alla creazione del lock.
      // Se activateClaimed ha gia chiuso o rilasciato il claim, il CAS non cambia nulla.
      const publicError = toPublicError(error, { code: 'UPDATE_ACTIVATION_FAILED', message: 'Attivazione dell aggiornamento non riuscita.' })
      recordActivationError(update.id, owner, publicError, environment.now())
      results.push({ id: update.id, success: false, error: publicError.message })
    }
  }
  return results
}

async function activatePendingUpdates(dependencies = {}) {
  try {
    return await activatePendingUpdatesInternal(dependencies)
  } catch (error) {
    throw toPublicError(error, { code: 'UPDATE_ACTIVATION_FAILED', message: 'Attivazione degli aggiornamenti non riuscita.' })
  }
}

async function rollbackManagedUpdateInternal(id, dependencies = {}) {
  const record = getManagedUpdateInternal(id)
  if (!record?.rollback_version || !record.backup_path) throw new Error('Nessuna versione precedente disponibile.')
  if (record.status !== 'active' || record.restart_required) throw new Error('Un aggiornamento e gia in corso per questa risorsa.')
  const environment = operationEnvironment(dependencies)
  const owner = randomUUID()
  const targetPath = assertSafeTarget(record.target_path)
  const backupPath = assertSafeTarget(record.backup_path)
  if (!isManagedSiblingPath(backupPath, targetPath, 'backup', true) || !fs.existsSync(backupPath)) throw new Error('Backup aggiornamento non disponibile.')
  const journal = {
    operation: 'rollback',
    owner,
    updateId: record.id,
    pid: environment.pid,
    host: environment.host,
    targetPath,
    backupPath,
    currentPath: managedSiblingPath(targetPath, 'current', owner),
    activeVersion: record.active_version,
    rollbackVersion: record.rollback_version,
    phase: 'claimed',
  }
  let lock
  let releaseLock = true
  try {
    lock = acquireTargetLock(journal, environment)
    const current = getManagedUpdateInternal(id)
    if (current?.status !== 'active' || current.restart_required || current.active_version !== record.active_version || current.backup_path !== record.backup_path) {
      throw new ActivationBusyError('Lo stato aggiornamento e cambiato prima del rollback.')
    }
    fs.rmSync(journal.currentPath, { recursive: true, force: true })
    writeLockJournal(lock, { phase: 'moving-current' })
    fs.renameSync(targetPath, journal.currentPath)
    writeLockJournal(lock, { phase: 'current-moved' })
    fs.renameSync(backupPath, targetPath)
    writeLockJournal(lock, { phase: 'restored' })
    const healthy = await (dependencies.healthCheck ?? (async ({ targetPath: installedPath }) => validateStagedContent(record, installedPath)))({ id: record.id, kind: record.kind, targetPath })
    if (!healthy) throw createPublicError('UPDATE_ROLLBACK_FAILED', 'Verifica della versione ripristinata non riuscita.')
    writeLockJournal(lock, { phase: 'swapping-backup' })
    fs.renameSync(journal.currentPath, backupPath)
    writeLockJournal(lock, { phase: 'backup-swapped' })
    const result = recordRollbackResult(record.id, { activeVersion: record.rollback_version, rollbackVersion: record.active_version }, environment.now())
    try { writeLockJournal(lock, { phase: 'committed' }) } catch { /* Il commit SQLite e gia autorevole. */ }
    return result
  } catch (error) {
    if (lock) {
      try {
        restoreRollbackFilesystem(lock.journal)
      } catch (recoveryError) {
        releaseLock = false
        throw createPublicError('UPDATE_ROLLBACK_RECOVERY_FAILED', 'Rollback non riuscito e ripristino automatico non completato.', recoveryError)
      }
    }
    throw toPublicError(error, { code: 'UPDATE_ROLLBACK_FAILED', message: 'Ripristino della versione precedente non riuscito.' })
  } finally {
    if (releaseLock) releaseTargetLock(lock)
  }
}

async function rollbackManagedUpdate(id, dependencies = {}) {
  try {
    return await rollbackManagedUpdateInternal(id, dependencies)
  } catch (error) {
    throw toPublicError(error, { code: 'UPDATE_ROLLBACK_FAILED', message: 'Ripristino della versione precedente non riuscito.' })
  }
}

module.exports = { activatePendingUpdates, rollbackManagedUpdate }
