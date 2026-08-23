const { execFile } = require('node:child_process')
const { environmentForGitHubCli, resolveGitHubCliExecutable } = require('./github-cli-executable.cjs')

const GITHUB_PART = /^[A-Za-z0-9_.-]{1,128}$/
const COMMIT = /^[0-9a-f]{7,64}$/i
const MAX_CHANGELOG_LENGTH = 8_192

function assertGitHubRecord(record) {
  if (!record || record.sourceType !== 'github' || !GITHUB_PART.test(record.owner ?? '') || !GITHUB_PART.test(record.repository ?? '') || typeof record.ref !== 'string' || record.ref.length === 0 || record.ref.length > 256 || !COMMIT.test(record.activeVersion ?? '')) {
    throw new Error('Sorgente aggiornamento non valida.')
  }
}

function runGitHub(args) {
  return new Promise((resolve, reject) => {
    const executable = resolveGitHubCliExecutable()
    if (!executable) {
      reject(new Error('GitHub CLI non è stato trovato.'))
      return
    }
    execFile(executable, args, { env: environmentForGitHubCli(executable), timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error('Controllo remoto non disponibile.')); return }
      resolve(stdout.trim())
    })
  })
}

async function readGitHubRef(record) {
  assertGitHubRecord(record)
  const endpoint = `repos/${record.owner}/${record.repository}/commits/${encodeURIComponent(record.ref)}`
  const commit = await runGitHub(['api', endpoint, '--jq', '.sha'])
  if (!COMMIT.test(commit)) throw new Error('Metadati remoti non validi.')
  return { owner: record.owner, repository: record.repository, ref: record.ref, commit, changelog: null }
}

function normalizeChangelog(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Metadati remoti non validi.')
  return value.slice(0, MAX_CHANGELOG_LENGTH)
}

async function checkManagedUpdate(record, dependencies = {}) {
  if (record?.sourceType === 'runtime') {
    if (typeof record.activeVersion !== 'string' || !record.activeVersion) throw new Error('Sorgente aggiornamento non valida.')
    const remote = await dependencies.readRuntimeVersion?.(record)
    if (!remote || typeof remote.version !== 'string' || !remote.version) throw new Error('Metadati remoti non validi.')
    const checkedAt = (dependencies.now ?? Date.now)()
    const available = remote.version !== record.activeVersion
    return { available, availableVersion: available ? remote.version : null, changelog: available ? normalizeChangelog(remote.changelog) : null, checkedAt }
  }
  assertGitHubRecord(record)
  const remote = await (dependencies.readGitHubRef ?? readGitHubRef)(record)
  if (!remote || remote.owner !== record.owner || remote.repository !== record.repository || remote.ref !== record.ref || !COMMIT.test(remote.commit ?? '')) {
    throw new Error('Sorgente remota non autorizzata.')
  }
  const checkedAt = (dependencies.now ?? Date.now)()
  const available = remote.commit !== record.activeVersion
  return { available, availableVersion: available ? remote.commit : null, changelog: available ? normalizeChangelog(remote.changelog) : null, checkedAt }
}

function checkEligibleUpdates(records, now = Date.now()) {
  const threshold = now - 24 * 60 * 60 * 1000
  return records.filter((record) => !record.lastCheckedAt || record.lastCheckedAt < threshold)
}

module.exports = { checkEligibleUpdates, checkManagedUpdate, readGitHubRef }
