const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { isApplicationError, toApplicationError } = require('./application-error.cjs')
const { addIssueToProject, archiveProjectItem, closeLinkedProject, createLinkedProject, createProjectDraft, editLinkedProject, getProjectBoard, getProjectItemFields, listLinkedProjectsPage, updateProjectItem } = require('./github-projects.cjs')
const { createPublicError, isPublicError, toPublicError } = require('./public-error.cjs')
const { invalidateCache, readCache, writeCache } = require('./workspace-cache.cjs')
const { environmentForGitHubCli, resolveGitHubCliExecutable } = require('./github-cli-executable.cjs')

const COMMAND_OPTIONS = { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }
const COMMAND_KILL_GRACE_MS = 250
const MAX_GIT_STATUS_FILES = 1_000
const MAX_GIT_GRAPH_COMMITS = 1_000
const MAX_GIT_BRANCHES = 1_000
const MAX_GIT_PATHS_PER_COMMAND = 128
const MAX_GIT_PATH_ARGUMENT_BYTES = 64 * 1024
const MAX_GITHUB_ISSUES = 500
const MAX_GITHUB_ISSUE_BODY_CHARS = 512
const MAX_GITHUB_ISSUE_LABELS = 3
const MAX_GITHUB_ISSUES_BYTES = 1_250_000
const MAX_STREAM_STDERR_BYTES = 64 * 1024
const MAX_STATUS_OUTPUT_BYTES = 512 * 1024
const MAX_GRAPH_OUTPUT_BYTES = 512 * 1024
const MAX_DIFF_OUTPUT_BYTES = 1024 * 1024
const DIFF_TRUNCATION_NOTICE = '\n\n[Diff troncato: sono disponibili altre modifiche oltre il limite di 1 MiB.]'
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
const ISSUE_LIST_JQ = `map(.bodyTruncated = ((.body // "") | length > ${MAX_GITHUB_ISSUE_BODY_CHARS}) | .body = ((.body // "")[:${MAX_GITHUB_ISSUE_BODY_CHARS}]) | .labelsHasMore = ((.labels // []) | length > ${MAX_GITHUB_ISSUE_LABELS}) | .labels = [(.labels // [])[:${MAX_GITHUB_ISSUE_LABELS}][] | {name: .name}])`
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_FILE_NAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])
const CACHE_TTL = {
  gitStatus: 10_000,
  gitGraph: 300_000,
  githubData: 60_000,
  projectBoard: 60_000,
}
const inFlightCacheLoads = new Map()
const cacheGenerations = new Map()

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

function cacheLoadKey(workspacePath, resourceKey) {
  return `${workspacePath}\0${resourceKey}`
}

function invalidateTrackedCache(workspacePath, resourceKeys) {
  invalidateCache(workspacePath, resourceKeys)
  for (const resourceKey of resourceKeys) {
    const key = cacheLoadKey(workspacePath, resourceKey)
    cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
  }
}

function projectBoardCacheKey(projectNumber) {
  return `github:project-board:${projectNumber}`
}

function invalidateGitCache(workspacePath) {
  invalidateTrackedCache(workspacePath, ['git:status', 'git:graph'])
}

function invalidateGitHubDataCache(workspacePath) {
  invalidateTrackedCache(workspacePath, ['github:data'])
}

function invalidateProjectBoardCache(workspacePath, projectNumber) {
  invalidateTrackedCache(workspacePath, [projectBoardCacheKey(projectNumber)])
}

function invalidateProjectMutationCache(workspacePath, projectNumber) {
  invalidateGitHubDataCache(workspacePath)
  invalidateProjectBoardCache(workspacePath, projectNumber)
}

async function getCachedResource(workspacePath, resourceKey, ttlMs, load, { force = false, now = Date.now(), signal } = {}) {
  const command = resourceKey.startsWith('git:') ? 'git' : 'gh'
  throwIfAborted(signal, command)
  const cached = readCache(workspacePath, resourceKey, now)
  if (cached && !cached.cache.stale && !force) return cached

  const inFlightKey = cacheLoadKey(workspacePath, resourceKey)
  let generation = cacheGenerations.get(inFlightKey) ?? 0
  const activeLoad = inFlightCacheLoads.get(inFlightKey)
  // Due renderer diversi non devono condividere il processo appartenente al
  // signal dell'altro: chiudere una finestra cancellerebbe anche il lettore sano.
  // Le letture senza signal e quelle dello stesso contesto conservano invece il
  // single-flight storico.
  if (activeLoad?.generation === generation && activeLoad.signal === signal && !activeLoad.signal?.aborted) return activeLoad.promise
  if (activeLoad?.generation === generation && activeLoad.signal?.aborted) {
    generation += 1
    cacheGenerations.set(inFlightKey, generation)
  }

  const pendingLoad = (async () => {
    try {
      const data = await load(signal)
      throwIfAborted(signal, command)
      if ((cacheGenerations.get(inFlightKey) ?? 0) !== generation) return getCachedResource(workspacePath, resourceKey, ttlMs, load, { force: true, now, signal })
      return writeCache(workspacePath, resourceKey, data, ttlMs, now)
    } catch (error) {
      if (isCommandInterruption(error) || signal?.aborted) throw (isCommandInterruption(error) ? error : commandLifecycleError(command, 'cancelled'))
      if ((cacheGenerations.get(inFlightKey) ?? 0) !== generation) return getCachedResource(workspacePath, resourceKey, ttlMs, load, { force: true, now, signal })
      if (cached) {
        return {
          ...cached,
          cache: { ...cached.cache, stale: true, refreshError: true },
        }
      }
      throw error
    }
  })()
  const activeEntry = { generation, promise: pendingLoad, signal }
  inFlightCacheLoads.set(inFlightKey, activeEntry)

  try {
    return await pendingLoad
  } finally {
    if (inFlightCacheLoads.get(inFlightKey) === activeEntry) inFlightCacheLoads.delete(inFlightKey)
  }
}

