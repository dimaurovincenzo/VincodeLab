const { listPiPackageSkills: discoverPiPackageSkills, parsePiPackageList } = require('./pi-package-skills.cjs')
const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const MAX_SOURCE_LENGTH = 2048
const PI_COMMAND_TIMEOUT_MS = 30_000
const PACKAGE_COMMANDS = new Set(['install', 'remove', 'update'])
const NOT_RUNNABLE_CODES = new Set(['EACCES', 'ENOENT', 'ENOEXEC', 'ENOTDIR', 'EPERM', 'ERR_DLOPEN_FAILED'])

const PUBLIC_FAILURES = Object.freeze({
  commandFailed: Object.freeze({
    code: 'PI_COMMAND_FAILED',
    message: 'Il comando Pi non è riuscito. Riprova.',
  }),
  gitMissing: Object.freeze({
    code: 'PI_GIT_NOT_INSTALLED',
    message: 'Git è necessario per questa operazione sui pacchetti Pi. Installa Git e riprova.',
  }),
  npmMissing: Object.freeze({
    code: 'PI_NPM_NOT_INSTALLED',
    message: 'npm è necessario per questa operazione sui pacchetti Pi. Installa Node.js con npm e riprova.',
  }),
  notInstalled: Object.freeze({
    code: 'PI_NOT_INSTALLED',
    message: 'Pi Coding Agent non è installato. Installalo oppure configura il percorso dell’eseguibile.',
  }),
  notRunnable: Object.freeze({
    code: 'PI_NOT_RUNNABLE',
    message: 'Pi Coding Agent è presente ma non può essere avviato. Verifica installazione e permessi, quindi riprova.',
  }),
  timeout: Object.freeze({
    code: 'PI_COMMAND_TIMEOUT',
    message: 'Pi Coding Agent non ha risposto entro 30 secondi. Riprova.',
  }),
})

function assertPackageSource(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE_LENGTH || [...source].some((character) => character.charCodeAt(0) < 32)) throw new Error('Sorgente estensione non valida.')
  return source.trim()
}

function errorValues(error) {
  const values = []
  const visited = new Set()
  let current = error
  for (let depth = 0; depth < 4 && current && (typeof current === 'object' || typeof current === 'function'); depth += 1) {
    if (visited.has(current)) break
    visited.add(current)
    for (const key of ['name', 'message', 'code', 'stderr', 'stdout', 'signal']) {
      try {
        const value = current[key]
        if (typeof value === 'string' || typeof value === 'number') values.push(String(value))
      } catch {
        // La classificazione non deve fallire su Error con getter ostili.
      }
    }
    try {
      current = current.cause
    } catch {
      current = null
    }
  }
  return values
}

function hasErrorFlag(error, key, expected) {
  const visited = new Set()
  let current = error
  for (let depth = 0; depth < 4 && current && (typeof current === 'object' || typeof current === 'function'); depth += 1) {
    if (visited.has(current)) break
    visited.add(current)
    try {
      if (current[key] === expected) return true
      current = current.cause
    } catch {
      return false
    }
  }
  return false
}

function publicFailure(definition, cause) {
  const error = createPublicError(definition.code, definition.message)
  if (cause && cause !== error) {
    try {
      Object.defineProperty(error, 'cause', { value: cause })
    } catch {
      // Il messaggio pubblico resta valido anche se non è possibile conservare la cause.
    }
  }
  return error
}

function missingDependency(signal, command) {
  const executable = `${command}(?:\\.cmd)?`
  return new RegExp(`(?:spawn|exec(?:file)?)\\s+${executable}[^\\n]{0,32}\\bENOENT\\b`, 'i').test(signal)
    || new RegExp(`\\b${executable}\\b\\s*:\\s*(?:command\\s+)?not\\s+found`, 'i').test(signal)
    || new RegExp(`["']?${executable}["']?\\s+is\\s+not\\s+recognized`, 'i').test(signal)
    || new RegExp(`(?:cannot|could\\s+not)\\s+find(?:\\s+the)?(?:\\s+command|\\s+executable)?\\s+["']?${executable}\\b`, 'i').test(signal)
    || new RegExp(`impossibile\\s+trovare(?:\\s+il\\s+comando)?\\s+["']?${executable}\\b`, 'i').test(signal)
}

