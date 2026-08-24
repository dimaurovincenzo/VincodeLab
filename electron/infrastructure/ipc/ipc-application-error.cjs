const { IPC_CHANNELS } = require('../../ipc/channels.cjs')
const {
  APPLICATION_ERROR_DOMAINS,
  classifyApplicationError,
  createApplicationErrorMessage,
  toApplicationError,
} = require('../../domains/errors/application-error.cjs')

const SAFE_CHANNEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/u
const APPLICATION_ERROR_DOMAIN_SET = new Set(APPLICATION_ERROR_DOMAINS)
const GIT_CHANNEL_OPERATIONS = new Set([
  'addRemote',
  'branches',
  'commit',
  'createBranch',
  'fetch',
  'fileDiff',
  'gitStatus',
  'initRepository',
  'pullRebase',
  'push',
  'revert',
  'stage',
  'switchBranch',
  'unstage',
])
const PASSTHROUGH_OPTIONS = Object.freeze([
  'category',
  'code',
  'correlationId',
  'recoverable',
  'severity',
  'technicalDiagnostic',
])

const CHANNEL_MESSAGES = Object.freeze({
  [IPC_CHANNELS.DATABASE_BEGIN]: 'Impossibile avviare la transazione.',
  [IPC_CHANNELS.DATABASE_COMMIT]: 'Impossibile confermare la transazione.',
  [IPC_CHANNELS.DATABASE_CONNECT]: 'Impossibile aprire la connessione al database.',
  [IPC_CHANNELS.DATABASE_CREATE_CONNECTION]: 'Impossibile salvare la connessione al database.',
  [IPC_CHANNELS.DATABASE_EXECUTE]: 'Impossibile completare la query.',
  [IPC_CHANNELS.DATABASE_INSPECT_SCHEMA]: 'Impossibile leggere lo schema del database.',
  [IPC_CHANNELS.DATABASE_INSPECT_ROUTINE]: 'Impossibile leggere la definizione della routine.',
  [IPC_CHANNELS.DATABASE_ROLLBACK]: 'Impossibile annullare la transazione.',
  [IPC_CHANNELS.DATABASE_TABLE_ROWS]: 'Impossibile leggere i dati della tabella.',
  [IPC_CHANNELS.REDIS_CREATE_CONNECTION]: 'Impossibile salvare la connessione Redis.',
  [IPC_CHANNELS.REDIS_DELETE_CONNECTION]: 'Impossibile eliminare la connessione Redis.',
  [IPC_CHANNELS.REDIS_LIST_CONNECTIONS]: 'Impossibile leggere le connessioni Redis.',
  [IPC_CHANNELS.REDIS_READ_KEY]: 'Impossibile leggere la chiave Redis.',
  [IPC_CHANNELS.REDIS_RECONNECT]: 'Impossibile riconnettere Redis.',
  [IPC_CHANNELS.REDIS_SCAN_KEYS]: 'Impossibile aggiornare le chiavi Redis.',
  [IPC_CHANNELS.REDIS_SEARCH_PAYLOADS]: 'Impossibile completare la ricerca nei dati Redis.',
  [IPC_CHANNELS.REDIS_TEST_CONNECTION]: 'Impossibile verificare la connessione Redis.',
  [IPC_CHANNELS.REDIS_UPDATE_CONNECTION]: 'Impossibile aggiornare la connessione Redis.',
  [IPC_CHANNELS.FILES_CREATE]: 'Impossibile creare il file.',
  [IPC_CHANNELS.FILES_INDEX]: 'Impossibile aggiornare l’indice dei file.',
  [IPC_CHANNELS.FILES_LIST]: 'Impossibile leggere i file del workspace.',
  [IPC_CHANNELS.FILES_LIST_DIRECTORY]: 'Impossibile leggere la cartella.',
  [IPC_CHANNELS.FILES_PREVIEW]: 'Impossibile generare l’anteprima del file.',
  [IPC_CHANNELS.FILES_READ]: 'Impossibile leggere il file.',
  [IPC_CHANNELS.FILES_SAVE]: 'Impossibile salvare il file.',
  [IPC_CHANNELS.GITHUB_ADD_REMOTE]: 'Impossibile collegare il repository remoto.',
  [IPC_CHANNELS.GITHUB_BRANCHES]: 'Impossibile leggere i branch Git.',
  [IPC_CHANNELS.GITHUB_COMMIT]: 'Impossibile creare il commit.',
  [IPC_CHANNELS.GITHUB_CREATE_BRANCH]: 'Impossibile creare il branch Git.',
  [IPC_CHANNELS.GITHUB_CREATE_ISSUE]: 'Impossibile creare la issue GitHub.',
  [IPC_CHANNELS.GITHUB_CREATE_REPOSITORY]: 'Impossibile creare il repository GitHub.',
  [IPC_CHANNELS.GITHUB_DATA]: 'Impossibile aggiornare i dati GitHub.',
  [IPC_CHANNELS.GITHUB_FETCH]: 'Impossibile aggiornare i riferimenti remoti.',
  [IPC_CHANNELS.GITHUB_FILE_DIFF]: 'Impossibile leggere le modifiche del file.',
  [IPC_CHANNELS.GITHUB_GIT_STATUS]: 'Impossibile leggere lo stato Git.',
  [IPC_CHANNELS.GITHUB_INIT_REPOSITORY]: 'Impossibile inizializzare il repository Git.',
  [IPC_CHANNELS.GITHUB_PULL_REBASE]: 'Impossibile integrare le modifiche remote.',
  [IPC_CHANNELS.GITHUB_PUSH]: 'Impossibile inviare le modifiche al repository remoto.',
  [IPC_CHANNELS.GITHUB_STAGE]: 'Impossibile preparare i file per il commit.',
  [IPC_CHANNELS.GITHUB_SWITCH_BRANCH]: 'Impossibile cambiare branch Git.',
  [IPC_CHANNELS.GITHUB_UNSTAGE]: 'Impossibile rimuovere i file dalla preparazione del commit.',
  [IPC_CHANNELS.HERDR_COMMAND]: 'Impossibile completare il comando Herdr.',
  [IPC_CHANNELS.MANAGED_SSH_CHECK]: 'Impossibile verificare la connessione remota.',
  [IPC_CHANNELS.PI_RELOAD]: 'Impossibile ricaricare la sessione AI.',
  [IPC_CHANNELS.PI_RESTART]: 'Impossibile riavviare la sessione AI.',
  [IPC_CHANNELS.PREFERENCES_GET]: 'Impossibile leggere le impostazioni.',
  [IPC_CHANNELS.PREFERENCES_SET_GLOBAL]: 'Impossibile salvare le impostazioni.',
  [IPC_CHANNELS.PREFERENCES_SET_WORKSPACE]: 'Impossibile salvare le impostazioni del workspace.',
  [IPC_CHANNELS.REMOTE_FILES_BROWSE]: 'Impossibile leggere la cartella remota.',
  [IPC_CHANNELS.REMOTE_FILES_COMPARE]: 'Impossibile confrontare il file remoto.',
  [IPC_CHANNELS.REMOTE_FILES_CREATE_DIRECTORY]: 'Impossibile creare la cartella remota.',
  [IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AND_TRACK]: 'Impossibile scaricare il file remoto.',
  [IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AS]: 'Impossibile scaricare il file remoto.',
  [IPC_CHANNELS.REMOTE_FILES_READ]: 'Impossibile leggere il file remoto.',
  [IPC_CHANNELS.REMOTE_FILES_REMOVE]: 'Impossibile eliminare la risorsa remota.',
  [IPC_CHANNELS.REMOTE_FILES_RENAME]: 'Impossibile rinominare la risorsa remota.',
  [IPC_CHANNELS.REMOTE_FILES_UPLOAD]: 'Impossibile caricare il file remoto.',
  [IPC_CHANNELS.SHELL_SESSIONS_CREATE]: 'Impossibile avviare il terminale.',
  [IPC_CHANNELS.SHELL_SESSIONS_RESTART]: 'Impossibile riavviare il terminale.',
  [IPC_CHANNELS.SYSTEM_SKILLS_CREATE]: 'Impossibile creare la skill Pi.',
  [IPC_CHANNELS.SYSTEM_SKILLS_DELETE]: 'Impossibile eliminare la skill Pi.',
  [IPC_CHANNELS.SYSTEM_SKILLS_GET]: 'Impossibile leggere la skill Pi.',
  [IPC_CHANNELS.SYSTEM_SKILLS_LIST]: 'Impossibile leggere le skill Pi.',
  [IPC_CHANNELS.SYSTEM_SKILLS_UPDATE]: 'Impossibile salvare la skill Pi.',
  [IPC_CHANNELS.TERMINAL_EXPORT_DIAGNOSTICS]: 'Impossibile esportare la diagnostica del terminale.',
  [IPC_CHANNELS.TERMINAL_RESUME]: 'Impossibile ripristinare la sessione del terminale.',
  [IPC_CHANNELS.UPDATES_ACTIVATE_PENDING]: 'Impossibile attivare l’aggiornamento.',
  [IPC_CHANNELS.UPDATES_CHECK]: 'Impossibile controllare gli aggiornamenti.',
  [IPC_CHANNELS.UPDATES_DOWNLOAD]: 'Impossibile scaricare l’aggiornamento.',
  [IPC_CHANNELS.UPDATES_DOWNLOAD_ALL]: 'Impossibile scaricare gli aggiornamenti.',
  [IPC_CHANNELS.UPDATES_ROLLBACK]: 'Impossibile ripristinare la versione precedente.',
  [IPC_CHANNELS.WORKSPACE_OPEN]: 'Impossibile aprire il workspace.',
  [IPC_CHANNELS.WORKSPACE_OPEN_IN_NEW_INSTANCE]: 'Impossibile aprire il workspace in una nuova finestra.',
  [IPC_CHANNELS.WORKSPACE_OPEN_RECENT]: 'Impossibile riaprire il workspace.',
  [IPC_CHANNELS.WORKSPACE_SESSION_GET]: 'Impossibile ripristinare la sessione del workspace.',
  [IPC_CHANNELS.WORKSPACE_SESSION_SAVE]: 'Impossibile salvare la sessione del workspace.',
})

