// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot, AppPreferenceValue, WorkspaceSessionState } from '@/bridge'

vi.mock('@/lib/app-preferences', () => ({
  effectivePreference: (preferences: AppPreferencesSnapshot | null, key: string, fallback: AppPreferenceValue) => preferences?.effective[key] ?? fallback,
  useAppPreferences: () => ({
    preferences: {
      effective: {
        'git.autoRefreshSeconds': 1,
        'git.confirmRemoteActions': false,
        'git.historyLimit': 100,
        'git.projectSelectorWidth': 360,
      },
    },
  }),
}))

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>()
  return {
    ...actual,
    SelectField: ({ 'aria-label': ariaLabel, disabled, label, onValueChange, options, value }: {
      'aria-label'?: string
      disabled?: boolean
      label?: string
      onValueChange: (value: string) => void
      options: Array<{ label: string; value: string }>
      value?: string
    }) => <label>{label}<select aria-label={ariaLabel ?? label} disabled={disabled} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>,
  }
})

import { GitHubWorkspace, type GitHubWorkbenchRequest } from '@/features/github'
import { dispatchApplicationMenuCommand } from '@/lib/app-menu-command'

const freshCache: CacheMetadata = { fetchedAt: 1, expiresAt: 2, stale: false }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function cached<T>(data: T): CachedResult<T> {
  return { data, cache: freshCache }
}

function gitStatus(branch = 'main', files: GitFileStatus[] = []): GitStatus {
  return { isRepository: true, branch, remote: null, upstream: null, ahead: 0, behind: 0, files, commits: [], graph: [], filesHasMore: false, filesTruncated: false, graphHasMore: false, graphTruncated: false, hasMore: false, truncated: false }
}

function branches(branch = 'main'): GitBranchPage {
  return { branches: [{ name: branch, current: true }], hasMore: false, truncated: false }
}

function project(number: number): GitHubProject {
  return { id: `project-${number}`, number, title: `Project ${number}`, shortDescription: `Descrizione ${number}`, closed: false, url: `https://example.test/project/${number}` }
}

function projectBoard(number: number, itemTitle: string): GitHubProjectBoard {
  return {
    project: project(number),
    fields: [],
    fieldsHasMore: false,
    fieldsTruncated: false,
    fieldOptionsTruncated: false,
    fieldsResultBytes: 2,
    items: [{ id: `item-${number}`, type: 'ISSUE', title: itemTitle, content: { title: itemTitle, number } }],
    itemsHasMore: false,
    itemsTruncated: false,
    itemValuesTruncated: false,
    itemsResultBytes: 2,
    hasMore: false,
    truncated: false,
  }
}