function classifyPiCommandFailure(error, args) {
  if (isPublicError(error)) return error
  const values = errorValues(error)
  const signal = values.join('\n')
  const codes = new Set(values.filter((value) => /^[A-Z][A-Z0-9_]+$/.test(value)))
  const isPackageCommand = PACKAGE_COMMANDS.has(args[0])

  if (codes.has('ETIMEDOUT') || /\b(?:timed?\s*out|timeout)\b/i.test(signal) || (hasErrorFlag(error, 'killed', true) && /SIGTERM/i.test(signal))) {
    return publicFailure(PUBLIC_FAILURES.timeout, error)
  }
  if (isPackageCommand && missingDependency(signal, 'npm')) return publicFailure(PUBLIC_FAILURES.npmMissing, error)
  if (isPackageCommand && missingDependency(signal, 'git')) return publicFailure(PUBLIC_FAILURES.gitMissing, error)
  if ([...codes].some((code) => NOT_RUNNABLE_CODES.has(code)) || /exec\s+format|not\s+executable|cannot\s+execute|permission\s+denied|bad\s+cpu\s+type|wrong\s+architecture|not\s+a\s+valid\s+win32\s+application/i.test(signal)) {
    return publicFailure(PUBLIC_FAILURES.notRunnable, error)
  }
  return publicFailure(PUBLIC_FAILURES.commandFailed, error)
}

function normalizeCommandResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Pi command returned an invalid result.')
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : result.stdout ?? ''
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr ?? ''
  if (typeof stdout !== 'string' || typeof stderr !== 'string') throw new Error('Pi command returned invalid output.')
  return { stdout, stderr }
}

async function runPiCommand(executable, args, run) {
  try {
    return normalizeCommandResult(await run(executable, args))
  } catch (error) {
    throw classifyPiCommandFailure(error, args)
  }
}

function resolveExecutableValue(resolveExecutable) {
  const executable = resolveExecutable()
  return typeof executable === 'string' && executable.length > 0 ? executable : null
}

function resolveOrThrow(resolveExecutable) {
  const executable = resolveExecutableValue(resolveExecutable)
  if (!executable) throw publicFailure(PUBLIC_FAILURES.notInstalled)
  return executable
}

function normalizeResult(result) { return { output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() } }

async function getPiSystemStatus(resolveExecutable, run) {
  const executable = resolveExecutableValue(resolveExecutable)
  if (!executable) return Object.freeze({ state: 'missing', code: 'PI_NOT_INSTALLED', executable: null, version: null })
  const result = await runPiCommand(executable, ['--version'], run)
  const version = result.stdout.trim()
  if (!version) throw publicFailure(PUBLIC_FAILURES.notRunnable)
  return Object.freeze({ state: 'ready', executable, version })
}

async function listPiPackageRecords(resolveExecutable, run) {
  const result = await runPiCommand(resolveOrThrow(resolveExecutable), ['list'], run)
  return parsePiPackageList(result.stdout)
}
async function listPiPackages(resolveExecutable, run) { return (await listPiPackageRecords(resolveExecutable, run)).map((item) => item.source) }
async function listPiPackageSkills(resolveExecutable, run) { return discoverPiPackageSkills(await listPiPackageRecords(resolveExecutable, run)) }
async function runPackageCommand(command, source, resolveExecutable, run) {
  const value = assertPackageSource(source)
  return normalizeResult(await runPiCommand(resolveOrThrow(resolveExecutable), [command, value], run))
}
function installPiPackage(source, resolveExecutable, run) { return runPackageCommand('install', source, resolveExecutable, run) }
function updatePiPackage(source, resolveExecutable, run) { return runPackageCommand('update', source, resolveExecutable, run) }
function removePiPackage(source, resolveExecutable, run) { return runPackageCommand('remove', source, resolveExecutable, run) }

function createPiSystemUseCases({ run } = {}) {
  if (typeof run !== 'function') throw new TypeError('Runner comando Pi non valido.')
  return Object.freeze({
    getPiSystemStatus: (resolveExecutable) => getPiSystemStatus(resolveExecutable, run),
    installPiPackage: (source, resolveExecutable) => installPiPackage(source, resolveExecutable, run),
    listPiPackageRecords: (resolveExecutable) => listPiPackageRecords(resolveExecutable, run),
    listPiPackageSkills: (resolveExecutable) => listPiPackageSkills(resolveExecutable, run),
    listPiPackages: (resolveExecutable) => listPiPackages(resolveExecutable, run),
    removePiPackage: (source, resolveExecutable) => removePiPackage(source, resolveExecutable, run),
    updatePiPackage: (source, resolveExecutable) => updatePiPackage(source, resolveExecutable, run),
  })
}

module.exports = {
  PI_COMMAND_TIMEOUT_MS,
  createPiSystemUseCases,
  getPiSystemStatus,
  installPiPackage,
  listPiPackageRecords,
  listPiPackageSkills,
  listPiPackages,
  removePiPackage,
  updatePiPackage,
}
