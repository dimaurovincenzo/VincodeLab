const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveSystemShell } = require('../processes/shell-host.adapter.cjs')

const BUNDLED_DRIVERS = Object.freeze([
  { id: 'database-sqlite', label: 'SQLite', moduleId: 'better-sqlite3' },
  { id: 'database-postgresql', label: 'PostgreSQL', moduleId: 'pg' },
  { id: 'database-mysql', label: 'MySQL', moduleId: 'mysql2/promise' },
  { id: 'database-sqlserver', label: 'SQL Server', moduleId: 'tedious' },
  { id: 'redis-client', label: 'Redis', moduleId: 'redis' },
])

const SYSTEM_TOOLS = Object.freeze([
  {
    id: 'node-system',
    label: 'Node.js di sistema',
    names: ['node'],
    missingDetail: 'Non serve per avviare VincodeLab. Può essere richiesto da Pi quando Pi è stato installato tramite npm.',
  },
  {
    id: 'npm-system',
    label: 'npm di sistema',
    names: ['npm'],
    missingDetail: 'Non serve per avviare VincodeLab. È necessario soltanto per alcune installazioni e aggiornamenti dei pacchetti Pi.',
  },
  {
    id: 'git-system',
    label: 'Git',
    names: ['git'],
    missingDetail: 'Le funzioni Git non saranno disponibili finché Git non viene installato. Editor, Terminale AI, Database e Redis restano utilizzabili.',
  },
  {
    id: 'github-cli',
    label: 'GitHub CLI',
    names: ['gh'],
    missingDetail: 'Le funzioni GitHub che richiedono accesso all’account restano disattivate; Git locale continua a funzionare.',
  },
  {
    id: 'sftp-system',
    label: 'OpenSSH / SFTP',
    names: ['sftp'],
    missingDetail: 'I file remoti SFTP non saranno disponibili. I file locali e il Terminale restano utilizzabili.',
  },
])

function isExecutable(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false
  try {
    return fs.statSync(candidate).isFile() && (fs.accessSync(candidate, fs.constants.X_OK), true)
  } catch {
    return false
  }
}

function nvmCandidates(name, homeDirectory) {
  const versionsRoot = path.join(homeDirectory, '.nvm', 'versions', 'node')
  try {
    return fs.readdirSync(versionsRoot)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => path.join(versionsRoot, version, 'bin', name))
  } catch {
    return []
  }
}

function resolveSystemExecutable(names, environment = process.env, homeDirectory = os.homedir(), {
  includeCommonDirectories = true,
  includeNvm = true,
} = {}) {
  const pathDirectories = (environment.PATH || '').split(path.delimiter).filter(Boolean)
  const commonDirectories = includeCommonDirectories
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    : []
  for (const name of names) {
    const candidates = [
      ...pathDirectories.map((directory) => path.join(directory, name)),
      ...commonDirectories.map((directory) => path.join(directory, name)),
      ...(includeNvm ? nvmCandidates(name, homeDirectory) : []),
    ]
    const executable = candidates.find(isExecutable)
    if (executable) return executable
  }
  return null
}

function probeBundledModule(moduleId, loadModule = require) {
  try {
    loadModule(moduleId)
    return { state: 'ready' }
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : ''
    const message = typeof error?.message === 'string' ? error.message : ''
    const incompatible = code === 'ERR_DLOPEN_FAILED'
      || /(?:incompatible architecture|mach-o|node_module_version|was compiled against|symbol not found)/iu.test(message)
    return { state: 'broken', code: incompatible ? 'APP_RUNTIME_INCOMPATIBLE' : 'APP_INSTALLATION_INCOMPLETE' }
  }
}

function getRuntimeCapabilities({
  environment = process.env,
  homeDirectory = os.homedir(),
  loadModule = require,
  piExecutable = null,
  ptyStatus = { state: 'ready' },
  resolveExecutable = resolveSystemExecutable,
  systemToolSearchOptions,
} = {}) {
  const appRuntime = Object.freeze({
    id: 'app-runtime',
    kind: 'included',
    label: 'Runtime VincodeLab',
    state: 'ready',
    detail: `Electron ${process.versions.electron ?? 'integrato'} e Node ${process.versions.node} sono inclusi nell’app. Non è richiesta un’installazione Node/npm di sistema.`,
  })
  const terminal = Object.freeze({
    id: 'terminal-runtime',
    kind: 'included',
    label: 'Terminale integrato',
    state: ptyStatus.state === 'ready' ? 'ready' : 'broken',
    code: ptyStatus.state === 'ready' ? undefined : ptyStatus.code,
    detail: ptyStatus.state === 'ready'
      ? 'Il componente PTY è incluso e pronto.'
      : 'Il componente PTY incluso non può essere caricato. Reinstalla VincodeLab con il pacchetto adatto a questo Mac.',
  })
  const databases = BUNDLED_DRIVERS.map((driver) => {
    const probe = probeBundledModule(driver.moduleId, loadModule)
    return Object.freeze({
      id: driver.id,
      kind: 'included',
      label: `Driver ${driver.label}`,
      state: probe.state,
      code: probe.code,
      detail: probe.state === 'ready'
        ? `Incluso nell’app: non serve installare client o comandi ${driver.label} sul computer.`
        : `Il driver incluso non è disponibile. Reinstalla VincodeLab; installare un client ${driver.label} di sistema non risolve il problema.`,
    })
  })
  const pi = Object.freeze({
    id: 'pi-agent',
    kind: 'optional',
    label: 'Pi Coding Agent',
    state: piExecutable ? 'ready' : 'missing',
    detail: piExecutable
      ? 'Pi è stato rilevato ed è disponibile per il Terminale AI.'
      : 'Pi non è installato o rilevabile. Solo il Terminale AI resta disattivato; il resto di VincodeLab continua a funzionare.',
  })
  const shellExecutable = resolveSystemShell(environment)
  const systemShell = Object.freeze({
    id: 'system-shell',
    kind: 'optional',
    label: 'Shell di sistema',
    state: shellExecutable ? 'ready' : 'missing',
    detail: shellExecutable
      ? 'Una shell macOS compatibile è disponibile per il Terminale locale.'
      : 'Il Terminale locale resta disattivato finché zsh, bash o sh non viene ripristinata. Le altre aree continuano a funzionare.',
  })
  const tools = SYSTEM_TOOLS.map((tool) => {
    const executable = resolveExecutable(tool.names, environment, homeDirectory, systemToolSearchOptions)
    return Object.freeze({
      id: tool.id,
      kind: 'optional',
      label: tool.label,
      state: executable ? 'ready' : 'missing',
      detail: executable ? 'Disponibile sul sistema.' : tool.missingDetail,
    })
  })

  return Object.freeze({ checkedAt: new Date().toISOString(), items: Object.freeze([appRuntime, terminal, ...databases, pi, systemShell, ...tools]) })
}

module.exports = { BUNDLED_DRIVERS, getRuntimeCapabilities, probeBundledModule, resolveSystemExecutable }
