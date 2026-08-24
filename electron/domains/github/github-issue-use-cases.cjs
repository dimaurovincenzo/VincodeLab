const { IPC_CHANNELS } = require('../../ipc/channels.cjs')
const { createPublicError } = require('../errors/public-error.cjs')
const {
  GITHUB_AUTH_PATTERN,
  GITHUB_REMOTE_MISSING_PATTERN,
  applicationCommandError,
  isCommandInterruption,
  throwIfAborted,
} = require('./command-errors.cjs')
const {
  ISSUE_LIST_JQ,
  MAX_GITHUB_ISSUES,
  assertGitHubRemoteUrl,
  assertGitHubRepositoryName,
  parseIssuesPage,
} = require('./github-model.cjs')

function createGitHubIssueUseCases({ cache, git, projects, runner }) {
  const { CACHE_TTL, getCachedResource, invalidateGitCache, invalidateGitHubDataCache } = cache
  const { getGitStatus } = git
  const { listLinkedProjectsPage } = projects
  const { run } = runner

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
    let linkedProjects = []
    let projectsHasMore = false
    let projectsDiagnostic = null
    try {
      const projectPage = await listLinkedProjectsPage(runWithSignal(signal), workspacePath, repository)
      linkedProjects = projectPage.projects
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
      projects: linkedProjects,
      projectsHasMore,
      projectsTruncated: projectsHasMore,
      hasMore: issuePage.hasMore || projectsHasMore,
      truncated: issuePage.truncated || projectsHasMore,
      githubDiagnostic: null,
      projectsDiagnostic,
    }
  }

  function getCachedGitHubData(workspacePath, options) {
    return getCachedResource(workspacePath, IPC_CHANNELS.GITHUB_DATA, CACHE_TTL.githubData, (signal) => getGitHubData(workspacePath, { signal }), options)
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

  return {
    addGitHubRemote,
    createGitHubRepository,
    createIssue,
    getCachedGitHubData,
    getGitHubData,
    getRepository,
    githubAccessDiagnostic,
    githubProjectsDiagnostic,
    githubUnavailableData,
    runWithSignal,
    updateIssue,
  }
}

module.exports = { createGitHubIssueUseCases }