function safeOption(options, key) {
  if (!options || (typeof options !== 'object' && typeof options !== 'function')) return undefined
  try {
    return options[key]
  } catch {
    return undefined
  }
}

function safeChannel(value) {
  if (typeof value !== 'string') return 'operation'
  const normalized = value.trim()
  return SAFE_CHANNEL_PATTERN.test(normalized) ? normalized : 'operation'
}

function operationFromIpcChannel(channel) {
  const channelName = safeChannel(channel)
  const separator = channelName.indexOf(':')
  return separator >= 0 ? channelName.slice(separator + 1) || 'operation' : channelName
}

function domainFromIpcChannel(channel) {
  const channelName = safeChannel(channel)
  const [namespace, operation = ''] = channelName.split(':', 2)
  if (namespace === 'database') return 'database'
  if (namespace === 'redis') return 'redis'
  if (namespace === 'github') return GIT_CHANNEL_OPERATIONS.has(operation) ? 'git' : 'github'
  if (namespace === 'remoteFiles' || namespace === 'managedSsh') return 'remote'
  if (namespace === 'files' || namespace === 'instructions' || namespace === 'skills' || namespace === 'systemSkills') return 'filesystem'
  if (namespace === 'workspace') return 'workspace'
  if (namespace === 'workspaceSession' || namespace === 'volatileDrafts') return 'persistence'
  if (namespace === 'terminal' || namespace === 'shellSessions' || namespace === 'workspaceCommands') return 'terminal'
  if (namespace === 'pi' || namespace === 'herdr') return 'ai'
  if (namespace === 'piConfig' || namespace === 'piSystem' || namespace === 'runtime' || namespace === 'appearance' || namespace === 'preferences') return 'configuration'
  if (namespace === 'updates') return 'update'
  return 'internal'
}

