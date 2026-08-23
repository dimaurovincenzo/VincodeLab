const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createPublicError, toPublicError } = require('./public-error.cjs')
const { getManagedUpdateInternal, recordStagedUpdate, recordUpdateError } = require('./update-store.cjs')
const { environmentForPi, resolvePiExecutable } = require('./pi-executable.cjs')
const { resolveSystemExecutable } = require('./runtime-capabilities.cjs')

const execFileAsync = promisify(execFile)

function updateDataDirectory() {
  const base = process.env.VINCODELAB_DATA_DIR || require('electron').app.getPath('userData')
  const directory = path.join(base, 'updates')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
  return directory
}

function safeDirectoryName(id) { return Buffer.from(id).toString('hex').slice(0, 160) }

function stageValidationError(message) {
  return createPublicError('UPDATE_STAGE_VALIDATION_FAILED', message)
}

function validateStagedContent(record, directory) {
  const stats = fs.lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw stageValidationError('Verifica integrita dello staging non riuscita.')
  if (record.kind === 'skill') {
    const manifest = path.join(directory, 'SKILL.md')
    if (!fs.existsSync(manifest) || !fs.lstatSync(manifest).isFile() || fs.lstatSync(manifest).isSymbolicLink()) throw stageValidationError('Verifica integrita della skill non riuscita.')
  } else if (record.kind === 'pi-extension') {
    const manifest = path.join(directory, 'package.json')
    if (!fs.existsSync(manifest)) throw stageValidationError('Verifica integrita dell estensione Pi non riuscita.')
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    if (!metadata || typeof metadata.name !== 'string') throw stageValidationError('Verifica integrita dell estensione Pi non riuscita.')
  } else if (record.kind === 'pi-runtime') {
    if (!fs.readdirSync(directory).length) throw stageValidationError('Verifica integrita del runtime Pi non riuscita.')
  }
  return true
}

function packageHasRuntimeDependencies(metadata) {
  return ['dependencies', 'optionalDependencies'].some((key) => metadata?.[key] && Object.keys(metadata[key]).length > 0)
}

async function downloadGitHub(record, destination, run = execFileAsync, dependencies = {}) {
  try {
    fs.rmSync(destination, { recursive: true, force: true })
    await run('gh', ['repo', 'clone', `${record.owner}/${record.repository}`, destination, '--', '--depth', '1', '--branch', record.ref], { timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true })
    const { stdout } = await run('git', ['-C', destination, 'rev-parse', 'HEAD'], { timeout: 15_000, maxBuffer: 8 * 1024, windowsHide: true })
    if (String(stdout).trim() !== record.availableVersion) throw stageValidationError('Il contenuto scaricato non corrisponde alla versione verificata.')
    const manifest = path.join(destination, 'package.json')
    if (fs.existsSync(manifest)) {
      const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (packageHasRuntimeDependencies(metadata)) {
        const piExecutable = Object.hasOwn(dependencies, 'piExecutable') ? dependencies.piExecutable : resolvePiExecutable()
        const npmEnvironment = dependencies.npmEnvironment ?? (piExecutable ? environmentForPi(piExecutable) : process.env)
        const siblingNpm = piExecutable ? path.join(path.dirname(piExecutable), process.platform === 'win32' ? 'npm.cmd' : 'npm') : null
        const npmExecutable = Object.hasOwn(dependencies, 'npmExecutable')
          ? dependencies.npmExecutable
          : siblingNpm && fs.existsSync(siblingNpm)
            ? siblingNpm
            : (dependencies.resolveNpmExecutable ?? resolveSystemExecutable)([process.platform === 'win32' ? 'npm.cmd' : 'npm'], npmEnvironment)
        if (typeof npmExecutable !== 'string' || !npmExecutable) throw createPublicError(
          'UPDATE_NPM_NOT_INSTALLED',
          'npm è necessario soltanto per installare le dipendenze di questo aggiornamento Pi. Installa Node.js con npm e riprova; VincodeLab continua a funzionare senza npm.',
        )
        const command = fs.existsSync(path.join(destination, 'package-lock.json')) ? 'ci' : 'install'
        await run(npmExecutable, [command, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: destination, env: npmEnvironment, timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true })
      }
    }
  } catch (error) {
    throw toPublicError(error, { code: 'UPDATE_STAGE_FAILED', message: 'Download dell aggiornamento non riuscito.' })
  }
}

async function stageManagedUpdate(id, dependencies = {}) {
  let record
  let ownedPath
  try {
    record = getManagedUpdateInternal(id)
    if (!record || !record.available_version) throw createPublicError('UPDATE_STAGE_FAILED', 'Nessun aggiornamento disponibile.')
    if (record.restart_required || record.status === 'activating') throw createPublicError('UPDATE_STAGE_FAILED', 'Un aggiornamento e gia pronto o in attivazione.')
    if (record.source_type !== 'github') throw createPublicError('UPDATE_STAGE_FAILED', 'Questa sorgente non supporta lo staging gestito.')
    const root = dependencies.dataDirectory ?? updateDataDirectory()
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    const finalPath = path.join(root, `${safeDirectoryName(record.id)}-staged-${randomUUID()}`)
    const temporaryPath = fs.mkdtempSync(path.join(root, `${safeDirectoryName(record.id)}-download-`))
    ownedPath = temporaryPath
    await (dependencies.download ?? downloadGitHub)({ id: record.id, kind: record.kind, owner: record.owner, repository: record.repository, ref: record.ref, availableVersion: record.available_version }, temporaryPath)
    validateStagedContent(record, temporaryPath)
    fs.renameSync(temporaryPath, finalPath)
    ownedPath = finalPath
    const staged = recordStagedUpdate(record.id, { stagedVersion: record.available_version, stagingPath: finalPath })
    ownedPath = null
    return staged
  } catch (error) {
    if (ownedPath) fs.rmSync(ownedPath, { recursive: true, force: true })
    const publicError = toPublicError(error, { code: 'UPDATE_STAGE_FAILED', message: 'Preparazione dell aggiornamento non riuscita.' })
    if (record) recordUpdateError(record.id, publicError)
    throw publicError
  }
}

module.exports = { downloadGitHub, stageManagedUpdate, validateStagedContent }