function commandConfiguration(command) {
  const executable = command === 'gh' ? resolveGitHubCliExecutable() : command
  if (!executable) throw createPublicError('GITHUB_CLI_NOT_FOUND', 'GitHub CLI non è stato trovato.')
  return { executable, env: command === 'gh' ? environmentForGitHubCli(executable) : process.env }
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
    channel: `github:${operation}`,
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

function createCommandRunner({
  execFileImpl = execFile,
  spawnImpl = spawn,
  commandConfigurationImpl = commandConfiguration,
  timeoutMs = COMMAND_OPTIONS.timeout,
  killGraceMs = COMMAND_KILL_GRACE_MS,
} = {}) {
  if (typeof execFileImpl !== 'function' || typeof spawnImpl !== 'function' || typeof commandConfigurationImpl !== 'function') throw new Error('Runner processi Git/GitHub non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || !Number.isSafeInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 5_000) {
    throw new Error('Timeout processi Git/GitHub non validi.')
  }

  function terminateChild(child, state, reason, forceSettle) {
    if (state.settled) return
    if (state.terminationReason && !(state.terminationReason === 'truncated' && reason === 'cancelled')) return
    state.terminationReason = reason
    clearTimeout(state.timeoutTimer)
    try { child.kill('SIGTERM') } catch { /* La deadline forzata resta attiva. */ }
    if (state.killTimer) return
    state.killTimer = setTimeout(() => {
      if (state.settled) return
      try { child.kill('SIGKILL') } catch { /* Il force-settle rilascia comunque handle e listener. */ }
      state.forceTimer = setTimeout(forceSettle, killGraceMs)
    }, killGraceMs)
  }

  function run(command, args, cwd, { trim = true, signal } = {}) {
    try {
      throwIfAborted(signal, command, args)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let executable
      let env
      try {
        ;({ executable, env } = commandConfigurationImpl(command))
      } catch (error) {
        reject(commandFailure(command, error, '', args))
        return
      }

      const state = { settled: false, terminationReason: null, timeoutTimer: null, killTimer: null, forceTimer: null }
      let child
      const cleanup = () => {
        clearTimeout(state.timeoutTimer)
        clearTimeout(state.killTimer)
        clearTimeout(state.forceTimer)
        signal?.removeEventListener('abort', abort)
        child?.off?.('close', onClose)
      }
      const settle = (error, stdout = '') => {
        if (state.settled) return
        state.settled = true
        cleanup()
        if (error) reject(error)
        else resolve(trim ? stdout.trim() : stdout)
      }
      const forceSettle = () => {
        if (state.settled) return
        child?.stdout?.destroy?.()
        child?.stderr?.destroy?.()
        child?.stdin?.destroy?.()
        child?.once?.('error', () => undefined)
        child?.unref?.()
        settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const abort = () => terminateChild(child, state, 'cancelled', forceSettle)
      const onClose = () => {
        if (state.terminationReason) settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const callback = (error, stdout = '', stderr = '') => {
        if (state.settled || state.terminationReason) return
        if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
          abort()
          return
        }
        if (error) settle(commandFailure(command, error, stderr, args))
        else settle(null, typeof stdout === 'string' ? stdout : String(stdout))
      }

      try {
        child = execFileImpl(executable, args, {
          cwd,
          encoding: 'utf8',
          env,
          maxBuffer: COMMAND_OPTIONS.maxBuffer,
          windowsHide: true,
          ...(signal ? { signal } : {}),
        }, callback)
      } catch (error) {
        settle(signal?.aborted ? commandLifecycleError(command, 'cancelled', args) : commandFailure(command, error, '', args))
        return
      }
      if (!child || typeof child.kill !== 'function' || typeof child.once !== 'function') {
        settle(commandFailure(command, new Error('Processo comando non valido.'), '', args))
        return
      }
      child.once('close', onClose)
      signal?.addEventListener('abort', abort, { once: true })
      state.timeoutTimer = setTimeout(() => terminateChild(child, state, 'timeout', forceSettle), timeoutMs)
      state.timeoutTimer.unref?.()
      if (signal?.aborted) abort()
    })
  }

  function runStreaming(command, args, cwd, { acceptedExitCodes = [0], delimiterByte = null, maxBytes, maxRecords = Number.POSITIVE_INFINITY, trim = true, signal } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > COMMAND_OPTIONS.maxBuffer) throw new Error('Limite output comando non valido.')
    try {
      throwIfAborted(signal, command, args)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let executable
      let env
      try {
        ;({ executable, env } = commandConfigurationImpl(command))
      } catch (error) {
        reject(commandFailure(command, error, '', args))
        return
      }

      let child
      try {
        child = spawnImpl(executable, args, {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        reject(signal?.aborted ? commandLifecycleError(command, 'cancelled', args) : commandFailure(command, error, '', args))
        return
      }
      if (!child || typeof child.kill !== 'function' || typeof child.once !== 'function' || !child.stdout || !child.stderr) {
        reject(commandFailure(command, new Error('Processo comando non valido.'), '', args))
        return
      }

      const stdoutChunks = []
      const stderrChunks = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let records = 0
      let truncated = false
      const state = { settled: false, terminationReason: null, timeoutTimer: null, killTimer: null, forceTimer: null }

      const output = () => {
        const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8')
        return { output: trim ? stdout.trim() : stdout, truncated }
      }
      const cleanup = () => {
        clearTimeout(state.timeoutTimer)
        clearTimeout(state.killTimer)
        clearTimeout(state.forceTimer)
        signal?.removeEventListener('abort', abort)
        child.stdout.off('data', onStdoutData)
        child.stderr.off('data', onStderrData)
        child.off('error', onError)
        child.off('close', onClose)
      }
      const settle = (error, result) => {
        if (state.settled) return
        state.settled = true
        cleanup()
        if (error) reject(error)
        else resolve(result)
      }
      const forceSettle = () => {
        if (state.settled) return
        child.stdout.destroy?.()
        child.stderr.destroy?.()
        child.stdin?.destroy?.()
        child.once('error', () => undefined)
        child.unref?.()
        if (state.terminationReason === 'truncated') settle(null, output())
        else settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const abort = () => terminateChild(child, state, 'cancelled', forceSettle)
      const onStdoutData = (value) => {
        if (truncated) return
        const chunk = Buffer.from(value)
        const remaining = maxBytes - stdoutBytes
        const kept = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0)
        if (kept.length > 0) {
          stdoutChunks.push(kept)
          stdoutBytes += kept.length
          if (delimiterByte !== null) for (const byte of kept) if (byte === delimiterByte) records += 1
        }
        if (chunk.length > kept.length || stdoutBytes >= maxBytes || records >= maxRecords) {
          truncated = true
          terminateChild(child, state, 'truncated', forceSettle)
        }
      }
      const onStderrData = (value) => {
        const chunk = Buffer.from(value)
        const remaining = MAX_STREAM_STDERR_BYTES - stderrBytes
        if (remaining <= 0) return
        const kept = chunk.subarray(0, remaining)
        stderrChunks.push(kept)
        stderrBytes += kept.length
      }
      const onError = (error) => {
        if (state.terminationReason) return
        if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
          abort()
          return
        }
        settle(commandFailure(command, error, '', args))
      }
      const onClose = (code) => {
        const stderr = Buffer.concat(stderrChunks, stderrBytes).toString('utf8').trim()
        if (state.terminationReason === 'cancelled') settle(commandLifecycleError(command, 'cancelled', args))
        else if (state.terminationReason === 'timeout') settle(commandLifecycleError(command, 'timeout', args))
        else if (!truncated && !acceptedExitCodes.includes(code)) settle(commandFailure(command, undefined, stderr, args))
        else settle(null, output())
      }

      child.stdout.on('data', onStdoutData)
      child.stderr.on('data', onStderrData)
      child.once('error', onError)
      child.once('close', onClose)
      signal?.addEventListener('abort', abort, { once: true })
      state.timeoutTimer = setTimeout(() => terminateChild(child, state, 'timeout', forceSettle), timeoutMs)
      state.timeoutTimer.unref?.()
      if (signal?.aborted) abort()
    })
  }

  return Object.freeze({ run, runStreaming })
}

