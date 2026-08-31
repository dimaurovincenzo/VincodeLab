const { applicationCommandError, commandFailure } = require('./command-errors.cjs')
const {
  MAX_GIT_BRANCHES,
  MAX_GIT_GRAPH_COMMITS,
  MAX_GIT_STATUS_FILES,
  MAX_GRAPH_OUTPUT_BYTES,
  MAX_STATUS_OUTPUT_BYTES,
  assertBranchName,
  assertFilePaths,
  chunkGitFilePaths,
  isSensitiveGitPath,
  parseBranches,
  parseGraphPage,
  parseHistory,
  parseStatusPage,
} = require('./github-model.cjs')

function createGitLocalUseCases({ cache, runner }) {
  const { CACHE_TTL, getCachedResource, invalidateGitCache } = cache
  const { COMMAND_OPTIONS, run, runBoundedDiff, runStreaming } = runner

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
      const result = await runStreaming('git', ['log', `-${MAX_GIT_GRAPH_COMMITS + 1}`, '--format=%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s'], workspacePath, {
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

  return {
    commit,
    createBranch,
    fetchRemote,
    getCachedGitStatus,
    getFileDiff,
    getGitStatus,
    initializeGitRepository,
    isGitRepository,
    listBranches,
    pullRebase,
    push,
    revertCommit,
    stageFiles,
    switchBranch,
    unstageFiles,
  }
}

module.exports = { createGitLocalUseCases }
