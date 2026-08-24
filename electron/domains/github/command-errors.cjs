const { isApplicationError, toApplicationError } = require('../errors/application-error.cjs')
const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const MAX_STREAM_STDERR_BYTES = 64 * 1024
const GITHUB_AUTH_PATTERN = /not logged into any github hosts|authentication required|gh auth login|bad credentials|invalid (?:oauth )?token|token (?:has )?expired|requires authentication|authentication failed|could not read username|permission denied \((?:publickey|password)\)|\b(?:http|status)\s*401\b/i
const GITHUB_PROJECT_SCOPE_PATTERN = /(?:missing|requires?|required|insufficient|grant(?:ed)?).{0,160}\b(?:project|read:project)\b|\b(?:project|read:project)\b.{0,160}(?:scope|permission)/i
const GITHUB_REMOTE_MISSING_PATTERN = /no git remotes found|not a git repository/i
const GITHUB_RATE_LIMIT_PATTERN = /api rate limit exceeded|secondary rate limit|rate.?limit(?:ed|ing)?|too many requests|\b(?:http|status)\s*429\b/i
const GITHUB_PERMISSION_PATTERN = /resource not accessible|forbidden|insufficient permission|permission denied|must have (?:admin|push) access|\b(?:http|status)\s*403\b/i
const GITHUB_CONFLICT_PATTERN = /merge conflict|already exists|update is not a fast forward|\b(?:http|status)\s*409\b/i
const GITHUB_BRANCH_NOT_FOUND_PATTERN = /branch.{0,160}not found|could not resolve to a commit|base ref.{0,160}(?:invalid|not found)|head ref.{0,160}(?:invalid|not found)/i
const GITHUB_REPOSITORY_NOT_FOUND_PATTERN = /could not resolve to a repository|repository (?:was )?not found|could not find repository|\b(?:http|status)\s*404\b/i
const GIT_REMOTE_BRANCH_NOT_FOUND_PATTERN = /couldn['’]t find remote ref|remote (?:branch|ref).{0,120}not found|no such remote ref|src refspec.{0,160}does not match any|invalid upstream/i
const GIT_REMOTE_REPOSITORY_NOT_FOUND_PATTERN = /repository.{0,240}(?:not found|does not exist)|could not read from remote repository|does not appear to be a git repository/i
const COMMAND_NETWORK_PATTERN = /could not resolve host|could not resolve hostname|getaddrinfo|temporary failure in name resolution|network is unreachable|no route to host|connection (?:refused|reset|closed|timed out)|failed to connect|connection failure|remote end hung up|early eof|rpc failed|\b(?:econnrefused|econnreset|enetunreach|ehostunreach|enotfound|eai_again|epipe)\b/i
const COMMAND_TIMEOUT_PATTERN = /timed? out|timeout|deadline exceeded|\betimedout\b/i
const GIT_UNAVAILABLE_PATTERN = /invalid active developer path|requires? (?:the )?(?:xcode|command line developer tools)|xcrun: error|agree to the xcode.*license/i
const GIT_NOT_REPOSITORY_PATTERN = /not a git repository \(or any of the parent directories\)/i
const GIT_REPOSITORY_INVALID_PATTERN = /not a git repository:\s*\(null\)|invalid git(?:dir|file)|bad gitfile|repository (?:is )?corrupt|corrupt (?:head|object|repository)|unable to read (?:current working directory|git dir)/i
const GIT_NO_COMMITS_PATTERN = /does not have any commits yet|needed a single revision|unknown revision.{0,120}\bhead\b|ambiguous argument ['’]?head|bad revision ['’]?head/i
const GIT_UPSTREAM_MISSING_PATTERN = /no upstream configured|no tracking information|upstream branch.{0,120}does not exist/i
const GIT_UNTRACKED_PATH_PATTERN = /pathspec.{0,240}did not match any file|pathspec.{0,240}is beyond a symbolic link/i
const GIT_DETACHED_HEAD_PATTERN = /detached head|not currently on a branch|head does not point to a branch/i
const GIT_CONFLICT_PATTERN = /merge conflict|unmerged files?|needs merge|resolve your current index|cannot switch branch while (?:merging|rebasing)|you have not concluded your merge|could not apply|conflict prevents|non-fast-forward|failed to push some refs|updates were rejected|fetch first|would be overwritten by (?:checkout|merge)|already exists/i
const GIT_REMOTE_PERMISSION_PATTERN = /permission to .{0,160} denied|write access to repository not granted|requested url returned error:\s*403|\bhttp\s*403\b/i
const COMMAND_PERMISSION_PATTERN = /permission denied|operation not permitted|access is denied|dubious ownership|unsafe repository|could not (?:open|lock|write|create).{0,200}(?:\.git|index|config)|\b(?:eacces|eperm|erofs)\b/i
const GIT_AUTH_PATTERN = /authentication failed|could not read username|terminal prompts disabled|permission denied \((?:publickey|password)\)|invalid credentials|access denied|authorization failed/i

const GIT_OPERATION_BY_SUBCOMMAND = Object.freeze({
  add: 'stage',
  branch: 'branches',
  commit: 'commit',
  diff: 'fileDiff',
  fetch: 'fetch',
  'for-each-ref': 'branches',
  init: 'initRepository',
  'ls-files': 'fileDiff',
  log: 'gitStatus',
  pull: 'pullRebase',
  push: 'push',
  'rev-list': 'gitStatus',
  'rev-parse': 'gitStatus',
  remote: 'addRemote',
  restore: 'unstage',
  revert: 'revert',
  status: 'gitStatus',
  switch: 'switchBranch',
})

function commandOperation(command, args = []) {
  const safeArgs = Array.isArray(args) ? args : []
  if (command === 'git') {
    const subcommand = safeArgs.find((argument) => typeof argument === 'string' && Object.hasOwn(GIT_OPERATION_BY_SUBCOMMAND, argument))
    return GIT_OPERATION_BY_SUBCOMMAND[subcommand] ?? 'gitCommand'
  }
  if (safeArgs[0] === 'repo' && safeArgs[1] === 'create') return 'createRepository'
  if (safeArgs[0] === 'issue' && safeArgs[1] === 'create') return 'createIssue'
  if (safeArgs[0] === 'issue' && safeArgs[1] === 'edit') return 'updateIssue'
  if (safeArgs[0] === 'issue') return 'data'
  if (safeArgs[0] === 'api') return 'projects'
  return 'data'
}

function publicCommandCategory(error) {
  const code = error?.code
  if (code === 'GITHUB_CLI_NOT_FOUND' || code === 'GIT_NOT_INSTALLED') return 'configuration'
  if (code?.endsWith('_CANCELLED')) return 'cancelled'
  if (code?.endsWith('_TIMEOUT')) return 'timeout'
  if (code?.includes('_AUTH_') || code?.endsWith('_AUTH_REQUIRED')) return 'authentication'
  if (code?.includes('_PERMISSION_') || code === 'GITHUB_PROJECT_SCOPE_REQUIRED') return 'permission'
  if (code?.includes('_RATE_LIMIT') || code?.includes('_NETWORK_') || code?.includes('_UNREACHABLE')) return 'network'
  if (code?.includes('_CONFLICT') || code === 'GIT_DETACHED_HEAD') return 'conflict'
  if (code?.includes('_NOT_FOUND') || code === 'GIT_NOT_REPOSITORY' || code === 'GIT_NO_COMMITS' || code === 'GIT_PATH_UNTRACKED') return 'not-found'
  return undefined
}

function applicationCommandError(command, error, { args = [], category, code, message, operation = commandOperation(command, args), recoverable, severity } = {}) {
  if (isApplicationError(error)) return error
  const github = command === 'gh'
  const publicError = isPublicError(error)
    ? error
    : createPublicError(code ?? (github ? 'GITHUB_COMMAND_FAILED' : 'GIT_COMMAND_FAILED'), message ?? (github ? 'Operazione GitHub non riuscita.' : 'Operazione Git non riuscita.'))
  return toApplicationError(publicError, {
    category: category ?? publicCommandCategory(publicError),
    domain: github ? 'github' : 'git',
    operation,
    recoverable,
    severity,
  })
}

function commandFailure(command, error, stderr = '', args = []) {
  if (isApplicationError(error)) return error
  const detail = [stderr, error?.stderr, error instanceof Error ? error.message : '']
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .slice(0, MAX_STREAM_STDERR_BYTES)
  const github = command === 'gh'
  const operation = commandOperation(command, args)
  const checksUpstream = Array.isArray(args) && args.includes('@{upstream}')
  const failure = (code, message, category, options = {}) => applicationCommandError(command, error, {
    args,
    category,
    code,
    message,
    operation,
    ...options,
  })

  if (isPublicError(error)) return applicationCommandError(command, error, { args, operation })
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return commandLifecycleError(command, 'cancelled', args)
  if (COMMAND_TIMEOUT_PATTERN.test(detail) || error?.code === 'ETIMEDOUT') return commandLifecycleError(command, 'timeout', args)
  if (error?.code === 'ENOENT') {
    return github
      ? failure('GITHUB_CLI_NOT_FOUND', 'GitHub CLI non è disponibile. Installala o configurala e riprova.', 'configuration')
      : failure('GIT_NOT_INSTALLED', 'Git non è disponibile. Installalo e riprova.', 'configuration')
  }
  if (!github && GIT_UNAVAILABLE_PATTERN.test(detail)) return failure('GIT_NOT_INSTALLED', 'Git non è disponibile. Installalo e riprova.', 'configuration')

  if (github) {
    if (GITHUB_PROJECT_SCOPE_PATTERN.test(detail)) return failure('GITHUB_PROJECT_SCOPE_REQUIRED', 'Autorizzazione GitHub Projects mancante.', 'permission')
    if (GITHUB_RATE_LIMIT_PATTERN.test(detail)) return failure('GITHUB_RATE_LIMITED', 'GitHub sta limitando le richieste. Attendi qualche minuto e riprova.', 'network')
    if (GITHUB_AUTH_PATTERN.test(detail)) return failure('GITHUB_AUTH_REQUIRED', 'Autenticazione GitHub richiesta.', 'authentication')
    if (GITHUB_BRANCH_NOT_FOUND_PATTERN.test(detail)) return failure('GITHUB_REMOTE_BRANCH_NOT_FOUND', 'Il branch remoto GitHub non è disponibile. Aggiorna i riferimenti o seleziona un altro branch.', 'not-found')
    if (GITHUB_REPOSITORY_NOT_FOUND_PATTERN.test(detail)) return failure('GITHUB_REPOSITORY_NOT_FOUND', 'Repository GitHub non trovato o non accessibile. Verifica il collegamento e riprova.', 'not-found')
    if (GITHUB_REMOTE_MISSING_PATTERN.test(detail)) return failure('GITHUB_REPOSITORY_UNAVAILABLE', 'Repository GitHub non collegato al workspace.', 'configuration')
    if (COMMAND_NETWORK_PATTERN.test(detail)) return failure('GITHUB_NETWORK_UNAVAILABLE', 'Impossibile raggiungere GitHub. Controlla la connessione e riprova.', 'network')
    if (GITHUB_PERMISSION_PATTERN.test(detail) || COMMAND_PERMISSION_PATTERN.test(detail)) return failure('GITHUB_PERMISSION_DENIED', 'GitHub ha rifiutato l’operazione. Verifica i permessi e riprova.', 'permission')
    if (GITHUB_CONFLICT_PATTERN.test(detail)) return failure('GITHUB_CONFLICT', 'GitHub ha rilevato un conflitto. Aggiorna i dati e riprova.', 'conflict', { severity: 'warning' })
    return failure('GITHUB_COMMAND_FAILED', 'Operazione GitHub non riuscita.', 'github')
  }

  if (GIT_NOT_REPOSITORY_PATTERN.test(detail)) return failure('GIT_NOT_REPOSITORY', 'Il workspace non contiene un repository Git.', 'not-found', { severity: 'warning' })
  if (GIT_REPOSITORY_INVALID_PATTERN.test(detail)) return failure('GIT_REPOSITORY_INVALID', 'I dati Git del workspace non sono leggibili. Ripara o ricollega il repository e riprova.', 'git')
  if (GIT_NO_COMMITS_PATTERN.test(detail)) return failure('GIT_NO_COMMITS', 'Il repository non contiene ancora commit.', 'not-found', { severity: 'warning' })
  if (GIT_UPSTREAM_MISSING_PATTERN.test(detail) || (checksUpstream && /no such branch|head does not point to a branch/i.test(detail))) return failure('GIT_UPSTREAM_NOT_CONFIGURED', 'Il branch non ha un upstream configurato. Pubblicalo prima di riprovare.', 'configuration', { severity: 'warning' })
  if (GIT_UNTRACKED_PATH_PATTERN.test(detail)) return failure('GIT_PATH_UNTRACKED', 'Il file selezionato non è più disponibile per Git. Aggiorna lo stato e riprova.', 'not-found')
  if (GIT_AUTH_PATTERN.test(detail)) return failure('GIT_AUTH_REQUIRED', 'Autenticazione del repository remoto richiesta. Verifica credenziali o chiave SSH e riprova.', 'authentication')
  if (GIT_REMOTE_PERMISSION_PATTERN.test(detail)) return failure('GIT_REMOTE_PERMISSION_DENIED', 'Il repository remoto ha rifiutato la scrittura. Verifica i permessi e riprova.', 'permission')
  if (GIT_REMOTE_BRANCH_NOT_FOUND_PATTERN.test(detail)) return failure('GIT_REMOTE_BRANCH_NOT_FOUND', 'Il branch remoto non è disponibile. Aggiorna i riferimenti o seleziona un altro branch.', 'not-found')
  if (GIT_REMOTE_REPOSITORY_NOT_FOUND_PATTERN.test(detail)) return failure('GIT_REMOTE_REPOSITORY_NOT_FOUND', 'Il repository remoto non è disponibile. Verifica il remote e i permessi, poi riprova.', 'not-found')
  if (COMMAND_NETWORK_PATTERN.test(detail)) return failure('GIT_REMOTE_UNREACHABLE', 'Impossibile raggiungere il repository remoto. Controlla la connessione e riprova.', 'network')
  if (COMMAND_PERMISSION_PATTERN.test(detail) || error?.code === 'EACCES' || error?.code === 'EPERM') return failure('GIT_PERMISSION_DENIED', 'Git non può accedere al repository. Verifica i permessi del workspace e riprova.', 'permission')
  if (GIT_DETACHED_HEAD_PATTERN.test(detail)) return failure('GIT_DETACHED_HEAD', 'Il repository è in modalità detached HEAD. Crea o seleziona un branch e riprova.', 'conflict', { severity: 'warning' })
  if (GIT_CONFLICT_PATTERN.test(detail)) return failure('GIT_CONFLICT', 'L’operazione Git è bloccata da un conflitto. Risolvi i conflitti e riprova.', 'conflict', { severity: 'warning' })
  return failure('GIT_COMMAND_FAILED', 'Operazione Git non riuscita.', 'git')
}

function commandLifecycleError(command, reason, args = []) {
  const github = command === 'gh'
  if (reason === 'cancelled') {
    return applicationCommandError(command, createPublicError(github ? 'GITHUB_COMMAND_CANCELLED' : 'GIT_COMMAND_CANCELLED', github ? 'Operazione GitHub annullata.' : 'Operazione Git annullata.'), {
      args,
      category: 'cancelled',
      recoverable: false,
      severity: 'info',
    })
  }
  return applicationCommandError(command, createPublicError(github ? 'GITHUB_COMMAND_TIMEOUT' : 'GIT_COMMAND_TIMEOUT', github ? 'L’operazione GitHub ha superato il tempo disponibile.' : 'L’operazione Git ha superato il tempo disponibile.'), {
    args,
    category: 'timeout',
  })
}

function isCommandCancellation(error) {
  return error?.code === 'GIT_COMMAND_CANCELLED' || error?.code === 'GITHUB_COMMAND_CANCELLED'
}

function isCommandInterruption(error) {
  return isCommandCancellation(error) || error?.code === 'GIT_COMMAND_TIMEOUT' || error?.code === 'GITHUB_COMMAND_TIMEOUT'
}

function throwIfAborted(signal, command, args = []) {
  if (signal?.aborted) throw commandLifecycleError(command, 'cancelled', args)
}

module.exports = {
  GITHUB_AUTH_PATTERN,
  GITHUB_REMOTE_MISSING_PATTERN,
  MAX_STREAM_STDERR_BYTES,
  applicationCommandError,
  commandFailure,
  commandLifecycleError,
  isCommandCancellation,
  isCommandInterruption,
  throwIfAborted,
}