const commandRunner = createCommandRunner()
const run = (...args) => commandRunner.run(...args)
const runStreaming = (...args) => commandRunner.runStreaming(...args)

async function runBoundedDiff(args, cwd, acceptedExitCodes = [0], { signal } = {}) {
  const result = await runStreaming('git', args, cwd, { acceptedExitCodes, maxBytes: MAX_DIFF_OUTPUT_BYTES, signal })
  return result.truncated ? `${result.output}${DIFF_TRUNCATION_NOTICE}` : result.output
}

function parseStatusPage(output, { limit = MAX_GIT_STATUS_FILES, sourceTruncated = false } = {}) {
  const lastDelimiter = output.lastIndexOf('\0')
  const completeOutput = sourceTruncated && !output.endsWith('\0') ? output.slice(0, lastDelimiter + 1) : output
  const entries = completeOutput.split('\0').filter(Boolean)
  const files = []
  let incompleteRename = false
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const code = entry.slice(0, 2)
    const filePath = entry.slice(3)
    let previousPath
    // Nel formato -z una rinomina aggiunge il vecchio path come entry successiva.
    if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
      if (!entries[index + 1]) {
        incompleteRename = sourceTruncated
        break
      }
      previousPath = entries[index + 1]
      index += 1
    }
    files.push({ path: filePath, ...(previousPath ? { previousPath } : {}), ...(isSensitiveGitPath(filePath) ? { sensitive: true } : {}), index: code[0], workingTree: code[1] })
  }
  const hasMore = sourceTruncated || incompleteRename || files.length > limit
  return { files: files.slice(0, limit), hasMore, truncated: hasMore }
}

function parseStatus(output) {
  return parseStatusPage(output).files
}

function isSensitiveGitPath(filePath) {
  const fileName = path.posix.basename(String(filePath)).toLowerCase()
  if (SAFE_ENV_TEMPLATES.has(fileName)) return false
  return fileName.startsWith('.env') || SENSITIVE_FILE_NAMES.has(fileName) || /\.(pem|key|p12|pfx)$/i.test(fileName)
}

function parseHistory(output) {
  if (!output) return []
  return output.split('\x1e').map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, '')).filter(Boolean).map((record) => {
    const [sha, subject, author, date] = record.split('\x1f')
    return { sha, subject, author, date }
  })
}

function parseGraphPage(output, { limit = MAX_GIT_GRAPH_COMMITS, sourceTruncated = false } = {}) {
  if (!output) return { graph: [], hasMore: sourceTruncated, truncated: sourceTruncated }
  const lastDelimiter = output.lastIndexOf('\n')
  const completeOutput = sourceTruncated && !output.endsWith('\n') ? output.slice(0, lastDelimiter + 1) : output
  const graph = completeOutput.split('\n').filter(Boolean).map((row) => {
    const [sha, parents = '', refs = '', ...subjectParts] = row.split('|')
    const subject = subjectParts.join('|')
    return { sha, parents: parents ? parents.split(' ') : [], refs: refs ? refs.split(', ').filter(Boolean) : [], subject }
  })
  const hasMore = sourceTruncated || graph.length > limit
  return { graph: graph.slice(0, limit), hasMore, truncated: hasMore }
}

function parseGraph(output) {
  return parseGraphPage(output).graph
}

function takeJsonBudget(items, { maxItems, maxBytes }) {
  const limited = []
  let bytes = 2
  for (const item of items) {
    if (limited.length >= maxItems) break
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + (limited.length > 0 ? 1 : 0)
    if (bytes + itemBytes > maxBytes) break
    limited.push(item)
    bytes += itemBytes
  }
  return { items: limited, hasMore: limited.length < items.length, bytes }
}

function parseIssuesPage(output, { sourceTruncated = false } = {}) {
  let payload
  try {
    payload = JSON.parse(output)
  } catch {
    throw createPublicError('GITHUB_RESPONSE_INVALID', 'Risposta GitHub non valida.')
  }
  if (!Array.isArray(payload)) throw new Error('Elenco issue GitHub non valido.')
  const page = takeJsonBudget(payload, { maxItems: MAX_GITHUB_ISSUES, maxBytes: MAX_GITHUB_ISSUES_BYTES })
  const hasMore = sourceTruncated || page.hasMore
  return { issues: page.items, hasMore, truncated: hasMore, resultBytes: page.bytes }
}