function optionsForIpcChannel(error, channel, options = {}) {
  const channelName = safeChannel(channel)
  const requestedDomain = safeOption(options, 'domain')
  const requestedOperation = safeOption(options, 'operation')
  const requestedMessage = safeOption(options, 'message')
  const result = {
    domain: APPLICATION_ERROR_DOMAIN_SET.has(requestedDomain) ? requestedDomain : domainFromIpcChannel(channelName),
    operation: typeof requestedOperation === 'string' && SAFE_CHANNEL_PATTERN.test(requestedOperation.trim())
      ? requestedOperation.trim()
      : operationFromIpcChannel(channelName),
  }
  for (const key of PASSTHROUGH_OPTIONS) {
    const value = safeOption(options, key)
    if (value !== undefined) result[key] = value
  }
  if (typeof requestedMessage === 'string' && requestedMessage.trim()) result.message = requestedMessage
  else if (CHANNEL_MESSAGES[channelName]) {
    result.message = createApplicationErrorMessage(error, {
      ...result,
      baseMessage: CHANNEL_MESSAGES[channelName],
    })
  }
  return result
}

function classifyIpcApplicationError(error, channel, options) {
  return classifyApplicationError(error, optionsForIpcChannel(error, channel, options))
}

function toIpcApplicationError(error, channel, options) {
  return toApplicationError(error, optionsForIpcChannel(error, channel, options))
}

module.exports = {
  classifyIpcApplicationError,
  domainFromIpcChannel,
  toIpcApplicationError,
}