function githubData(issueTitle = 'Issue iniziale'): GitHubData {
  return {
    repository: { nameWithOwner: 'acme/app', owner: 'acme', url: 'https://github.com/acme/app' },
    issues: [{
      number: 1,
      title: issueTitle,
      body: '',
      state: 'OPEN',
      author: { login: 'octocat' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      url: 'https://github.com/acme/app/issues/1',
      labels: [],
    }],
    issuesHasMore: false,
    issuesTruncated: false,
    projects: [project(1), project(2)],
    projectsHasMore: false,
    projectsTruncated: false,
    hasMore: false,
    truncated: false,
    githubDiagnostic: null,
    projectsDiagnostic: null,
  }
}

function initialState(tab: 'changes' | 'graph' | 'issues' | 'projects', selectedProjectNumber: number | null = null): WorkspaceSessionState['github'] {
  return {
    tab,
    selectedDiffPath: null,
    selectedProjectNumber,
    issueStateFilter: 'OPEN',
    scroll: { changes: 0, graph: 0, issues: 0, projects: 0 },
  }
}

function installBridge(overrides: Partial<Window['vincodeLab']['github']> = {}) {
  const status = gitStatus()
  const board = projectBoard(1, 'Attività iniziale')
  const github = {
    gitStatus: vi.fn(async () => cached(status)),
    initRepository: vi.fn(async () => status),
    addRemote: vi.fn(async () => status),
    createRepository: vi.fn(async () => status),
    stage: vi.fn(async () => status),
    unstage: vi.fn(async () => status),
    commit: vi.fn(async () => status),
    push: vi.fn(async () => status),
    fetch: vi.fn(async () => status),
    pullRebase: vi.fn(async () => status),
    branches: vi.fn(async () => branches()),
    switchBranch: vi.fn(async () => status),
    createBranch: vi.fn(async () => status),
    fileDiff: vi.fn(async () => ''),
    revert: vi.fn(async () => status),
    data: vi.fn(async () => cached(githubData())),
    createIssue: vi.fn(async () => githubData()),
    updateIssue: vi.fn(async () => githubData()),
    projectBoard: vi.fn(async () => cached(board)),
    createProject: vi.fn(async () => [project(1), project(2)]),
    editProject: vi.fn(async () => [project(1), project(2)]),
    closeProject: vi.fn(async () => [project(1), project(2)]),
    addIssueToProject: vi.fn(async () => board),
    updateProjectItem: vi.fn(async () => board),
    projectItemFields: vi.fn(async () => ({})),
    createProjectDraft: vi.fn(async () => board),
    archiveProjectItem: vi.fn(async () => board),
    ...overrides,
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: { github } as unknown as Window['vincodeLab'],
  })
  return github
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0))
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ordinamento richieste del workspace GitHub', () => {
  it('distingue un failure gitStatus dal non-repository e recupera senza inizializzare né aggiornare altre risorse', async () => {
    const gitStatusMock = vi.fn()
      .mockRejectedValueOnce(new Error('fatal: token=segreto /Users/demo/progetto'))
      .mockResolvedValueOnce(cached(gitStatus('recuperato')))
    const github = installBridge({ gitStatus: gitStatusMock })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} workspace="/tmp/github-status-recovery" />)

    expect(await screen.findByRole('heading', { name: 'Stato Git non disponibile' })).toBeVisible()
    expect(screen.getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeVisible()
    expect(screen.queryByText(/token=segreto|\/Users\/demo/u)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nessun repository Git' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inizializza repository' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(screen.getByText('Branch attivo').parentElement).toHaveTextContent('recuperato'))
    expect(gitStatusMock).toHaveBeenCalledTimes(2)
    expect(github.branches).toHaveBeenCalledTimes(1)
    expect(github.data).not.toHaveBeenCalled()
    expect(github.initRepository).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Stato Git non disponibile' })).not.toBeInTheDocument()
  })

  it('mostra la CTA di inizializzazione soltanto per un vero non-repository', async () => {
    const nonRepository = { ...gitStatus(''), isRepository: false }
    const github = installBridge({ gitStatus: vi.fn(async () => cached(nonRepository)) })
    render(<GitHubWorkspace active={false} workspace="/tmp/github-not-repository" />)

    expect(await screen.findByRole('heading', { name: 'Nessun repository Git' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Inizializza repository' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Stato Git non disponibile' })).not.toBeInTheDocument()
    expect(github.initRepository).not.toHaveBeenCalled()
  })

  it('mantiene visibile l ultimo repository valido quando un refresh successivo dello status fallisce', async () => {
    const gitStatusMock = vi.fn()
      .mockResolvedValueOnce(cached(gitStatus('stabile')))
      .mockRejectedValueOnce(new Error('status temporaneamente non disponibile'))
    installBridge({ gitStatus: gitStatusMock })
    render(<GitHubWorkspace active={false} workspace="/tmp/github-status-last-good" />)

    await waitFor(() => expect(screen.getByText('Branch attivo').parentElement).toHaveTextContent('stabile'))
    act(() => dispatchApplicationMenuCommand('github.refresh'))

    expect(await screen.findByRole('heading', { name: 'Stato Git non disponibile' })).toBeVisible()
    expect(screen.getByText('Branch attivo').parentElement).toHaveTextContent('stabile')
    expect(screen.queryByRole('heading', { name: 'Nessun repository Git' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inizializza repository' })).not.toBeInTheDocument()
    expect(gitStatusMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['GITHUB_TOKEN_EXPIRED', 'authentication', 'Accesso GitHub richiesto'],
    ['GITHUB_PERMISSION_DENIED', 'permission', 'Permessi GitHub insufficienti'],
    ['GITHUB_NETWORK_UNAVAILABLE', 'network', 'GitHub non raggiungibile'],
    ['GITHUB_TIMEOUT', 'timeout', 'GitHub non ha risposto in tempo'],
    ['GITHUB_RATE_LIMITED', 'network', 'Limite richieste GitHub raggiunto'],
    ['GITHUB_REPOSITORY_NOT_FOUND', 'not-found', 'Risorsa GitHub non disponibile'],
    ['GIT_CONFLICT', 'conflict', 'Stato Git cambiato nel frattempo'],
    ['GITHUB_API_FAILURE', 'github', 'Stato Git non disponibile'],
  ])('normalizza %s in un messaggio GitHub sicuro e specifico', async (code, category, expectedTitle) => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    installBridge({
      gitStatus: vi.fn(async () => {
        throw {
          category,
          code,
          correlationId: 'ERR-A1B2C3',
          message: `Messaggio pubblico controllato. [${code}] [ERR-A1B2C3]`,
          recoverable: true,
          severity: category === 'conflict' ? 'warning' : 'error',
        }
      }),
    })
    render(<GitHubWorkspace active={false} workspace={`/tmp/github-error-${code.toLowerCase()}`} />)

    expect(await screen.findByRole('heading', { name: expectedTitle })).toBeVisible()
    expect(screen.getByText('Riferimento ERR-A1B2C3')).toBeVisible()
    expect(screen.queryByText('Messaggio pubblico controllato.')).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`Codice: ${code}`, 'u'))).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mostra dettagli' }))
    expect(screen.queryByText('Messaggio pubblico controllato.')).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(`Codice: ${code}`, 'u'))).toBeVisible()
    expect(screen.getByRole(category === 'conflict' ? 'status' : 'alert')).toHaveTextContent('Dettaglio tecnico omesso per proteggere i dati.')
  })

  it('deduplica i failure ripetuti del refresh GitHub e conserva l ultimo elenco issue valido', async () => {
    vi.useFakeTimers()
    const failure = new Error('rete non disponibile [GITHUB_NETWORK_UNAVAILABLE] [ERR-B1C2D3]')
    const dataMock = vi.fn()
      .mockResolvedValueOnce(cached(githubData('Issue conservata')))
      .mockRejectedValue(failure)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    installBridge({ data: dataMock })
    render(<GitHubWorkspace active initialState={initialState('issues')} workspace="/tmp/github-data-dedupe" />)

    await flush()
    expect(screen.getByText('Issue conservata')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('heading', { name: 'GitHub non raggiungibile' })).toBeVisible()
    expect(screen.getByText('Issue conservata')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getAllByRole('heading', { name: 'GitHub non raggiungibile' })).toHaveLength(1)
    expect(screen.getByText('Issue conservata')).toBeInTheDocument()
    expect(dataMock).toHaveBeenCalledTimes(3)
    expect(consoleError.mock.calls.filter(([entry]) => String(entry).includes('"operation":"refresh-github-data"'))).toHaveLength(1)
  })

  it('preserva il messaggio dopo un commit in conflitto e la recovery aggiorna soltanto lo stato', async () => {
    const staged: GitFileStatus[] = [{ path: 'src/app.ts', index: 'M', workingTree: ' ' }]
    const currentStatus = gitStatus('main', staged)
    const gitStatusMock = vi.fn(async () => cached(currentStatus))
    const commit = vi.fn(async () => {
      throw new Error('repository cambiato [GIT_CONFLICT] [ERR-C1D2E3]')
    })
    const github = installBridge({ commit, gitStatus: gitStatusMock })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} workspace="/tmp/github-commit-conflict" />)

    const message = await screen.findByRole('textbox', { name: 'Messaggio del commit' })
    await user.type(message, 'Mantieni questo messaggio')
    await user.click(screen.getByRole('button', { name: 'Crea commit' }))
    await screen.findByText('1 file in staging. Messaggio: Mantieni questo messaggio')
    await user.click(screen.getAllByRole('button', { name: 'Crea commit' }).at(-1)!)

    expect(await screen.findByRole('heading', { name: 'Stato Git cambiato nel frattempo' })).toBeVisible()
    expect(message).toHaveValue('Mantieni questo messaggio')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Riprova commit/iu })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Aggiorna stato Git' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Stato Git cambiato nel frattempo' })).not.toBeInTheDocument())
    expect(message).toHaveValue('Mantieni questo messaggio')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(gitStatusMock).toHaveBeenCalledTimes(2)
    expect(github.branches).toHaveBeenCalledTimes(2)
  })

  it('distingue un branch remoto mancante e non ripete il pull dalla recovery', async () => {
    const remoteStatus = { ...gitStatus(), remote: 'origin', upstream: 'origin/main', behind: 1 }
    const gitStatusMock = vi.fn(async () => cached(remoteStatus))
    const pullRebase = vi.fn(async () => {
      throw new Error('branch remoto assente [GITHUB_BRANCH_NOT_FOUND] [ERR-D1E2F3]')
    })
    installBridge({ gitStatus: gitStatusMock, pullRebase })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} workspace="/tmp/github-pull-not-found" />)

    await user.click(await screen.findByRole('button', { name: 'Integra' }))
    expect(await screen.findByRole('heading', { name: 'Branch remoto non disponibile' })).toBeVisible()
    expect(pullRebase).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Aggiorna stato Git' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Branch remoto non disponibile' })).not.toBeInTheDocument())
    expect(pullRebase).toHaveBeenCalledTimes(1)
    expect(gitStatusMock).toHaveBeenCalledTimes(2)
  })

  it('mantiene il diff precedente e ritenta soltanto la lettura del file fallito', async () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingTree: 'M' },
      { path: 'b.ts', index: ' ', workingTree: 'M' },
    ]
    let failedOnce = false
    const fileDiff = vi.fn(async (filePath: string) => {
      if (filePath === 'a.ts') return 'diff A conservato'
      if (!failedOnce) {
        failedOnce = true
        throw new Error('socket chiuso [GITHUB_NETWORK_UNAVAILABLE] [ERR-E1F2A3]')
      }
      return 'diff B recuperato'
    })
    const github = installBridge({
      fileDiff,
      gitStatus: vi.fn(async () => cached(gitStatus('main', files))),
    })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} workspace="/tmp/github-diff-recovery" />)

    await user.click(await screen.findByRole('button', { name: 'a.ts' }))
    expect(await screen.findByText('diff A conservato')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'b.ts' }))

    expect(await screen.findByRole('heading', { name: 'GitHub non raggiungibile' })).toBeVisible()
    expect(screen.getByText('diff A conservato')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Riprova diff' }))

    expect(await screen.findByText('diff B recuperato')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'GitHub non raggiungibile' })).not.toBeInTheDocument()
    expect(fileDiff.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'b.ts'])
    expect(github.stage).not.toHaveBeenCalled()
    expect(github.unstage).not.toHaveBeenCalled()
    expect(github.commit).not.toHaveBeenCalled()
  })

  it('preserva il modulo issue e usa una recovery di sola lettura dopo un failure di permission', async () => {
    const dataMock = vi.fn(async () => cached(githubData('Issue già presente')))
    const createIssue = vi.fn(async () => {
      throw new Error('token=segreto [GITHUB_PERMISSION_DENIED] [ERR-F1A2B3]')
    })
    installBridge({ createIssue, data: dataMock })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} initialState={initialState('issues')} workspace="/tmp/github-issue-form" />)

    await user.click(await screen.findByRole('button', { name: 'Nuova issue' }))
    const title = screen.getByRole('textbox', { name: 'Titolo' })
    const body = screen.getByRole('textbox', { name: 'Descrizione' })
    await user.type(title, 'Titolo conservato')
    await user.type(body, 'Descrizione conservata')
    await user.click(screen.getByRole('button', { name: 'Crea issue' }))

    expect(await screen.findByRole('heading', { name: 'Permessi GitHub insufficienti' })).toBeVisible()
    expect(title).toHaveValue('Titolo conservato')
    expect(body).toHaveValue('Descrizione conservata')
    expect(screen.queryByText(/token=segreto/u)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Aggiorna issue' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Permessi GitHub insufficienti' })).not.toBeInTheDocument())
    expect(title).toHaveValue('Titolo conservato')
    expect(body).toHaveValue('Descrizione conservata')
    expect(createIssue).toHaveBeenCalledTimes(1)
    expect(dataMock).toHaveBeenCalledTimes(2)
  })

  it('mantiene la board valida dopo un timeout e ricarica soltanto la board selezionata', async () => {
    const boardMock = vi.fn()
      .mockResolvedValueOnce(cached(projectBoard(1, 'Attività conservata')))
      .mockRejectedValueOnce(new Error('timeout provider [GITHUB_TIMEOUT] [ERR-A2B3C4]'))
      .mockResolvedValueOnce(cached(projectBoard(1, 'Attività recuperata')))
    const github = installBridge({ projectBoard: boardMock })
    const user = userEvent.setup()
    render(<GitHubWorkspace active={false} initialState={initialState('projects', 1)} workspace="/tmp/github-board-recovery" />)

    expect(await screen.findByText('Attività conservata')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Aggiorna' }))
    expect(await screen.findByRole('heading', { name: 'GitHub non ha risposto in tempo' })).toBeVisible()
    expect(screen.getByText('Attività conservata')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Ricarica board' }))
    expect(await screen.findByText('Attività recuperata')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'GitHub non ha risposto in tempo' })).not.toBeInTheDocument()
    expect(boardMock).toHaveBeenCalledTimes(3)
    expect(github.updateProjectItem).not.toHaveBeenCalled()
    expect(github.archiveProjectItem).not.toHaveBeenCalled()
  })

  it('ignora status e branch di un refresh Git completato fuori ordine', async () => {
    const firstStatus = deferred<CachedResult<GitStatus>>()
    const firstBranches = deferred<GitBranchPage>()
    const secondStatus = deferred<CachedResult<GitStatus>>()
    const secondBranches = deferred<GitBranchPage>()
    const gitStatusMock = vi.fn()
      .mockReturnValueOnce(firstStatus.promise)
      .mockReturnValueOnce(secondStatus.promise)
    const branchesMock = vi.fn()
      .mockReturnValueOnce(firstBranches.promise)
      .mockReturnValueOnce(secondBranches.promise)
    installBridge({ gitStatus: gitStatusMock, branches: branchesMock })
    render(<GitHubWorkspace active workspace="/tmp/github-race-git" />)

    await waitFor(() => expect(gitStatusMock).toHaveBeenCalledTimes(1))
    act(() => dispatchApplicationMenuCommand('github.refresh'))
    await waitFor(() => expect(gitStatusMock).toHaveBeenCalledTimes(2))

    secondStatus.resolve(cached(gitStatus('nuovo')))
    secondBranches.resolve(branches('nuovo'))
    await waitFor(() => expect(screen.getByText('Branch attivo').parentElement).toHaveTextContent('nuovo'))

    firstStatus.resolve(cached(gitStatus('vecchio')))
    firstBranches.resolve(branches('vecchio'))
    await flush()
    expect(screen.getByText('Branch attivo').parentElement).toHaveTextContent('nuovo')
    expect(screen.queryByText(/Branch attivo vecchio/)).not.toBeInTheDocument()
  })

  it('ignora dati GitHub obsoleti senza chiudere il busy della richiesta più recente', async () => {
    const firstData = deferred<CachedResult<GitHubData>>()
    const secondData = deferred<CachedResult<GitHubData>>()
    const dataMock = vi.fn()
      .mockReturnValueOnce(firstData.promise)
      .mockReturnValueOnce(secondData.promise)
    installBridge({ data: dataMock })
    render(<GitHubWorkspace active initialState={initialState('issues')} workspace="/tmp/github-race-data" />)

    await waitFor(() => expect(dataMock).toHaveBeenCalledTimes(1))
    act(() => dispatchApplicationMenuCommand('github.refresh'))
    await waitFor(() => expect(dataMock).toHaveBeenCalledTimes(2))

    secondData.resolve(cached(githubData('Issue recente')))
    expect(await screen.findByText('Issue recente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aggiorna' })).toBeDisabled()

    firstData.resolve(cached(githubData('Issue obsoleta')))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aggiorna' })).toBeEnabled())
    expect(screen.getByText('Issue recente')).toBeInTheDocument()
    expect(screen.queryByText('Issue obsoleta')).not.toBeInTheDocument()
  })

  it('mantiene il diff B quando il diff A termina dopo', async () => {
    const firstDiff = deferred<string>()
    const secondDiff = deferred<string>()
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingTree: 'M' },
      { path: 'b.ts', index: ' ', workingTree: 'M' },
    ]
    const fileDiff = vi.fn((filePath: string) => filePath === 'a.ts' ? firstDiff.promise : secondDiff.promise)
    installBridge({
      gitStatus: vi.fn(async () => cached(gitStatus('main', files))),
      fileDiff,
    })
    const firstRequest: GitHubWorkbenchRequest = { kind: 'open-file-diff', filePath: 'a.ts', nonce: 1 }
    const view = render(<GitHubWorkspace active workspace="/tmp/github-race-diff" workbenchRequest={firstRequest} />)

    await waitFor(() => expect(fileDiff).toHaveBeenCalledWith('a.ts'))
    view.rerender(<GitHubWorkspace active workspace="/tmp/github-race-diff" workbenchRequest={{ kind: 'open-file-diff', filePath: 'b.ts', nonce: 2 }} />)
    await waitFor(() => expect(fileDiff).toHaveBeenCalledWith('b.ts'))

    secondDiff.resolve('contenuto diff B')
    const diffContent = await screen.findByText('contenuto diff B')
    expect(diffContent.closest('section')).toHaveTextContent('b.ts')

    firstDiff.resolve('contenuto diff A')
    await flush()
    expect(screen.getByText('contenuto diff B')).toBeInTheDocument()
    expect(screen.queryByText('contenuto diff A')).not.toBeInTheDocument()
    expect(screen.getByText('contenuto diff B').closest('section')).toHaveTextContent('b.ts')
  })

  it('non lascia che la board A sovrascriva la selezione B', async () => {
    const staleBoard = deferred<CachedResult<GitHubProjectBoard>>()
    const currentBoard = deferred<CachedResult<GitHubProjectBoard>>()
    const projectBoardMock = vi.fn()
      .mockResolvedValueOnce(cached(projectBoard(1, 'Attività iniziale')))
      .mockReturnValueOnce(staleBoard.promise)
      .mockReturnValueOnce(currentBoard.promise)
    installBridge({ projectBoard: projectBoardMock })
    const user = userEvent.setup()
    render(<GitHubWorkspace active initialState={initialState('projects', 1)} workspace="/tmp/github-race-board" />)

    expect(await screen.findByRole('heading', { name: 'Project 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aggiorna' }))
    await waitFor(() => expect(projectBoardMock).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('option', { name: /Project 2/ }))
    await waitFor(() => expect(projectBoardMock).toHaveBeenLastCalledWith(2))

    currentBoard.resolve(cached(projectBoard(2, 'Attività B')))
    expect(await screen.findByRole('heading', { name: 'Project 2' })).toBeInTheDocument()
    expect(screen.getByText('Attività B')).toBeInTheDocument()

    staleBoard.resolve(cached(projectBoard(1, 'Attività A obsoleta')))
    await flush()
    expect(screen.getByRole('heading', { name: 'Project 2' })).toBeInTheDocument()
    expect(screen.getByText('Attività B')).toBeInTheDocument()
    expect(screen.queryByText('Attività A obsoleta')).not.toBeInTheDocument()
  })

  it('scarta i campi dell attività A dopo la selezione dell attività B', async () => {
    const firstFields = deferred<Record<string, string>>()
    const secondFields = deferred<Record<string, string>>()
    const board: GitHubProjectBoard = {
      project: project(1),
      fields: [{ id: 'note', name: 'Note', dataType: 'text' }],
      fieldsHasMore: false,
      fieldsTruncated: false,
      fieldOptionsTruncated: false,
      fieldsResultBytes: 2,
      items: [
        { id: 'item-a', type: 'ISSUE', title: 'Attività A', content: { title: 'Attività A', number: 1 } },
        { id: 'item-b', type: 'ISSUE', title: 'Attività B', content: { title: 'Attività B', number: 2 } },
      ],
      itemsHasMore: false,
      itemsTruncated: false,
      itemValuesTruncated: false,
      itemsResultBytes: 2,
      hasMore: false,
      truncated: false,
    }
    const projectItemFields = vi.fn((_projectNumber: number, itemId: string) => itemId === 'item-a' ? firstFields.promise : secondFields.promise)
    installBridge({
      projectBoard: vi.fn(async () => cached(board)),
      projectItemFields,
    })
    const user = userEvent.setup()
    render(<GitHubWorkspace active initialState={initialState('projects', 1)} workspace="/tmp/github-race-fields" />)

    await screen.findByRole('heading', { name: 'Project 1' })
    const secondItem = screen.getByRole('button', { name: /Attività B/ })
    await user.click(screen.getByRole('button', { name: /Attività A/ }))
    await waitFor(() => expect(projectItemFields).toHaveBeenCalledWith(1, 'item-a'))
    fireEvent.click(secondItem)
    await waitFor(() => expect(projectItemFields).toHaveBeenCalledWith(1, 'item-b'))

    secondFields.resolve({ note: 'valore B' })
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('valore B'))
    firstFields.resolve({ note: 'valore A obsoleto' })
    await flush()
    expect(screen.getByLabelText('Note')).toHaveValue('valore B')
  })

  it('segnala i file e branch parziali e limita lo staging di gruppo ai file visibili', async () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingTree: 'M' },
      { path: 'b.ts', index: '?', workingTree: '?' },
    ]
    const limitedStatus: GitStatus = {
      ...gitStatus('main', files),
      filesHasMore: true,
      filesTruncated: true,
      hasMore: true,
      truncated: true,
    }
    const stage = vi.fn(async () => limitedStatus)
    installBridge({
      gitStatus: vi.fn(async () => cached(limitedStatus)),
      branches: vi.fn(async () => ({ ...branches(), hasMore: true, truncated: true })),
      stage,
    })
    const user = userEvent.setup()
    render(<GitHubWorkspace active workspace="/tmp/github-limited-files" />)

    expect(await screen.findByText(/Elenco modifiche limitato a 2 file visibili/)).toBeInTheDocument()
    expect(screen.getByText(/Elenco branch limitato ai primi 1 risultati/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aggiungi i 2 file visibili consentiti' }))
    expect(stage).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('comunica limiti di issue, contenuto, etichette, Project, campi e attività', async () => {
    const limitedData: GitHubData = {
      ...githubData('Issue limitata'),
      issues: [{ ...githubData('Issue limitata').issues[0], body: 'Estratto', bodyTruncated: true, labels: [{ name: 'bug' }], labelsHasMore: true }],
      issuesHasMore: true,
      issuesTruncated: true,
      projectsHasMore: true,
      projectsTruncated: true,
      hasMore: true,
      truncated: true,
    }
    const limitedBoard: GitHubProjectBoard = {
      ...projectBoard(1, 'Attività limitata'),
      fieldsHasMore: true,
      fieldsTruncated: true,
      fieldOptionsTruncated: true,
      itemsHasMore: true,
      itemsTruncated: true,
      itemValuesTruncated: true,
      hasMore: true,
      truncated: true,
    }
    installBridge({
      data: vi.fn(async () => cached(limitedData)),
      projectBoard: vi.fn(async () => cached(limitedBoard)),
    })
    const user = userEvent.setup()
    const view = render(<GitHubWorkspace active initialState={initialState('issues')} workspace="/tmp/github-limited-remote" />)

    expect(await screen.findByText(/Elenco issue limitato alle prime 1 attività/)).toBeInTheDocument()
    expect(screen.getByText('altre etichette…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Issue limitata/ }))
    expect(await screen.findByText(/Descrizione abbreviata/)).toBeInTheDocument()
    expect(screen.getByText(/Etichette limitate/)).toBeInTheDocument()

    view.unmount()
    render(<GitHubWorkspace active initialState={initialState('projects', 1)} workspace="/tmp/github-limited-remote" />)
    expect(await screen.findByText(/Elenco Project limitato ai primi 2 risultati/)).toBeInTheDocument()
    expect(await screen.findByText(/Sono mostrati solo i primi campi disponibili/)).toHaveTextContent('Alcune opzioni dei campi sono state abbreviate')
    expect(screen.getByText(/Sono mostrate solo le prime attività disponibili/)).toHaveTextContent('Alcuni valori delle attività sono stati abbreviati')
  })

  it('non installa né esegue il polling automatico mentre la vista è nascosta', async () => {
    vi.useFakeTimers()
    const gitStatusMock = vi.fn(async () => cached(gitStatus()))
    installBridge({ gitStatus: gitStatusMock })
    const view = render(<GitHubWorkspace active={false} workspace="/tmp/github-hidden-poll" />)
    await flush()
    expect(gitStatusMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })
    expect(gitStatusMock).toHaveBeenCalledTimes(1)

    view.rerender(<GitHubWorkspace active workspace="/tmp/github-hidden-poll" />)
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    expect(gitStatusMock).toHaveBeenCalledTimes(2)

    view.rerender(<GitHubWorkspace active={false} workspace="/tmp/github-hidden-poll" />)
    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })
    expect(gitStatusMock).toHaveBeenCalledTimes(2)
  })
})