function assertBranchName(branchName) {
  if (typeof branchName !== 'string' || branchName.length === 0 || branchName.length > 255 || branchName.startsWith('-') || branchName.startsWith('/') || branchName.endsWith('/') || branchName.endsWith('.') || branchName.includes('..') || branchName.includes('@{') || !/^[A-Za-z0-9._/-]+$/.test(branchName)) throw new Error('Branch non valido.')
  return branchName
}

function assertGitHubRemoteUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2_048) throw new Error('Inserisci l’URL GitHub del repository.')
  const value = rawUrl.trim()
  const httpsMatch = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(value)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2].replace(/\.git$/i, '')}.git`
  const sshMatch = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(value)
  if (sshMatch) return `git@github.com:${sshMatch[1]}/${sshMatch[2].replace(/\.git$/i, '')}.git`
  throw new Error('Usa un URL GitHub HTTPS o SSH valido.')
}

function assertGitHubRepositoryName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0 || rawName.length > 200) throw new Error('Inserisci un nome repository valido.')
  const name = rawName.trim()
  if (!/^(?:[\w.-]+\/)?[\w.-]+$/.test(name) || name.startsWith('.') || name.endsWith('.git')) {
    throw new Error('Il nome repository può contenere lettere, numeri, punti, trattini e un owner opzionale.')
  }
  return name
}

function parseBranches(output) {
  return output.split('\0').map((entry) => entry.replace(/^[\r\n]+/, '')).filter(Boolean).map((entry) => {
    const current = entry.startsWith('* ')
    const name = entry.startsWith('* ') || entry.startsWith('  ') ? entry.slice(2) : entry.trim()
    return { name, current }
  }).filter((branch) => branch.name)
}

function assertFilePaths(filePaths, { allowSensitive = false } = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > 1_000) throw new Error('Seleziona almeno un file valido.')
  return filePaths.map((filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4_096 || path.isAbsolute(filePath)) throw new Error('Percorso file non valido.')
    const normalized = path.posix.normalize(filePath)
    if (normalized === '..' || normalized.startsWith('../') || normalized === '.git' || normalized.startsWith('.git/')) throw new Error('Il percorso richiesto non è consentito.')
    if (!allowSensitive && isSensitiveGitPath(normalized)) throw new Error('Il file riservato non può essere aggiunto dallo strumento Git.')
    return normalized
  })
}

function chunkGitFilePaths(filePaths) {
  const chunks = []
  let current = []
  let currentBytes = 0
  for (const filePath of filePaths) {
    const pathBytes = Buffer.byteLength(filePath, 'utf8') + 1
    if (current.length > 0 && (current.length >= MAX_GIT_PATHS_PER_COMMAND || currentBytes + pathBytes > MAX_GIT_PATH_ARGUMENT_BYTES)) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(filePath)
    currentBytes += pathBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function isGitRepository(workspacePath, { signal, runCommand = run } = {}) {
  let result
  try {
    result = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], workspacePath, { signal })
  } catch (error) {
    const repositoryError = commandFailure('git', error, error?.stderr, ['rev-parse', '--is-inside-work-tree'])
    if (repositoryError.code === 'GIT_NOT_REPOSITORY') return false
    throw repositoryError
  }
  if (result === 'true') return true
  if (result === 'false') {
    throw applicationCommandError('git', undefined, {
      category: 'configuration',
      code: 'GIT_WORKTREE_REQUIRED',
      message: 'Il workspace punta a un repository Git senza working tree. Apri una copia di lavoro e riprova.',
      operation: 'gitStatus',
      severity: 'warning',
    })
  }
  throw applicationCommandError('git', undefined, {
    code: 'GIT_REPOSITORY_CHECK_FAILED',
    message: 'Git non ha restituito uno stato repository valido. Riprova o copia la diagnostica.',
    operation: 'gitStatus',
  })
}

async function initializeGitRepository(workspacePath) {
  if (await isGitRepository(workspacePath)) return getGitStatus(workspacePath)
  await run('git', ['init'], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function addGitHubRemote(workspacePath, rawUrl) {
  const status = await getGitStatus(workspacePath)
  if (!status.isRepository) throw applicationCommandError('git', undefined, { category: 'not-found', code: 'GIT_NOT_REPOSITORY', message: 'Inizializza prima il repository Git.', operation: 'addRemote', severity: 'warning' })
  if (status.remote) throw applicationCommandError('git', undefined, { category: 'conflict', code: 'GIT_REMOTE_ALREADY_CONFIGURED', message: 'Il repository ha già un remote configurato. Rimuovilo o modificalo prima di riprovare.', operation: 'addRemote', severity: 'warning' })
  await run('git', ['remote', 'add', 'origin', assertGitHubRemoteUrl(rawUrl)], workspacePath)
  invalidateGitCache(workspacePath)
  invalidateGitHubDataCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function createGitHubRepository(workspacePath, rawName, visibility) {
  const status = await getGitStatus(workspacePath)
  if (!status.isRepository) throw applicationCommandError('git', undefined, { category: 'not-found', code: 'GIT_NOT_REPOSITORY', message: 'Inizializza prima il repository Git.', operation: 'createRepository', severity: 'warning' })
  if (status.remote) throw applicationCommandError('git', undefined, { category: 'conflict', code: 'GIT_REMOTE_ALREADY_CONFIGURED', message: 'Il repository ha già un remote configurato. Rimuovilo o modificalo prima di riprovare.', operation: 'createRepository', severity: 'warning' })
  if (status.branch === '(detached HEAD)') throw applicationCommandError('git', undefined, { category: 'conflict', code: 'GIT_DETACHED_HEAD', message: 'Il repository è in modalità detached HEAD. Crea o seleziona un branch prima di pubblicarlo.', operation: 'createRepository', severity: 'warning' })
  if (!['private', 'public'].includes(visibility)) throw new Error('Visibilità repository non valida.')
  await run('git', ['rev-parse', '--verify', 'HEAD'], workspacePath).catch((error) => {
    if (error?.code !== 'GIT_NO_COMMITS') throw error
    throw applicationCommandError('git', undefined, { category: 'not-found', code: 'GIT_NO_COMMITS', message: 'Crea almeno un commit prima di pubblicare il repository su GitHub.', operation: 'createRepository', severity: 'warning' })
  })
  await run('gh', ['repo', 'create', assertGitHubRepositoryName(rawName), `--${visibility}`, '--source=.', '--remote=origin', '--push'], workspacePath)
  invalidateGitCache(workspacePath)
  invalidateGitHubDataCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function getGitStatusBase(workspacePath, { signal } = {}) {
  if (!await isGitRepository(workspacePath, { signal })) return { isRepository: false, remote: null, files: [], commits: [], filesHasMore: false, filesTruncated: false }
  const [branch, statusResult, historyOutput, remotesOutput] = await Promise.all([
    run('git', ['branch', '--show-current'], workspacePath, { signal }),
    // L'Explorer richiede lo stato del singolo file: Git altrimenti compatta una cartella non tracciata in `?? cartella/`.
    // I due caratteri iniziali sono lo stato index/worktree: rimuovere gli
    // spazi dall'intero output trasformerebbe il primo file modificato in staged.
    runStreaming('git', ['status', '--porcelain=v1', '--untracked-files=all', '-z'], workspacePath, {
      delimiterByte: 0,
      maxBytes: MAX_STATUS_OUTPUT_BYTES,
      maxRecords: (MAX_GIT_STATUS_FILES + 1) * 2,
      trim: false,
      signal,
    }),
    // Un repository appena inizializzato non ha ancora HEAD: la cronologia vuota è uno stato valido.
    run('git', ['log', '-20', '--format=%H%x1f%s%x1f%an%x1f%aI%x1e'], workspacePath, { signal }).catch((error) => {
      if (error?.code === 'GIT_NO_COMMITS') return ''
      throw error
    }),
    run('git', ['remote'], workspacePath, { signal }),
  ])
  const statusPage = parseStatusPage(statusResult.output, { sourceTruncated: statusResult.truncated })
  const remotes = remotesOutput.split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0] ?? null
  let upstream = null
  let ahead = 0
  let behind = 0
  try {
    upstream = await run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], workspacePath, { signal })
    const counts = await run('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], workspacePath, { signal })
    ;[behind, ahead] = counts.split(/\s+/).map(Number)
  } catch (error) {
    if (error?.code !== 'GIT_UPSTREAM_NOT_CONFIGURED') throw error
    // Senza upstream i commit locali sono comunque pubblicabili: mostrali come da inviare.
    if (remote && branch) ahead = Number(await run('git', ['rev-list', '--count', 'HEAD'], workspacePath, { signal }).catch((aheadError) => {
      if (aheadError?.code === 'GIT_NO_COMMITS') return '0'
      throw aheadError
    })) || 0
  }
  return {
    isRepository: true,
    branch: branch || '(detached HEAD)',
    remote,
    upstream,
    ahead,
    behind,
    files: statusPage.files,
    filesHasMore: statusPage.hasMore,
    filesTruncated: statusPage.truncated,
    commits: parseHistory(historyOutput),
  }
}

async function getGitGraphPage(workspacePath, { signal } = {}) {
  if (!await isGitRepository(workspacePath, { signal })) return { graph: [], hasMore: false, truncated: false }
  try {
    const result = await runStreaming('git', ['log', '--all', `-${MAX_GIT_GRAPH_COMMITS + 1}`, '--format=%H|%P|%D|%s'], workspacePath, {
      delimiterByte: 10,
      maxBytes: MAX_GRAPH_OUTPUT_BYTES,
      maxRecords: MAX_GIT_GRAPH_COMMITS + 1,
      trim: false,
      signal,
    })
    return parseGraphPage(result.output, { sourceTruncated: result.truncated })
  } catch (error) {
    if (error?.code === 'GIT_NO_COMMITS') return { graph: [], hasMore: false, truncated: false }
    throw error
  }
}

async function getGitStatus(workspacePath, { signal } = {}) {
  const [status, graphPage] = await Promise.all([getGitStatusBase(workspacePath, { signal }), getGitGraphPage(workspacePath, { signal })])
  const hasMore = status.filesHasMore === true || graphPage.hasMore
  return { ...status, graph: graphPage.graph, graphHasMore: graphPage.hasMore, graphTruncated: graphPage.truncated, hasMore, truncated: hasMore }
}

async function getCachedGitStatus(workspacePath, options) {
  const [status, graph] = await Promise.all([
    getCachedResource(workspacePath, 'git:status', CACHE_TTL.gitStatus, (signal) => getGitStatusBase(workspacePath, { signal }), options),
    getCachedResource(workspacePath, 'git:graph', CACHE_TTL.gitGraph, (signal) => getGitGraphPage(workspacePath, { signal }), options),
  ])
  const graphPage = Array.isArray(graph.data)
    ? { graph: graph.data, hasMore: false, truncated: false }
    : Array.isArray(graph.data?.graph) ? graph.data : { graph: [], hasMore: false, truncated: false }
  const hasMore = status.data.filesHasMore === true || graphPage.hasMore === true
  return {
    data: {
      ...status.data,
      graph: graphPage.graph,
      graphHasMore: graphPage.hasMore === true,
      graphTruncated: graphPage.truncated === true,
      hasMore,
      truncated: hasMore,
    },
    cache: {
      fetchedAt: Math.min(status.cache.fetchedAt, graph.cache.fetchedAt),
      expiresAt: Math.min(status.cache.expiresAt, graph.cache.expiresAt),
      stale: status.cache.stale || graph.cache.stale,
      ...(status.cache.refreshError || graph.cache.refreshError ? { refreshError: true } : {}),
    },
  }
}

async function stageFiles(workspacePath, filePaths) {
  const safePaths = assertFilePaths(filePaths)
  // Ogni batch può avere già modificato l'index quando un comando successivo fallisce.
  // Invalidare prima evita di servire in quel caso uno snapshot certamente obsoleto.
  invalidateGitCache(workspacePath)
  for (const batch of chunkGitFilePaths(safePaths)) await run('git', ['add', '--', ...batch], workspacePath)
  return getGitStatus(workspacePath)
}

async function unstageFiles(workspacePath, filePaths) {
  const safePaths = assertFilePaths(filePaths, { allowSensitive: true })
  invalidateGitCache(workspacePath)
  for (const batch of chunkGitFilePaths(safePaths)) await run('git', ['restore', '--staged', '--', ...batch], workspacePath)
  return getGitStatus(workspacePath)
}

async function commit(workspacePath, message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw new Error('Inserisci un messaggio di commit valido.')
  const stagedResult = await runStreaming('git', ['diff', '--cached', '--name-only', '-z'], workspacePath, {
    delimiterByte: 0,
    maxBytes: COMMAND_OPTIONS.maxBuffer,
    maxRecords: 1_001,
    trim: false,
  })
  if (stagedResult.truncated) throw new Error('Lo staging supera il limite di 1.000 file: riducilo prima di creare il commit.')
  const stagedPaths = stagedResult.output.split('\0').filter(Boolean)
  if (stagedPaths.some(isSensitiveGitPath)) throw new Error('Rimuovi dallo staging i file riservati prima di creare il commit.')
  await run('git', ['commit', '-m', message.trim()], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function push(workspacePath) {
  const status = await getGitStatus(workspacePath)
  if (!status.remote) throw applicationCommandError('git', undefined, { category: 'configuration', code: 'GIT_REMOTE_NOT_CONFIGURED', message: 'Configura un remote prima di pubblicare il branch.', operation: 'push', severity: 'warning' })
  if (status.branch === '(detached HEAD)') throw applicationCommandError('git', undefined, { category: 'conflict', code: 'GIT_DETACHED_HEAD', message: 'Non puoi pubblicare da HEAD scollegato. Crea o seleziona un branch e riprova.', operation: 'push', severity: 'warning' })
  await run('git', status.upstream ? ['push'] : ['push', '--set-upstream', status.remote, status.branch], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function fetchRemote(workspacePath) {
  const status = await getGitStatus(workspacePath)
  if (!status.remote) throw applicationCommandError('git', undefined, { category: 'configuration', code: 'GIT_REMOTE_NOT_CONFIGURED', message: 'Configura un remote prima di cercare aggiornamenti.', operation: 'fetch', severity: 'warning' })
  await run('git', ['fetch', status.remote, '--prune'], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function pullRebase(workspacePath) {
  const status = await getGitStatus(workspacePath)
  if (!status.upstream) throw applicationCommandError('git', undefined, { category: 'configuration', code: 'GIT_UPSTREAM_NOT_CONFIGURED', message: 'Configura un upstream prima di integrare le modifiche remote.', operation: 'pullRebase', severity: 'warning' })
  await run('git', ['pull', '--rebase'], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function listBranches(workspacePath, { signal } = {}) {
  if (!await isGitRepository(workspacePath, { signal })) return { branches: [], hasMore: false, truncated: false }
  const [branchesOutput, currentBranch] = await Promise.all([
    run('git', ['for-each-ref', `--count=${MAX_GIT_BRANCHES + 1}`, '--format=%(HEAD) %(refname:short)%00', 'refs/heads'], workspacePath, { signal }),
    run('git', ['branch', '--show-current'], workspacePath, { signal }),
  ])
  const branches = parseBranches(branchesOutput)
  const hasMore = branches.length > MAX_GIT_BRANCHES
  // Prima del primo commit Git conosce il branch iniziale, ma non esiste ancora una ref da enumerare.
  if (branches.length === 0 && currentBranch) return { branches: [{ name: currentBranch, current: true }], hasMore: false, truncated: false }
  const normalized = branches.map((branch) => ({ ...branch, current: Boolean(currentBranch) && branch.name === currentBranch }))
  const limited = normalized.slice(0, MAX_GIT_BRANCHES)
  const current = normalized.find((branch) => branch.current)
    ?? (currentBranch ? { name: currentBranch, current: true } : null)
  if (current && !limited.some((branch) => branch.current)) {
    if (limited.length < MAX_GIT_BRANCHES) limited.push(current)
    else limited[limited.length - 1] = current
  }
  return { branches: limited, hasMore, truncated: hasMore }
}

async function switchBranch(workspacePath, branchName) {
  await run('git', ['switch', assertBranchName(branchName)], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function createBranch(workspacePath, branchName) {
  await run('git', ['switch', '-c', assertBranchName(branchName)], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function getFileDiff(workspacePath, filePath, { signal } = {}) {
  const [safePath] = assertFilePaths([filePath])
  const isTracked = await run('git', ['ls-files', '--error-unmatch', '--', safePath], workspacePath, { signal })
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'GIT_PATH_UNTRACKED') return false
      throw error
    })
  if (!isTracked) {
    // git diff ignora i file non tracciati; --no-index produce invece una patch leggibile contro un file vuoto.
    return runBoundedDiff(['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', safePath], workspacePath, [1], { signal })
  }
  // Con HEAD presente include insieme staging e modifiche locali; su un repository appena inizializzato ripiega sullo staging.
  return runBoundedDiff(['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--', safePath], workspacePath, [0], { signal })
    .catch((error) => {
      if (error?.code !== 'GIT_NO_COMMITS') throw error
      return runBoundedDiff(['diff', '--cached', '--no-ext-diff', '--unified=3', '--', safePath], workspacePath, [0], { signal })
    })
}

async function revertCommit(workspacePath, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error('Commit non valido.')
  await run('git', ['revert', '--no-edit', sha], workspacePath)
  invalidateGitCache(workspacePath)
  return getGitStatus(workspacePath)
}

async function getRepository(workspacePath, { signal } = {}) {
  const raw = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,url,owner'], workspacePath, { signal })
  let repository
  try {
    repository = JSON.parse(raw)
  } catch {
    throw createPublicError('GITHUB_RESPONSE_INVALID', 'Risposta repository GitHub non valida.')
  }
  if (!repository.nameWithOwner || !repository.owner?.login) throw createPublicError('GITHUB_REPOSITORY_UNAVAILABLE', 'Repository GitHub non riconosciuto.')
  return { nameWithOwner: repository.nameWithOwner, url: repository.url, owner: repository.owner.login }
}

function diagnosticInput(value) {
  return {
    code: typeof value?.code === 'string' ? value.code : null,
    detail: typeof value === 'string' ? value : value instanceof Error ? value.message : '',
  }
}

function githubUnavailableData(value) {
  const { code, detail } = diagnosticInput(value)
  const isMissingRemote = code === 'GITHUB_REPOSITORY_UNAVAILABLE' || GITHUB_REMOTE_MISSING_PATTERN.test(detail)
  const authRequired = code === 'GITHUB_AUTH_REQUIRED' || GITHUB_AUTH_PATTERN.test(detail)
  const githubDiagnostic = isMissingRemote
    ? 'Collega o crea un repository GitHub dalla scheda Modifiche per usare issue e progetti.'
    : authRequired
      ? 'Accedi a GitHub CLI per gestire issue e Projects di questo workspace.'
      : code === 'GITHUB_CLI_NOT_FOUND'
        ? 'GitHub CLI non è disponibile. Installala o configurala e riprova.'
        : code === 'GITHUB_RATE_LIMITED'
          ? 'GitHub sta limitando le richieste. Attendi qualche minuto e riprova.'
          : code === 'GITHUB_NETWORK_UNAVAILABLE'
            ? 'Impossibile raggiungere GitHub. Controlla la connessione e riprova.'
            : code === 'GITHUB_REPOSITORY_NOT_FOUND'
              ? 'Il repository GitHub non è più disponibile. Verifica il collegamento e riprova.'
              : code === 'GITHUB_PERMISSION_DENIED'
                ? 'GitHub ha rifiutato l’accesso al repository. Verifica i permessi e riprova.'
                : 'GitHub non è disponibile per questo workspace. Riprova o copia la diagnostica.'
  return {
    repository: null,
    issues: [],
    issuesHasMore: false,
    issuesTruncated: false,
    projects: [],
    projectsHasMore: false,
    projectsTruncated: false,
    hasMore: false,
    truncated: false,
    githubDiagnostic,
    projectsDiagnostic: null,
  }
}

function githubAccessDiagnostic(value) {
  const { code, detail } = diagnosticInput(value)
  if (code === 'GITHUB_AUTH_REQUIRED' || GITHUB_AUTH_PATTERN.test(detail)) {
    return 'Accedi a GitHub CLI per gestire issue e Projects di questo workspace.'
  }
  if (code === 'GITHUB_RATE_LIMITED') return 'GitHub sta limitando le richieste. Attendi qualche minuto e riprova.'
  if (code === 'GITHUB_NETWORK_UNAVAILABLE') return 'Impossibile raggiungere GitHub. Controlla la connessione e riprova.'
  if (code === 'GITHUB_REPOSITORY_NOT_FOUND') return 'Il repository GitHub non è più disponibile. Verifica il collegamento e riprova.'
  if (code === 'GITHUB_PERMISSION_DENIED') return 'GitHub ha rifiutato l’operazione. Verifica i permessi e riprova.'
  if (code === 'GITHUB_CLI_NOT_FOUND') return 'GitHub CLI non è disponibile. Installala o configurala e riprova.'
  return 'GitHub non risponde per questo workspace. Verifica la connessione e la configurazione di GitHub CLI.'
}

function githubProjectsDiagnostic(error) {
  const { code } = diagnosticInput(error)
  if (code === 'GITHUB_PROJECT_SCOPE_REQUIRED') return createPublicError('GITHUB_PROJECT_SCOPE_REQUIRED', 'Autorizzazione GitHub Projects mancante.').message
  if (code === 'GITHUB_AUTH_REQUIRED') return createPublicError('GITHUB_AUTH_REQUIRED', 'Accedi a GitHub CLI per leggere i Projects.').message
  if (code === 'GITHUB_RATE_LIMITED') return createPublicError('GITHUB_RATE_LIMITED', 'GitHub sta limitando le richieste. Attendi qualche minuto e riprova.').message
  if (code === 'GITHUB_NETWORK_UNAVAILABLE') return createPublicError('GITHUB_NETWORK_UNAVAILABLE', 'Impossibile raggiungere GitHub. Controlla la connessione e riprova.').message
  if (code === 'GITHUB_PERMISSION_DENIED') return createPublicError('GITHUB_PERMISSION_DENIED', 'GitHub ha rifiutato l’accesso ai Projects. Verifica i permessi e riprova.').message
  return createPublicError('GITHUB_PROJECTS_UNAVAILABLE', 'Impossibile leggere i GitHub Projects.').message
}

function runWithSignal(signal) {
  return (command, args, cwd, options = {}) => run(command, args, cwd, { ...options, signal })
}

async function getGitHubData(workspacePath, { signal } = {}) {
  throwIfAborted(signal, 'gh')
  let repository
  try {
    repository = await getRepository(workspacePath, { signal })
  } catch (error) {
    if (isCommandInterruption(error)) throw error
    return githubUnavailableData(error)
  }
  let issuesOutput
  try {
    issuesOutput = await run('gh', [
      'issue', 'list', '--repo', repository.nameWithOwner, '--state', 'all',
      '--limit', String(MAX_GITHUB_ISSUES + 1),
      '--json', 'number,title,body,state,author,createdAt,updatedAt,url,labels',
      '--jq', ISSUE_LIST_JQ,
    ], workspacePath, { signal })
  } catch (error) {
    if (isCommandInterruption(error)) throw error
    return {
      repository,
      issues: [],
      issuesHasMore: false,
      issuesTruncated: false,
      projects: [],
      projectsHasMore: false,
      projectsTruncated: false,
      hasMore: false,
      truncated: false,
      githubDiagnostic: githubAccessDiagnostic(error),
      projectsDiagnostic: null,
    }
  }
  const issuePage = parseIssuesPage(issuesOutput)
  // La permissione OAuth `project` può mancare senza impedire la gestione delle issue.
  let projects = []
  let projectsHasMore = false
  let projectsDiagnostic = null
  try {
    const projectPage = await listLinkedProjectsPage(runWithSignal(signal), workspacePath, repository)
    projects = projectPage.projects
    projectsHasMore = projectPage.hasMore
  } catch (error) {
    if (isCommandInterruption(error)) throw error
    // Le issue restano gestibili, ma la UI deve distinguere l'assenza di board da uno scope OAuth mancante.
    projectsDiagnostic = githubProjectsDiagnostic(error)
  }
  return {
    repository,
    issues: issuePage.issues,
    issuesHasMore: issuePage.hasMore,
    issuesTruncated: issuePage.truncated,
    issuesResultBytes: issuePage.resultBytes,
    projects,
    projectsHasMore,
    projectsTruncated: projectsHasMore,
    hasMore: issuePage.hasMore || projectsHasMore,
    truncated: issuePage.truncated || projectsHasMore,
    githubDiagnostic: null,
    projectsDiagnostic,
  }
}

function getCachedGitHubData(workspacePath, options) {
  return getCachedResource(workspacePath, 'github:data', CACHE_TTL.githubData, (signal) => getGitHubData(workspacePath, { signal }), options)
}

function issueReference(issueNumber) {
  const number = Number(issueNumber)
  if (!Number.isInteger(number) || number < 1) throw new Error('Issue non valida.')
  return String(number)
}

async function createIssue(workspacePath, title, body) {
  if (typeof title !== 'string' || !title.trim() || title.length > 256) throw new Error('Inserisci un titolo issue valido.')
  if (typeof body !== 'string' || body.length > 65_536) throw new Error('Descrizione issue non valida.')
  const repository = await getRepository(workspacePath)
  await run('gh', ['issue', 'create', '--repo', repository.nameWithOwner, '--title', title.trim(), '--body', body], workspacePath)
  invalidateGitHubDataCache(workspacePath)
  return getGitHubData(workspacePath)
}

async function updateIssue(workspacePath, issueNumber, title, body, state) {
  if (typeof title !== 'string' || !title.trim() || title.length > 256) throw new Error('Inserisci un titolo issue valido.')
  if (typeof body !== 'string' || body.length > 65_536 || !['OPEN', 'CLOSED'].includes(state)) throw new Error('Dati issue non validi.')
  const repository = await getRepository(workspacePath)
  const args = ['issue', 'edit', issueReference(issueNumber), '--repo', repository.nameWithOwner, '--title', title.trim(), '--body', body]
  args.push(state === 'CLOSED' ? '--close' : '--reopen')
  await run('gh', args, workspacePath)
  invalidateGitHubDataCache(workspacePath)
  return getGitHubData(workspacePath)
}

async function getLinkedProjectBoard(workspacePath, projectNumber, { signal } = {}) {
  try {
    return await getProjectBoard(runWithSignal(signal), workspacePath, await getRepository(workspacePath, { signal }), projectNumber)
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_BOARD_FAILED', message: 'Lettura del Project GitHub non riuscita.' })
  }
}

function getCachedProjectBoard(workspacePath, projectNumber, options) {
  return getCachedResource(workspacePath, projectBoardCacheKey(projectNumber), CACHE_TTL.projectBoard, (signal) => getLinkedProjectBoard(workspacePath, projectNumber, { signal }), options)
}

async function addWorkspaceIssueToProject(workspacePath, projectNumber, issueUrl) {
  try {
    const result = await addIssueToProject(run, workspacePath, await getRepository(workspacePath), projectNumber, issueUrl)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

async function updateWorkspaceProjectItem(workspacePath, projectNumber, itemId, fieldId, update) {
  try {
    const result = await updateProjectItem(run, workspacePath, await getRepository(workspacePath), projectNumber, itemId, fieldId, update)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

async function getWorkspaceProjectItemFields(workspacePath, projectNumber, itemId, { signal } = {}) {
  try {
    return await getProjectItemFields(runWithSignal(signal), workspacePath, await getRepository(workspacePath, { signal }), projectNumber, itemId)
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_FIELDS_FAILED', message: 'Lettura dei campi Project non riuscita.' })
  }
}

async function createWorkspaceProject(workspacePath, title) {
  try {
    const result = await createLinkedProject(run, workspacePath, await getRepository(workspacePath), title)
    invalidateGitHubDataCache(workspacePath)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_CREATE_FAILED', message: 'Creazione del Project GitHub non riuscita.' })
  }
}

async function editWorkspaceProject(workspacePath, projectNumber, title, description) {
  try {
    const result = await editLinkedProject(run, workspacePath, await getRepository(workspacePath), projectNumber, title, description)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

async function closeWorkspaceProject(workspacePath, projectNumber, undo) {
  try {
    const result = await closeLinkedProject(run, workspacePath, await getRepository(workspacePath), projectNumber, undo)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

async function createWorkspaceProjectDraft(workspacePath, projectNumber, title, body) {
  try {
    const result = await createProjectDraft(run, workspacePath, await getRepository(workspacePath), projectNumber, title, body)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

async function archiveWorkspaceProjectItem(workspacePath, projectNumber, itemId, undo) {
  try {
    const result = await archiveProjectItem(run, workspacePath, await getRepository(workspacePath), projectNumber, itemId, undo)
    invalidateProjectMutationCache(workspacePath, projectNumber)
    return result
  } catch (error) {
    throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
  }
}

module.exports = { CACHE_TTL, MAX_GIT_GRAPH_COMMITS, MAX_GIT_STATUS_FILES, MAX_GITHUB_ISSUES, addGitHubRemote, addWorkspaceIssueToProject, archiveWorkspaceProjectItem, assertBranchName, assertFilePaths, assertGitHubRemoteUrl, assertGitHubRepositoryName, chunkGitFilePaths, closeWorkspaceProject, commandFailure, commandLifecycleError, commit, createBranch, createCommandRunner, createGitHubRepository, createIssue, createWorkspaceProject, createWorkspaceProjectDraft, editWorkspaceProject, fetchRemote, getCachedGitHubData, getCachedGitStatus, getCachedProjectBoard, getCachedResource, getFileDiff, getGitHubData, getGitStatus, getLinkedProjectBoard, getWorkspaceProjectItemFields, githubAccessDiagnostic, githubProjectsDiagnostic, githubUnavailableData, initializeGitRepository, invalidateGitCache, invalidateGitHubDataCache, invalidateProjectBoardCache, isCommandCancellation, isCommandInterruption, isGitRepository, isSensitiveGitPath, listBranches, parseBranches, parseGraph, parseGraphPage, parseHistory, parseIssuesPage, parseStatus, parseStatusPage, projectBoardCacheKey, pullRebase, push, revertCommit, stageFiles, switchBranch, takeJsonBudget, unstageFiles, updateIssue, updateWorkspaceProjectItem }
