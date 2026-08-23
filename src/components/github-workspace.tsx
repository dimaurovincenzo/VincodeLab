import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, Check, ChevronRight, CircleDot, CloudDownload, CloudUpload, FileDiff, FolderKanban, GitBranch, GitCommitHorizontal, GitFork, Minus, Plus, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { Button, Collapsible, createListCollection, Dialog, ErrorNotice, Field, IconButton, Listbox, SelectField, Spinner, Splitter, Tabs, toast, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { EmptyState } from '@/components/empty-state'
import { MarkdownPreview } from '@/components/markdown-preview'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { layoutGitGraph } from '@/lib/git-graph'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { githubProjectStatusTone } from '@/lib/github-project-status.js'
import { gitGraphNodeStyles, gitGraphPathStyles, githubProjectStatus, githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../styled-system/css'

type GitHubTab = 'changes' | 'graph' | 'issues' | 'projects'
export type GitHubWorkbenchRequest =
  | { kind: 'focus-primary'; nonce: number }
  | { kind: 'open-file-diff'; filePath: string; nonce: number }
export type GitHubWorkbenchContext = {
  tab: GitHubTab
  branch: string | null
  changedFiles: string[]
  selectedDiffPath: string | null
}
type Props = {
  active: boolean
  workspace: string
  initialState?: WorkspaceSessionState['github']
  workbenchRequest?: GitHubWorkbenchRequest | null
  onContextChange?: (context: GitHubWorkbenchContext) => void
  onOpenFile?: (filePath: string) => void
  onSessionChange?: (state: Pick<WorkspaceSessionState['github'], 'tab' | 'selectedDiffPath' | 'selectedProjectNumber' | 'issueStateFilter'>) => void
}

type RefreshOutcome = { accepted: boolean; stale: boolean; error?: unknown }
type GitHubErrorSurface = 'branches' | 'git-changes' | 'git-commit' | 'git-remote' | 'diff' | 'github-data' | 'github-diagnostic' | 'issues' | 'projects' | 'projects-diagnostic' | 'board' | 'project-fields'
type GitHubErrorContext = {
  action: string
  notFoundTitle?: string
  operation: string
  preserved?: string
  recovery: string
  title: string
}

const GIT_GRAPH_LANE_COUNT = 6
const GIT_GRAPH_ROW_HEIGHT = 40
const githubProjectPanels: SplitterPanelData[] = [
  { id: 'github-project-picker', minSize: '280px', maxSize: '720px', collapsible: true, collapsedSize: '240px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'github-project-board', minSize: '560px' },
]

function gitGraphPathClass(lane: number) {
  return gitGraphPathStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function gitGraphNodeClass(lane: number) {
  return gitGraphNodeStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function contextualGitHubError(error: unknown, context: GitHubErrorContext) {
  const classified = normalizeUserError(error, {
    component: 'github-workspace',
    operation: context.operation,
  })
  const preserved = context.preserved ? ` ${context.preserved}` : ''
  const rateLimited = classified.category === 'network' && (/RATE.?LIMIT|TOO_MANY_REQUESTS/u.test(classified.code ?? '') || /limitando|rate.?limit|429/iu.test(classified.technicalMessage))
  const copy = rateLimited
    ? { title: 'Limite richieste GitHub raggiunto', description: `${context.action} non è stata completata. Attendi qualche minuto, poi ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
    : classified.category === 'authentication'
      ? { title: 'Accesso GitHub richiesto', description: `${context.action} non è stata completata. Accedi di nuovo a GitHub, poi ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
      : classified.category === 'permission'
        ? { title: 'Permessi GitHub insufficienti', description: `${context.action} non è stata autorizzata. Verifica i permessi del repository o gli scope del token.${preserved}` }
        : classified.category === 'network'
          ? { title: 'GitHub non raggiungibile', description: `${context.action} non è stata completata. Controlla la connessione e ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
          : classified.category === 'timeout'
            ? { title: 'GitHub non ha risposto in tempo', description: `${context.action} non è stata completata entro il tempo disponibile. ${context.recovery}.${preserved}` }
            : classified.category === 'not-found'
              ? { title: context.notFoundTitle ?? 'Risorsa GitHub non disponibile', description: `${context.action} non è stata completata perché la risorsa non è più disponibile. Aggiorna i dati prima di continuare.${preserved}` }
              : classified.category === 'conflict'
                ? { title: 'Stato Git cambiato nel frattempo', description: `${context.action} non è stata completata perché il repository è cambiato. Aggiorna lo stato prima di decidere come continuare.${preserved}` }
                : { title: context.title, description: `${context.action} non è stata completata. ${context.recovery}.${preserved}` }

  return normalizeUserError(error, {
    category: classified.category,
    code: classified.code,
    component: 'github-workspace',
    correlationId: classified.correlationId,
    description: copy.description,
    operation: context.operation,
    severity: classified.severity,
    title: copy.title,
  })
}

function sameUserError(left: UserError | undefined, right: UserError) {
  return Boolean(left
    && left.category === right.category
    && left.code === right.code
    && left.operation === right.operation
    && left.title === right.title)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(value))
}

function formatCacheState(cache: CacheMetadata | null) {
  if (!cache) return null
  if (cache.stale) return 'Dati non aggiornati'
  const minutes = Math.max(0, Math.floor((Date.now() - cache.fetchedAt) / 60_000))
  return minutes === 0 ? 'Aggiornato ora' : `Aggiornato ${minutes} min fa`
}

function LimitNotice({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(gh.limitNotice, className)} role="status"><TriangleAlert aria-hidden="true" size={14} /><span>{children}</span></p>
}

function GitHubErrorNotice({ error, label, onClick }: { error?: UserError; label: string; onClick: () => void | Promise<void> }) {
  return error ? <ErrorNotice action={{ label, onClick }} error={error} /> : null
}

function matchesIssueSearch(issue: GitHubIssue, query: string) {
  const normalized = query.trim().toLocaleLowerCase('it-IT')
  const numeric = normalized.match(/^#?(\d+)$/)?.[1]
  if (numeric) return issue.number === Number(numeric)
  return !normalized || [issue.title, issue.body ?? '', ...issue.labels.map((label) => label.name)]
    .some((value) => value.toLocaleLowerCase('it-IT').includes(normalized))
}

function matchesProjectItemSearch(item: GitHubProjectItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase('it-IT')
  const numeric = normalized.match(/^#?(\d+)$/)?.[1]
  if (numeric) return item.content?.number === Number(numeric)
  const searchableValues = [
    item.content?.title ?? item.title ?? '',
    item.status ?? '',
    ...(item.assignees ?? []),
    ...Object.values(item.fieldValues ?? {}),
  ]
  return !normalized || searchableValues.some((value) => String(value).toLocaleLowerCase('it-IT').includes(normalized))
}

function projectFieldDataType(field: GitHubProjectField) {
  return typeof field.dataType === 'string' ? field.dataType.toLowerCase() : ''
}

function projectFieldName(field: GitHubProjectField) {
  return typeof field.name === 'string' ? field.name.toLocaleLowerCase('it-IT') : ''
}

function projectStatusClass(status: unknown) {
  return githubProjectStatus({ tone: githubProjectStatusTone(status) })
}

function projectIssueKey(item: GitHubProjectItem) {
  const number = item.content?.number
  return Number.isInteger(number) ? `${item.content?.repository ?? ''}#${number}` : ''
}

function orderProjectItemsByHierarchy(items: GitHubProjectItem[]) {
  const itemKeys = new Set(items.map(projectIssueKey).filter(Boolean))
  const childrenByParent = new Map<string, GitHubProjectItem[]>()
  const roots: GitHubProjectItem[] = []
  for (const item of items) {
    const parentKey = item.parent ? `${item.parent.repository ?? item.content?.repository ?? ''}#${item.parent.number}` : ''
    if (parentKey && itemKeys.has(parentKey)) childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), item])
    else roots.push(item)
  }
  const ordered: Array<{ item: GitHubProjectItem; depth: number }> = []
  const visited = new Set<string>()
  const visit = (item: GitHubProjectItem, depth: number) => {
    if (visited.has(item.id)) return
    visited.add(item.id)
    ordered.push({ item, depth })
    for (const child of childrenByParent.get(projectIssueKey(item)) ?? []) visit(child, depth + 1)
  }
  for (const item of roots) visit(item, 0)
  for (const item of items) visit(item, 0)
  return ordered
}

export function GitHubWorkspace({ active, workspace, initialState, workbenchRequest = null, onContextChange, onOpenFile, onSessionChange }: Props) {
  const { preferences } = useAppPreferences()
  const autoRefreshSeconds = effectivePreference(preferences, 'git.autoRefreshSeconds', 60)
  const historyLimit = effectivePreference(preferences, 'git.historyLimit', 100)
  const projectSelectorWidth = effectivePreference(preferences, 'git.projectSelectorWidth', 360)
  const confirmRemoteActions = effectivePreference(preferences, 'git.confirmRemoteActions', true)
  const [tab, setTab] = useState<GitHubTab>(() => initialState?.tab ?? 'changes')
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [data, setData] = useState<GitHubData | null>(null)
  const [gitCache, setGitCache] = useState<CacheMetadata | null>(null)
  const [githubCache, setGitHubCache] = useState<CacheMetadata | null>(null)
  const [boardCache, setBoardCache] = useState<CacheMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const gitStatusErrorRef = useRef<UserError | null>(null)
  const [gitStatusError, setGitStatusError] = useState<UserError | null>(null)
  const [busyCount, setBusyCount] = useState(0)
  const busy = busyCount > 0
  const surfaceErrorsRef = useRef<Partial<Record<GitHubErrorSurface, UserError>>>({})
  const [surfaceErrors, setSurfaceErrors] = useState<Partial<Record<GitHubErrorSurface, UserError>>>({})
  const [commitMessage, setCommitMessage] = useState('')
  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [issueSearch, setIssueSearch] = useState('')
  const [issueStateFilter, setIssueStateFilter] = useState<'all' | 'OPEN' | 'CLOSED'>(() => initialState?.issueStateFilter ?? 'OPEN')
  const [issueComposerOpen, setIssueComposerOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)
  const [issueDetailOpen, setIssueDetailOpen] = useState(false)
  const [branchPage, setBranchPage] = useState<GitBranchPage>({ branches: [], hasMore: false, truncated: false })
  const [branchName, setBranchName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [githubRepositoryName, setGitHubRepositoryName] = useState('')
  const [githubRepositoryVisibility, setGitHubRepositoryVisibility] = useState<'private' | 'public'>('private')
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; content: string } | null>(null)
  const [boardSearch, setBoardSearch] = useState('')
  const [boardStatusFilter, setBoardStatusFilter] = useState('')
  const [boardGroupFieldId, setBoardGroupFieldId] = useState('')
  const [collapsedBoardGroups, setCollapsedBoardGroups] = useState<Set<string>>(new Set())
  const [projectPickerCollapsed, setProjectPickerCollapsed] = useState(false)
  const [selectedBoardItemId, setSelectedBoardItemId] = useState<string | null>(null)
  const [boardItemDialogOpen, setBoardItemDialogOpen] = useState(false)
  const [projectFieldDrafts, setProjectFieldDrafts] = useState<Record<string, string>>({})
  const [projectFieldValues, setProjectFieldValues] = useState<Record<string, string>>({})
  const [loadingProjectFields, setLoadingProjectFields] = useState(false)
  const [loadingBoard, setLoadingBoard] = useState(false)
  const issueComposerTrigger = useRef<HTMLButtonElement>(null)
  const issueTitleInput = useRef<HTMLInputElement>(null)
  const issueDetailTrigger = useRef<HTMLButtonElement>(null)
  const boardItemDialogTrigger = useRef<HTMLButtonElement>(null)
  const boardSearchInput = useRef<HTMLInputElement>(null)
  const changesPrimary = useRef<HTMLDivElement>(null)
  const diffRegion = useRef<HTMLElement>(null)
  const diffOpener = useRef<HTMLButtonElement>(null)
  const gitRequest = useRef(0)
  const githubDataRequest = useRef(0)
  const boardRequest = useRef(0)
  const diffRequest = useRef(0)
  const failedDiffFile = useRef<GitFileStatus | null>(null)
  const projectFieldRequest = useRef(0)
  const activeRef = useRef(active)
  useLayoutEffect(() => { activeRef.current = active }, [active])
  const refreshGitRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined)
  const refreshGitHubRef = useRef<(force?: boolean, includeBoard?: boolean) => Promise<void>>(async () => undefined)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [board, setBoard] = useState<GitHubProjectBoard | null>(null)
  const [selectedProject, setSelectedProject] = useState<number | null>(() => initialState?.selectedProjectNumber ?? null)
  const selectedProjectRef = useRef(selectedProject)
  const [projectTitle, setProjectTitle] = useState('')
  const [editingProject, setEditingProject] = useState<GitHubProject | null>(null)
  const [projectEditTitle, setProjectEditTitle] = useState('')
  const [projectEditDescription, setProjectEditDescription] = useState('')
  const projectCollection = useMemo(() => createListCollection({
    items: data?.projects ?? [],
    isItemDisabled: () => busy,
    itemToString: (project) => project.title,
    itemToValue: (project) => String(project.number),
  }), [busy, data?.projects])

  const beginBusy = useCallback(() => setBusyCount((current) => current + 1), [])
  const endBusy = useCallback(() => setBusyCount((current) => Math.max(0, current - 1)), [])

  const clearSurfaceError = useCallback((surface: GitHubErrorSurface) => {
    if (!surfaceErrorsRef.current[surface]) return
    const next = { ...surfaceErrorsRef.current }
    delete next[surface]
    surfaceErrorsRef.current = next
    setSurfaceErrors(next)
  }, [])

  const publishSurfaceError = useCallback((surface: GitHubErrorSurface, cause: unknown, context: GitHubErrorContext) => {
    const normalized = contextualGitHubError(cause, context)
    if (sameUserError(surfaceErrorsRef.current[surface], normalized)) return surfaceErrorsRef.current[surface]!
    const incident = reportUserError(normalized)
    const next = { ...surfaceErrorsRef.current, [surface]: incident }
    surfaceErrorsRef.current = next
    setSurfaceErrors(next)
    return incident
  }, [])

  const clearGitStatusError = useCallback(() => {
    gitStatusErrorRef.current = null
    setGitStatusError(null)
  }, [])

  const publishGitStatusError = useCallback((cause: unknown) => {
    const normalized = contextualGitHubError(cause, {
      action: 'La lettura dello stato Git',
      operation: 'refresh-git-status',
      recovery: 'Riprova',
      title: 'Stato Git non disponibile',
    })
    if (sameUserError(gitStatusErrorRef.current ?? undefined, normalized)) return gitStatusErrorRef.current!
    const incident = reportUserError(normalized)
    gitStatusErrorRef.current = incident
    setGitStatusError(incident)
    return incident
  }, [])

  const refreshGit = useCallback(async (force = false) => {
    const requestId = ++gitRequest.current
    if (!force) setLoading(true)
    const branchesRefresh = window.vincodeLab.github.branches().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ error, ok: false as const }),
    )
    try {
      const nextStatus = await window.vincodeLab.github.gitStatus({ force })
      if (requestId !== gitRequest.current) return
      setStatus(nextStatus.data)
      setGitCache(nextStatus.cache)
      clearGitStatusError()
      if (nextStatus.data.isRepository) {
        const branchesOutcome = await branchesRefresh
        if (requestId !== gitRequest.current) return
        if (branchesOutcome.ok) {
          setBranchPage(branchesOutcome.value)
          clearSurfaceError('branches')
        } else {
          publishSurfaceError('branches', branchesOutcome.error, {
            action: 'La lettura dei branch',
            notFoundTitle: 'Branch del repository non disponibili',
            operation: 'refresh-git-branches',
            recovery: 'Aggiorna lo stato Git',
            title: 'Branch Git non disponibili',
          })
        }
      }
      if (nextStatus.cache.stale && !force) void refreshGitRef.current(true)
    } catch (nextError) {
      if (requestId === gitRequest.current) publishGitStatusError(nextError)
    } finally {
      if (requestId === gitRequest.current) setLoading(false)
    }
  }, [clearGitStatusError, clearSurfaceError, publishGitStatusError, publishSurfaceError])
  useEffect(() => { refreshGitRef.current = refreshGit }, [refreshGit])

  const retryGitStatus = useCallback(async () => {
    const requestId = ++gitRequest.current
    clearGitStatusError()
    try {
      const nextStatus = await window.vincodeLab.github.gitStatus({ force: true })
      if (requestId !== gitRequest.current) return
      setStatus(nextStatus.data)
      setGitCache(nextStatus.cache)
      clearGitStatusError()
      setLoading(false)
    } catch (cause) {
      if (requestId === gitRequest.current) publishGitStatusError(cause)
    }
  }, [clearGitStatusError, publishGitStatusError])

  const refreshGitHub = useCallback(async (force = false, includeBoard = true) => {
    const dataRequestId = ++githubDataRequest.current
    const projectNumber = includeBoard ? selectedProjectRef.current : null
    const boardRequestId = includeBoard ? ++boardRequest.current : boardRequest.current
    if (!force) beginBusy()
    if (projectNumber) setLoadingBoard(true)
    try {
      const dataRefresh = window.vincodeLab.github.data({ force }).then<RefreshOutcome, RefreshOutcome>((nextData) => {
        if (dataRequestId !== githubDataRequest.current) return { accepted: false, stale: false }
        setData(nextData.data)
        setGitHubCache(nextData.cache)
        if (nextData.data.githubDiagnostic) publishSurfaceError('github-diagnostic', nextData.data.githubDiagnostic, {
          action: 'L’accesso ai dati del repository',
          notFoundTitle: 'Repository GitHub non collegato',
          operation: 'read-github-diagnostic',
          recovery: 'Controlla accesso, repository e connessione, poi aggiorna i dati',
          title: 'GitHub non disponibile per il workspace',
        })
        else clearSurfaceError('github-diagnostic')
        if (nextData.data.projectsDiagnostic) publishSurfaceError('projects-diagnostic', nextData.data.projectsDiagnostic, {
          action: 'La lettura dei GitHub Projects',
          operation: 'read-github-projects-diagnostic',
          recovery: 'Autorizza lo scope Projects e aggiorna i dati',
          title: 'GitHub Projects non disponibili',
        })
        else clearSurfaceError('projects-diagnostic')
        return { accepted: true, stale: nextData.cache.stale }
      }, (error) => dataRequestId === githubDataRequest.current
        ? { accepted: true, stale: false, error }
        : { accepted: false, stale: false })
      const boardRefresh = projectNumber
        ? window.vincodeLab.github.projectBoard(projectNumber, { force }).then<RefreshOutcome, RefreshOutcome>((nextBoard) => {
          if (boardRequestId !== boardRequest.current || selectedProjectRef.current !== projectNumber) return { accepted: false, stale: false }
          setBoard(nextBoard.data)
          setBoardCache(nextBoard.cache)
          return { accepted: true, stale: nextBoard.cache.stale }
        }, (error) => boardRequestId === boardRequest.current && selectedProjectRef.current === projectNumber
          ? { accepted: true, stale: false, error }
          : { accepted: false, stale: false })
        : Promise.resolve<RefreshOutcome>({ accepted: false, stale: false })
      const outcomes = await Promise.all([dataRefresh, boardRefresh])
      const [dataOutcome, boardOutcome] = outcomes
      if (dataOutcome.accepted) {
        if (dataOutcome.error) publishSurfaceError('github-data', dataOutcome.error, {
          action: 'L’aggiornamento di issue e Projects',
          notFoundTitle: 'Repository GitHub non disponibile',
          operation: 'refresh-github-data',
          preserved: 'Gli eventuali dati già caricati restano visibili.',
          recovery: 'Riprova l’aggiornamento',
          title: 'Dati GitHub non disponibili',
        })
        else clearSurfaceError('github-data')
      }
      if (boardOutcome.accepted) {
        if (boardOutcome.error) publishSurfaceError('board', boardOutcome.error, {
          action: 'L’aggiornamento del Project',
          notFoundTitle: 'Project GitHub non disponibile',
          operation: 'refresh-github-project-board',
          preserved: 'L’eventuale board già caricata resta visibile.',
          recovery: 'Riprova l’aggiornamento',
          title: 'Board del Project non disponibile',
        })
        else clearSurfaceError('board')
      }
      if (!force && outcomes.some((outcome) => outcome.accepted && outcome.stale)) void refreshGitHubRef.current(true, includeBoard)
    } finally {
      if (includeBoard && boardRequestId === boardRequest.current) setLoadingBoard(false)
      if (!force) endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, publishSurfaceError])
  useEffect(() => { refreshGitHubRef.current = refreshGitHub }, [refreshGitHub])

  useEffect(() => {
    if (!active || autoRefreshSeconds <= 0) return
    const timer = window.setInterval(() => {
      if (!activeRef.current) return
      if (tab === 'changes' || tab === 'graph') void refreshGitRef.current(true)
      else void refreshGitHubRef.current(true)
    }, autoRefreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [active, autoRefreshSeconds, tab])

  useEffect(() => {
    // Rimanda al microtask: l'effetto registra soltanto il caricamento iniziale, non forza un render sincrono.
    void Promise.resolve().then(() => refreshGit())
  }, [refreshGit])
  useEffect(() => {
    if ((tab === 'issues' || tab === 'projects') && !data) void Promise.resolve().then(() => refreshGitHub())
  }, [data, refreshGitHub, tab])

  const mutateGit = useCallback(async (operation: () => Promise<GitStatus>, success: string, surface: GitHubErrorSurface, context: GitHubErrorContext) => {
    beginBusy()
    try {
      const nextStatus = await operation()
      gitRequest.current += 1
      setStatus(nextStatus)
      setLoading(false)
      clearSurfaceError(surface)
      toast.success(success)
    } catch (nextError) {
      publishSurfaceError(surface, nextError, context)
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, publishSurfaceError])

  const confirmGit = (message: string, operation: () => Promise<GitStatus>, success: string, surface: GitHubErrorSurface, context: GitHubErrorContext) => {
    if (!confirmRemoteActions) {
      void mutateGit(operation, success, surface, context)
      return
    }
    setConfirmation({ title: success, detail: message, confirmLabel: 'Conferma', onConfirm: () => void mutateGit(operation, success, surface, context) })
  }

  const initializeRepositoryConfirmed = async () => {
    beginBusy()
    try {
      const nextStatus = await window.vincodeLab.github.initRepository()
      gitRequest.current += 1
      setStatus(nextStatus)
      setLoading(false)
      clearSurfaceError('git-changes')
      toast.success('Repository Git inizializzato')
      try {
        const nextBranches = await window.vincodeLab.github.branches()
        setBranchPage(nextBranches)
        clearSurfaceError('branches')
      } catch (branchError) {
        publishSurfaceError('branches', branchError, {
          action: 'L’aggiornamento dei branch dopo l’inizializzazione',
          operation: 'refresh-git-branches-after-initialize',
          recovery: 'Aggiorna branch e stato Git',
          title: 'Repository inizializzato, branch non aggiornati',
        })
      }
    } catch (nextError) {
      publishSurfaceError('git-changes', nextError, {
        action: 'L’inizializzazione del repository',
        operation: 'initialize-git-repository',
        recovery: 'Aggiorna lo stato Git prima di riprovare',
        title: 'Repository Git non inizializzato',
      })
    } finally {
      endBusy()
    }
  }

  const initializeRepository = () => {
    setConfirmation({ title: 'Inizializza repository Git', detail: 'Verrà creata la cartella nascosta .git nel workspace aperto. I file del progetto non verranno modificati.', confirmLabel: 'Inizializza repository', onConfirm: () => void initializeRepositoryConfirmed() })
  }

  // Stage e unstage sono locali, immediatamente reversibili e già protetti dal
  // servizio Git per i file sensibili: una conferma qui interrompe solo il flusso.
  const stage = useCallback((file: GitFileStatus) => void mutateGit(() => window.vincodeLab.github.stage([file.path]), 'File aggiunto allo staging', 'git-changes', {
    action: `La preparazione di “${file.path}”`, operation: 'stage-git-file', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'File non aggiunto allo staging',
  }), [mutateGit])
  const unstage = useCallback((file: GitFileStatus) => void mutateGit(() => window.vincodeLab.github.unstage([file.path]), 'File rimosso dallo staging', 'git-changes', {
    action: `La rimozione di “${file.path}” dallo staging`, operation: 'unstage-git-file', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Staging non aggiornato',
  }), [mutateGit])
  const stageAll = (files: GitFileStatus[]) => void mutateGit(() => window.vincodeLab.github.stage(files.map((file) => file.path)), 'Modifiche aggiunte allo staging', 'git-changes', {
    action: 'La preparazione dei file visibili', operation: 'stage-git-files', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'File non aggiunti allo staging',
  })
  const unstageAll = (files: GitFileStatus[]) => void mutateGit(() => window.vincodeLab.github.unstage(files.map((file) => file.path)), 'File rimossi dallo staging', 'git-changes', {
    action: 'La rimozione dei file visibili dallo staging', operation: 'unstage-git-files', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Staging non aggiornato',
  })

  const loadDiff = useCallback(async (file: GitFileStatus) => {
    const requestId = ++diffRequest.current
    beginBusy()
    try {
      const content = await window.vincodeLab.github.fileDiff(file.path)
      if (requestId !== diffRequest.current) return
      setSelectedDiff({ path: file.path, content })
      failedDiffFile.current = null
      clearSurfaceError('diff')
      requestAnimationFrame(() => diffRegion.current?.focus())
    } catch (nextError) {
      if (requestId === diffRequest.current) {
        failedDiffFile.current = file
        publishSurfaceError('diff', nextError, {
          action: `La lettura del diff di “${file.path}”`,
          notFoundTitle: 'File del diff non disponibile',
          operation: 'load-git-file-diff',
          preserved: 'L’eventuale diff precedente resta visibile.',
          recovery: 'Riprova a leggere il diff',
          title: 'Diff Git non disponibile',
        })
      }
    } finally { endBusy() }
  }, [beginBusy, clearSurfaceError, endBusy, publishSurfaceError])

  const clearSelectedDiff = useCallback(() => {
    diffRequest.current += 1
    setSelectedDiff(null)
  }, [])

  const restoredSession = useRef<WorkspaceSessionState['github'] | null>(null)
  const restoredDiffPath = useRef<string | null>(null)
  useEffect(() => {
    if (!initialState) return
    const sessionChanged = restoredSession.current !== initialState
    if (sessionChanged) {
      restoredSession.current = initialState
      restoredDiffPath.current = null
      selectedProjectRef.current = initialState.selectedProjectNumber
      boardRequest.current += 1
      projectFieldRequest.current += 1
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      // Lo snapshot Electron può arrivare dopo il mount della vista persistente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(initialState.tab)
      setIssueStateFilter(initialState.issueStateFilter)
      setSelectedProject(initialState.selectedProjectNumber)
    }
    if (!initialState.selectedDiffPath) {
      // La rimozione del diff è parte dello stesso restore esterno.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionChanged) clearSelectedDiff()
      return
    }
    if (!status || restoredDiffPath.current === initialState.selectedDiffPath) return
    restoredDiffPath.current = initialState.selectedDiffPath
    const file = status.files.find((entry) => entry.path === initialState.selectedDiffPath || entry.previousPath === initialState.selectedDiffPath)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (file) void loadDiff(file)
    else clearSelectedDiff()
  }, [clearSelectedDiff, initialState, loadDiff, status])

  useEffect(() => {
    onSessionChange?.({
      tab,
      selectedDiffPath: selectedDiff?.path ?? null,
      selectedProjectNumber: selectedProject,
      issueStateFilter,
    })
  }, [issueStateFilter, onSessionChange, selectedDiff?.path, selectedProject, tab])

  useEffect(() => {
    onContextChange?.({
      tab,
      branch: status?.branch ?? null,
      changedFiles: status?.files.map((file) => file.path) ?? [],
      selectedDiffPath: selectedDiff?.path ?? null,
    })
  }, [onContextChange, selectedDiff?.path, status?.branch, status?.files, tab])

  const handledWorkbenchRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!workbenchRequest || loading || handledWorkbenchRequest.current === workbenchRequest.nonce) return
    if (workbenchRequest.kind === 'open-file-diff' && !status) return
    handledWorkbenchRequest.current = workbenchRequest.nonce
    // La richiesta keyboard/menu seleziona la regione Git operativa prima del focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab('changes')

    if (workbenchRequest.kind === 'open-file-diff') {
      const file = status?.files.find((entry) => entry.path === workbenchRequest.filePath || entry.previousPath === workbenchRequest.filePath)
      if (file) void loadDiff(file)
      else {
        toast.info('Il file corrente non contiene modifiche Git.', { description: workbenchRequest.filePath })
        requestAnimationFrame(() => changesPrimary.current?.focus())
      }
      return
    }

    requestAnimationFrame(() => {
      const target = changesPrimary.current?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? changesPrimary.current
      target?.focus()
    })
  }, [loadDiff, loading, status, workbenchRequest])

  const switchBranch = (nextBranch: string) => {
    if (!status || nextBranch === status.branch) return
    const dirty = status.files.length > 0 ? '\n\nIl working tree contiene modifiche: Git potrebbe rifiutare il cambio.' : ''
    confirmGit(`Passare al branch “${nextBranch}”?${dirty}`, () => window.vincodeLab.github.switchBranch(nextBranch), `Branch attivo: ${nextBranch}`, 'git-changes', {
      action: `Il passaggio al branch “${nextBranch}”`, notFoundTitle: 'Branch Git non disponibile', operation: 'switch-git-branch', recovery: 'Aggiorna branch e stato Git prima di riprovare', title: 'Branch Git non cambiato',
    })
  }

  const createBranch = () => {
    const nextBranch = branchName.trim()
    if (!nextBranch) return
    confirmGit(`Creare e attivare il branch “${nextBranch}”?`, async () => {
      const next = await window.vincodeLab.github.createBranch(nextBranch)
      setBranchName('')
      return next
    }, `Branch creato: ${nextBranch}`, 'git-changes', {
      action: `La creazione del branch “${nextBranch}”`, operation: 'create-git-branch', preserved: 'Il nome inserito è stato mantenuto.', recovery: 'Aggiorna branch e stato Git prima di riprovare', title: 'Branch Git non creato',
    })
  }

  const fetchRemote = () => {
    if (!status?.remote) return
    confirmGit(`Controllare gli aggiornamenti remoti da ${status.remote}?`, () => window.vincodeLab.github.fetch(), 'Aggiornamenti remoti controllati', 'git-remote', {
      action: 'La verifica degli aggiornamenti remoti', notFoundTitle: 'Repository remoto non disponibile', operation: 'fetch-git-remote', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Aggiornamenti remoti non verificati',
    })
  }

  const pullRemote = () => {
    if (!status?.upstream) return
    confirmGit(`Scaricare e integrare gli aggiornamenti da ${status.upstream}?`, () => window.vincodeLab.github.pullRebase(), 'Aggiornamenti integrati', 'git-remote', {
      action: 'L’integrazione degli aggiornamenti remoti', notFoundTitle: 'Branch remoto non disponibile', operation: 'pull-rebase-git-remote', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Aggiornamenti remoti non integrati',
    })
  }

  const pushRemote = () => {
    if (!status?.remote) return
    confirmGit(status.upstream ? `Pubblicare ${status.ahead ?? 0} commit sul remote ${status.upstream}?` : `Pubblicare ${status.ahead ?? 0} commit su ${status.remote} e associare il branch?`, () => window.vincodeLab.github.push(), status.upstream ? 'Commit pubblicati' : 'Branch pubblicato e associato al remote', 'git-remote', {
      action: 'La pubblicazione dei commit', notFoundTitle: 'Repository o branch remoto non disponibile', operation: 'push-git-remote', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Commit non pubblicati',
    })
  }

  const addRemoteConfirmed = async () => {
    beginBusy()
    try {
      const nextStatus = await window.vincodeLab.github.addRemote(remoteUrl)
      gitRequest.current += 1
      setStatus(nextStatus)
      setLoading(false)
      setRemoteUrl('')
      clearSurfaceError('git-remote')
      toast.success('Repository GitHub collegato')
    } catch (nextError) {
      publishSurfaceError('git-remote', nextError, {
        action: 'Il collegamento del repository remoto',
        notFoundTitle: 'Repository GitHub non trovato',
        operation: 'add-github-remote',
        preserved: 'L’indirizzo inserito è stato mantenuto.',
        recovery: 'Verifica il repository e aggiorna lo stato Git prima di riprovare',
        title: 'Repository GitHub non collegato',
      })
    } finally {
      endBusy()
    }
  }

  const addRemote = () => {
    if (!remoteUrl.trim()) return
    setConfirmation({ title: 'Collega repository GitHub', detail: `Il remote origin verrà configurato con:\n${remoteUrl.trim()}`, confirmLabel: 'Collega repository', onConfirm: () => void addRemoteConfirmed() })
  }

  const createGitHubRepositoryConfirmed = async () => {
    beginBusy()
    try {
      const nextStatus = await window.vincodeLab.github.createRepository(githubRepositoryName, githubRepositoryVisibility)
      gitRequest.current += 1
      setStatus(nextStatus)
      setLoading(false)
      setGitHubRepositoryName('')
      clearSurfaceError('git-remote')
      toast.success('Repository GitHub creato e pubblicato')
    } catch (nextError) {
      publishSurfaceError('git-remote', nextError, {
        action: 'La creazione e pubblicazione del repository',
        operation: 'create-github-repository',
        preserved: 'Nome e visibilità inseriti sono stati mantenuti.',
        recovery: 'Aggiorna lo stato Git prima di decidere se riprovare',
        title: 'Repository GitHub non creato',
      })
    } finally {
      endBusy()
    }
  }

  const createGitHubRepository = () => {
    if (!githubRepositoryName.trim()) return
    const visibility = githubRepositoryVisibility === 'private' ? 'privato' : 'pubblico'
    setConfirmation({ title: 'Crea repository GitHub', detail: `Verrà creato e pubblicato il repository ${visibility} “${githubRepositoryName.trim()}” nell’account GitHub configurato. Il remote origin verrà collegato al workspace.`, confirmLabel: 'Crea e pubblica', onConfirm: () => void createGitHubRepositoryConfirmed() })
  }

  const createIssue = async () => {
    if (!issueTitle.trim()) return
    beginBusy()
    try {
      const nextData = await window.vincodeLab.github.createIssue(issueTitle, issueBody)
      githubDataRequest.current += 1
      setData(nextData)
      setIssueTitle('')
      setIssueBody('')
      setIssueComposerOpen(false)
      clearSurfaceError('issues')
      toast.success('Issue creata')
    } catch (nextError) {
      publishSurfaceError('issues', nextError, {
        action: 'La creazione della issue',
        notFoundTitle: 'Repository GitHub non disponibile',
        operation: 'create-github-issue',
        preserved: 'Titolo e descrizione sono stati mantenuti.',
        recovery: 'Aggiorna le issue prima di decidere se riprovare',
        title: 'Issue non creata',
      })
    } finally {
      endBusy()
    }
  }

  const loadBoard = async (projectNumber: number) => {
    const requestId = ++boardRequest.current
    projectFieldRequest.current += 1
    setLoadingProjectFields(false)
    beginBusy()
    setLoadingBoard(true)
    selectedProjectRef.current = projectNumber
    setSelectedProject(projectNumber)
    setProjectPickerCollapsed(true)
    if (board?.project.number !== projectNumber) setBoard(null)
    try {
      const nextBoard = await window.vincodeLab.github.projectBoard(projectNumber)
      if (requestId !== boardRequest.current) return
      if (selectedProjectRef.current !== projectNumber) return
      setBoard(nextBoard.data)
      setBoardCache(nextBoard.cache)
      clearSurfaceError('board')
    } catch (nextError) {
      if (requestId === boardRequest.current && selectedProjectRef.current === projectNumber) publishSurfaceError('board', nextError, {
        action: `La lettura del Project #${projectNumber}`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: 'load-github-project-board',
        preserved: board?.project.number === projectNumber ? 'La board precedente resta visibile.' : undefined,
        recovery: 'Riprova a caricare il Project',
        title: 'Board del Project non disponibile',
      })
    } finally {
      if (requestId === boardRequest.current) setLoadingBoard(false)
      endBusy()
    }
  }

  const createProject = async () => {
    if (!projectTitle.trim()) return
    beginBusy()
    try {
      const projects = await window.vincodeLab.github.createProject(projectTitle)
      githubDataRequest.current += 1
      setData((current) => current ? { ...current, projects } : current)
      setProjectTitle('')
      clearSurfaceError('projects')
      toast.success('Progetto creato e collegato al workspace')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: 'La creazione del Project',
        operation: 'create-github-project',
        preserved: 'Il titolo inserito è stato mantenuto.',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non creato',
      })
    } finally { endBusy() }
  }

  const startProjectEdit = (project: GitHubProject) => {
    setEditingProject(project)
    setProjectEditTitle(project.title)
    setProjectEditDescription(project.shortDescription)
  }

  const editProjectConfirmed = async (project: GitHubProject) => {
    beginBusy()
    try {
      const projects = await window.vincodeLab.github.editProject(project.number, projectEditTitle, projectEditDescription)
      githubDataRequest.current += 1
      setData((current) => current ? { ...current, projects } : current)
      setEditingProject(null)
      clearSurfaceError('projects')
      toast.success('Project aggiornato')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: `L’aggiornamento di “${project.title}”`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: 'edit-github-project',
        preserved: 'Le modifiche al modulo sono state mantenute.',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non aggiornato',
      })
    } finally { endBusy() }
  }

  const requestProjectEdit = () => {
    if (!editingProject || !projectEditTitle.trim()) return
    setConfirmation({ title: 'Aggiorna Project', detail: `Le informazioni di “${editingProject.title}” verranno aggiornate.`, confirmLabel: 'Salva Project', onConfirm: () => void editProjectConfirmed(editingProject) })
  }

  const closeProjectConfirmed = async (project: GitHubProject) => {
    beginBusy()
    try {
      const projects = await window.vincodeLab.github.closeProject(project.number, !project.closed)
      githubDataRequest.current += 1
      setData((current) => current ? { ...current, projects } : current)
      clearSurfaceError('projects')
      toast.success(project.closed ? 'Project riaperto' : 'Project chiuso')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: project.closed ? `La riapertura di “${project.title}”` : `La chiusura di “${project.title}”`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: project.closed ? 'reopen-github-project' : 'close-github-project',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non aggiornato',
      })
    } finally { endBusy() }
  }

  const requestProjectClose = (project: GitHubProject) => {
    const reopening = project.closed
    setConfirmation({ title: reopening ? 'Riapri Project' : 'Chiudi Project', detail: reopening ? `“${project.title}” tornerà disponibile per le attività del workspace.` : `“${project.title}” verrà chiuso. Le attività resteranno conservate.`, confirmLabel: reopening ? 'Riapri Project' : 'Chiudi Project', destructive: !reopening, onConfirm: () => void closeProjectConfirmed(project) })
  }

  const updateBoardStatusConfirmed = async (item: GitHubProjectItem, optionId: string, statusField: GitHubProjectField, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await window.vincodeLab.github.updateProjectItem(projectNumber, item.id, statusField.id, { type: 'singleSelect', optionId })
      boardRequest.current += 1
      projectFieldRequest.current += 1
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      clearSurfaceError('board')
      toast.success('Stato del progetto aggiornato')
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: 'L’aggiornamento dello stato dell’attività',
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'update-github-project-item-status',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: 'Stato dell’attività non aggiornato',
      })
    } finally { endBusy() }
  }

  const updateBoardStatus = (item: GitHubProjectItem, optionId: string) => {
    const statusField = board?.fields.find((field) => field.name.toLowerCase() === 'status' || field.name.toLowerCase() === 'stato')
    if (!board || !statusField) return
    setConfirmation({ title: 'Aggiorna stato', detail: `Lo stato di “${item.content?.title ?? item.title ?? 'elemento'}” verrà aggiornato.`, confirmLabel: 'Aggiorna stato', onConfirm: () => void updateBoardStatusConfirmed(item, optionId, statusField, board.project.number) })
  }

  const updateBoardFieldConfirmed = async (item: GitHubProjectItem, field: GitHubProjectField, update: GitHubProjectItemUpdate, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await window.vincodeLab.github.updateProjectItem(projectNumber, item.id, field.id, update)
      boardRequest.current += 1
      projectFieldRequest.current += 1
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      const value = update.type === 'clear' || update.type === 'singleSelect' ? '' : String(update.value)
      setProjectFieldDrafts((current) => ({ ...current, [field.id]: value }))
      setProjectFieldValues((current) => ({ ...current, [field.id]: value }))
      clearSurfaceError('board')
      toast.success(`Campo “${field.name}” aggiornato`)
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: `L’aggiornamento del campo “${field.name}”`,
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'update-github-project-item-field',
        preserved: 'Il valore inserito è stato mantenuto.',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: `Campo “${field.name}” non aggiornato`,
      })
    } finally { endBusy() }
  }

  const saveBoardField = (item: GitHubProjectItem, field: GitHubProjectField) => {
    if (!board) return
    const value = projectFieldDrafts[field.id] ?? ''
    const dataType = projectFieldDataType(field)
    const update = dataType === 'text' ? { type: 'text' as const, value }
      : dataType === 'number' ? { type: 'number' as const, value: Number(value) }
        : dataType === 'date' ? { type: 'date' as const, value }
          : null
    if (!update || (update.type === 'number' && !Number.isFinite(update.value)) || (update.type === 'date' && !value)) return
    setConfirmation({ title: `Aggiorna ${field.name}`, detail: `Il campo “${field.name}” di “${item.content?.title ?? item.title ?? 'attività'}” verrà aggiornato.`, confirmLabel: 'Salva campo', onConfirm: () => void updateBoardFieldConfirmed(item, field, update, board.project.number) })
  }

  const clearBoardField = (item: GitHubProjectItem, field: GitHubProjectField) => {
    if (!board) return
    setConfirmation({ title: `Svuota ${field.name}`, detail: `Il valore di “${field.name}” per “${item.content?.title ?? item.title ?? 'attività'}” verrà rimosso.`, confirmLabel: 'Svuota', destructive: true, onConfirm: () => void updateBoardFieldConfirmed(item, field, { type: 'clear' }, board.project.number) })
  }

  const loadProjectItemFields = async (item: GitHubProjectItem, projectNumber: number) => {
    const request = ++projectFieldRequest.current
    setLoadingProjectFields(true)
    try {
      const fieldValues = await window.vincodeLab.github.projectItemFields(projectNumber, item.id)
      if (projectFieldRequest.current !== request) return
      setProjectFieldValues(fieldValues)
      setProjectFieldDrafts(fieldValues)
      clearSurfaceError('project-fields')
    } catch (nextError) {
      if (projectFieldRequest.current !== request) return
      publishSurfaceError('project-fields', nextError, {
        action: 'La lettura dei campi dell’attività',
        notFoundTitle: 'Attività del Project non disponibile',
        operation: 'load-github-project-item-fields',
        preserved: 'La board e il dettaglio dell’attività restano visibili.',
        recovery: 'Riprova a leggere i campi',
        title: 'Campi dell’attività non disponibili',
      })
    } finally {
      if (projectFieldRequest.current === request) setLoadingProjectFields(false)
    }
  }

  const selectBoardItem = async (item: GitHubProjectItem, trigger: HTMLButtonElement) => {
    if (!board) return
    boardItemDialogTrigger.current = trigger
    setSelectedBoardItemId(item.id)
    setBoardItemDialogOpen(true)
    const loadedValues = item.fieldValues ?? {}
    setProjectFieldDrafts(loadedValues)
    setProjectFieldValues(loadedValues)
    setLoadingProjectFields(false)
    clearSurfaceError('project-fields')
    if (item.fieldValues) return
    await loadProjectItemFields(item, board.project.number)
  }

  const archiveBoardItemConfirmed = async (item: GitHubProjectItem, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await window.vincodeLab.github.archiveProjectItem(projectNumber, item.id, false)
      boardRequest.current += 1
      projectFieldRequest.current += 1
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      clearSurfaceError('board')
      toast.success('Elemento archiviato')
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: 'L’archiviazione dell’attività',
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'archive-github-project-item',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: 'Attività non archiviata',
      })
    } finally { endBusy() }
  }

  const archiveBoardItem = (item: GitHubProjectItem) => {
    if (!board) return
    setConfirmation({ title: 'Archivia attività', detail: `“${item.content?.title ?? item.title ?? 'Questo elemento'}” verrà rimosso dalla board.`, confirmLabel: 'Archivia', destructive: true, onConfirm: () => void archiveBoardItemConfirmed(item, board.project.number) })
  }

  const requestCommit = () => {
    if (!commitMessage.trim()) return
    setConfirmation({ title: 'Crea commit', detail: `${staged.length} file in staging. Messaggio: ${commitMessage.trim()}`, confirmLabel: 'Crea commit', onConfirm: () => void mutateGit(async () => { const next = await window.vincodeLab.github.commit(commitMessage); setCommitMessage(''); return next }, 'Commit creato', 'git-commit', {
      action: 'La creazione del commit', operation: 'create-git-commit', preserved: 'Il messaggio e i file in staging sono stati mantenuti.', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Commit non creato',
    }) })
  }

  const requestCreateProject = () => {
    if (!projectTitle.trim()) return
    setConfirmation({ title: 'Crea progetto', detail: `“${projectTitle.trim()}” verrà creato e collegato al repository ${data?.repository?.nameWithOwner ?? 'del workspace'}.`, confirmLabel: 'Crea progetto', onConfirm: () => void createProject() })
  }

  const boardStatusField = board?.fields.find((field) => ['status', 'stato'].includes(projectFieldName(field)))
  const boardPriorityField = board?.fields.find((field) => ['priorità', 'priority'].includes(projectFieldName(field)))
  const preferredBoardGroupField = board?.fields.find((field) => ['prodotto', 'area', 'team', 'categoria'].includes(projectFieldName(field)))
  const activeBoardGroupFieldId = boardGroupFieldId === '__none__' ? '' : boardGroupFieldId || preferredBoardGroupField?.id || boardStatusField?.id || ''
  const activeBoardGroupField = board?.fields.find((field) => field.id === activeBoardGroupFieldId)
  const selectedBoardItem = board?.items.find((item) => item.id === selectedBoardItemId) ?? null
  const issueDetail = selectedBoardItem?.content?.number ? data?.issues.find((issue) => issue.number === selectedBoardItem.content?.number) ?? null : null
  const selectedProjectDetails = data?.projects.find((project) => project.number === selectedProject) ?? null
  const editableBoardFields = board?.fields.filter((field) => ['text', 'number', 'date'].includes(projectFieldDataType(field))) ?? []
  const boardItems = board?.items.filter((item) => {
    return matchesProjectItemSearch(item, boardSearch)
      && (!boardStatusFilter || item.status === boardStatusFilter)
  }) ?? []
  const boardGroups = new Map<string, GitHubProjectItem[]>()
  for (const item of boardItems) {
    const groupName = activeBoardGroupFieldId ? item.fieldValues?.[activeBoardGroupFieldId] ?? (activeBoardGroupFieldId === boardStatusField?.id ? item.status : '') : ''
    const label = String(groupName || (activeBoardGroupField ? 'Senza gruppo' : 'Tutte le attività'))
    boardGroups.set(label, [...(boardGroups.get(label) ?? []), item])
  }
  const boardStatusCounts = new Map<string, number>()
  for (const item of board?.items ?? []) {
    const statusName = String(item.status || 'Senza stato')
    boardStatusCounts.set(statusName, (boardStatusCounts.get(statusName) ?? 0) + 1)
  }
  const boardHasFilters = Boolean(boardSearch.trim() || boardStatusFilter)
  const graphRows = layoutGitGraph((status?.graph ?? []).slice(0, historyLimit))
  const issueCounts = (data?.issues ?? []).reduce((counts, issue) => ({ ...counts, [issue.state]: (counts[issue.state] ?? 0) + 1 }), {} as Record<string, number>)
  const visibleIssues = (data?.issues ?? []).filter((issue) => {
    return matchesIssueSearch(issue, issueSearch) && (issueStateFilter === 'all' || issue.state === issueStateFilter)
  })
  const branches = branchPage.branches
  const branchesLimited = branchPage.hasMore || branchPage.truncated
  const filesLimited = status?.filesHasMore === true || status?.filesTruncated === true
  const graphLimited = status?.graphHasMore === true || status?.graphTruncated === true
  const gitResultLimited = status?.hasMore === true || status?.truncated === true
  const issuesLimited = data?.issuesHasMore === true || data?.issuesTruncated === true
  const projectsLimited = data?.projectsHasMore === true || data?.projectsTruncated === true
  const githubResultLimited = data?.hasMore === true || data?.truncated === true
  const boardResultLimited = board?.hasMore === true || board?.truncated === true
  const boardLimitMessages: string[] = []
  if (board?.fieldsHasMore) boardLimitMessages.push('Sono mostrati solo i primi campi disponibili.')
  if (board?.fieldOptionsTruncated) boardLimitMessages.push('Alcune opzioni dei campi sono state abbreviate.')
  if (board?.fieldsTruncated && !board.fieldsHasMore && !board.fieldOptionsTruncated) boardLimitMessages.push('I campi della board sono parziali.')
  if (board?.itemsHasMore) boardLimitMessages.push('Sono mostrate solo le prime attività disponibili.')
  if (board?.itemValuesTruncated) boardLimitMessages.push('Alcuni valori delle attività sono stati abbreviati.')
  if (board?.itemsTruncated && !board.itemsHasMore && !board.itemValuesTruncated) boardLimitMessages.push('Le attività della board sono parziali.')
  if (boardResultLimited && boardLimitMessages.length === 0) boardLimitMessages.push('La board contiene altri dati non inclusi in questa vista.')
  const activeResultLimited = tab === 'changes'
    ? (filesLimited || branchesLimited || gitResultLimited)
    : tab === 'graph'
      ? (graphLimited || gitResultLimited)
      : tab === 'issues'
        ? (issuesLimited || githubResultLimited)
        : (projectsLimited || boardResultLimited || githubResultLimited)

  useApplicationMenuCommand('github.refresh', () => { void (tab === 'changes' ? refreshGit(true) : refreshGitHub(true)) })
  useApplicationMenuCommand('github.fetch', () => {
    if (!status?.remote) {
      toast.info('Collega prima un repository remoto.')
      return
    }
    fetchRemote()
  })

  useEffect(() => window.vincodeLab.contextMenu?.onAction?.((action) => {
    if ((action.contextKind !== 'git-unstaged-file' && action.contextKind !== 'git-staged-file') || !action.contextId) return
    const file = status?.files.find((candidate) => candidate.path === action.contextId)
    if (!file) return
    if (action.command === 'gitFile.open') { onOpenFile?.(file.path); return }
    if (busy) {
      if (action.command === 'gitFile.diff' || action.command === 'gitFile.stage' || action.command === 'gitFile.unstage') toast.info('Attendi la conclusione dell’operazione Git in corso.')
      return
    }
    if (action.command === 'gitFile.diff') { void loadDiff(file); return }
    if (action.command === 'gitFile.stage' && !file.sensitive) { stage(file); return }
    if (action.command === 'gitFile.unstage') unstage(file)
  }) ?? (() => undefined), [busy, loadDiff, onOpenFile, stage, status?.files, unstage])

  const refreshGitAfterFailure = async (surface: GitHubErrorSurface) => {
    clearSurfaceError(surface)
    await refreshGit(true)
  }
  const refreshGitHubAfterFailure = async (surface: GitHubErrorSurface) => {
    clearSurfaceError(surface)
    await refreshGitHub(true, false)
  }
  const retryFailedDiff = async () => {
    const file = failedDiffFile.current
    if (!file) return
    clearSurfaceError('diff')
    await loadDiff(file)
  }
  const retrySelectedBoard = async () => {
    if (!selectedProject) return
    clearSurfaceError('board')
    await loadBoard(selectedProject)
  }
  const retrySelectedProjectFields = async () => {
    if (!selectedBoardItem || !board) return
    clearSurfaceError('project-fields')
    await loadProjectItemFields(selectedBoardItem, board.project.number)
  }
  if (loading && !status) return <div className={gh.loading} role="status"><Spinner /> Caricamento repository…</div>
  if (gitStatusError && !status?.isRepository) return <div className={gh.empty}><ErrorNotice action={{ label: 'Riprova', pendingLabel: 'Verifica stato Git…', onClick: retryGitStatus }} error={gitStatusError} /><ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} /></div>
  if (!status?.isRepository) return <div className={gh.empty}><GitFork size={30} /><h2 className={gh.emptyTitle}>Nessun repository Git</h2><p className={gh.emptyDescription}>Questo workspace non è ancora sotto controllo versione. Inizializzalo qui per usare commit, branch e GitHub.</p><Button disabled={busy} onClick={initializeRepository}><GitFork /> Inizializza repository</Button><GitHubErrorNotice error={surfaceErrors['git-changes']} label="Verifica stato Git" onClick={() => refreshGitAfterFailure('git-changes')} /><ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} /></div>

  const staged = status.files.filter((file) => file.index !== ' ' && file.index !== '?')
  const unstaged = status.files.filter((file) => file.workingTree !== ' ' || file.index === '?')
  const stageable = unstaged.filter((file) => !file.sensitive)
  const activeCache = tab === 'changes' || tab === 'graph' ? gitCache : tab === 'projects' && boardCache ? boardCache : githubCache
  const cacheState = formatCacheState(activeCache)
  const githubDataState = !data ? <section aria-live="polite" className={cx(gh.panel, gh.liveState)}>{busy ? <p className={cx(gh.muted, gh.inlineLoading)}><Spinner size={15} /> Caricamento dati GitHub…</p> : surfaceErrors['github-data'] ? <ErrorNotice action={{ label: 'Riprova caricamento GitHub', onClick: () => refreshGitHubAfterFailure('github-data') }} error={surfaceErrors['github-data']} /> : <><p className={gh.muted}>I dati GitHub non sono ancora disponibili.</p><Button size="sm" variant="outline" onClick={() => void refreshGitHub(true)}><RefreshCw size={14} /> Riprova caricamento GitHub</Button></>}</section> : null

  return <Tabs.Root asChild value={tab} onValueChange={({ value }) => setTab(value as GitHubTab)}><div className={gh.workspace}>
    <header className={gh.header}>
      <div className={gh.repositorySummary}><h1 className={gh.pageTitle}><GitFork size={18} /> Git del workspace</h1><p className={gh.headerDescription}><strong>Branch attivo</strong> {status.branch}{status.upstream ? ` · ${status.upstream}` : status.remote ? ` · ${status.remote} non associato al branch` : ' · nessun remote configurato'}</p><div className={gh.metrics}><span className={gh.metric}>{status.files.length}{filesLimited ? '+' : ''} modifiche</span><span className={gh.metric} title="Commit locali non ancora pubblicati"><ArrowUp aria-hidden="true" size={11} /> {status.ahead ?? 0}</span><span className={gh.metric} title="Commit disponibili sul remoto"><ArrowDown aria-hidden="true" size={11} /> {status.behind ?? 0}</span></div></div>
      <div className={gh.headerActions}>{activeResultLimited && <LimitNotice className={gh.limitNoticeInline}>Vista parziale: sono disponibili altri dati.</LimitNotice>}{cacheState && <span aria-live="polite" className={gh.cacheState({ stale: activeCache?.stale })}>{cacheState}</span>}<Button variant="outline" size="sm" disabled={busy} onClick={() => void (tab === 'changes' ? refreshGit(true) : refreshGitHub(true))}><RefreshCw /> Aggiorna</Button>{tab === 'changes' && <><Button variant="outline" size="sm" title={!status.remote ? 'Collega un repository GitHub prima di verificare gli aggiornamenti remoti' : 'Git fetch: controlla gli aggiornamenti senza modificare il branch'} disabled={busy || !status.remote} onClick={fetchRemote}><CloudDownload /> Verifica remoto</Button><Button variant="outline" size="sm" title={!status.upstream ? 'Pubblica e associa il branch prima di integrare aggiornamenti' : 'Git pull --rebase: scarica e integra gli aggiornamenti'} disabled={busy || !status.upstream} onClick={pullRemote}><ArrowDownToLine /> Integra</Button><Button size="sm" title={!status.remote ? 'Collega o crea un repository GitHub dalla scheda Modifiche per pubblicare e sincronizzare il branch.' : status.upstream ? 'Git push: pubblica i commit locali' : 'Git push --set-upstream: pubblica e collega il branch'} disabled={busy || !status.remote || !status.ahead} onClick={pushRemote}><CloudUpload /> Pubblica</Button></>}</div>
    </header>
    <Tabs.List className={gh.tabsList} aria-label="Sezioni GitHub">
      <Tabs.Trigger value="changes">Modifiche <span className={gh.tabCount}>{status.files.length}</span></Tabs.Trigger>
      <Tabs.Trigger value="graph">Grafo <span className={gh.tabCount}>{status.graph.length}</span></Tabs.Trigger>
      <Tabs.Trigger value="issues">Issue</Tabs.Trigger>
      <Tabs.Trigger value="projects">Progetti</Tabs.Trigger>
      <Tabs.Indicator />
    </Tabs.List>
    {gitStatusError && <ErrorNotice action={{ label: 'Riprova', pendingLabel: 'Verifica stato Git…', onClick: retryGitStatus }} error={gitStatusError} />}
    <Tabs.Content value="changes" className={cx(gh.content, gh.changesContent)}>
      <GitHubErrorNotice error={surfaceErrors['git-remote']} label="Aggiorna stato Git" onClick={() => refreshGitAfterFailure('git-remote')} />
      <GitHubErrorNotice error={surfaceErrors.branches} label="Aggiorna branch" onClick={() => refreshGitAfterFailure('branches')} />
      <GitHubErrorNotice error={surfaceErrors['git-changes']} label="Aggiorna stato Git" onClick={() => refreshGitAfterFailure('git-changes')} />
      <section aria-label="Gestione branch" className={gh.branchToolbar}>
        <div className={gh.currentBranch}>
          <GitBranch className={gh.branchIcon} size={15} />
          <div className={gh.branchSelect}>
            <SelectField
              id="github-active-branch"
              label="Branch"
              disabled={busy}
              options={branches.map((branch) => ({ label: branch.name, value: branch.name }))}
              value={status.branch}
              onValueChange={switchBranch}
            />
          </div>
          <span className={gh.branchUpstream}>{status.upstream ?? 'Solo locale'}</span>
          {branchesLimited && <LimitNotice className={gh.limitNoticeInline}>Elenco branch limitato ai primi {branches.length} risultati; il branch attivo resta incluso.</LimitNotice>}
        </div>
        <Collapsible.Root className={gh.branchActions}>
          <Collapsible.Trigger className={gh.branchActionsTrigger}>Gestisci branch e remote<Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator></Collapsible.Trigger>
          <Collapsible.Content className={gh.branchActionsPanel}><div className={gh.branchActionsContent}>
            <div className={gh.createBranch}>
              <Field.Root className={gh.growField}>
                <Field.Input aria-label="Nome del nuovo branch" value={branchName} maxLength={255} placeholder="Nome nuovo branch" onChange={(event) => setBranchName(event.target.value)} />
              </Field.Root>
              <Button size="sm" variant="outline" disabled={busy || !branchName.trim()} onClick={createBranch}><Plus /> Crea branch</Button>
            </div>
            {!status.remote && <>
              <div className={gh.remoteForm}>
                <Field.Root id="github-repository-name">
                  <Field.Label>Crea repository GitHub</Field.Label>
                  <Field.Input id="github-repository-name" value={githubRepositoryName} maxLength={200} placeholder="nome-repository" onChange={(event) => setGitHubRepositoryName(event.target.value)} />
                </Field.Root>
                <div className={gh.remoteControls}>
                  <div className={gh.remoteVisibility}>
                    <SelectField
                      id="github-repository-visibility"
                      aria-label="Visibilità del repository"
                      options={[{ label: 'Privato', value: 'private' }, { label: 'Pubblico', value: 'public' }]}
                      value={githubRepositoryVisibility}
                      onValueChange={(value) => setGitHubRepositoryVisibility(value as 'private' | 'public')}
                    />
                  </div>
                  <Button size="sm" disabled={busy || !githubRepositoryName.trim() || status.commits.length === 0} onClick={createGitHubRepository}>Crea e pubblica</Button>
                </div>
              </div>
              <Field.Root className={gh.remoteForm} id="github-remote-url">
                <Field.Label>Collega repository esistente</Field.Label>
                <div className={gh.remoteControls}>
                  <Field.Input id="github-remote-url" aria-describedby="github-remote-help" value={remoteUrl} maxLength={2_048} placeholder="https://github.com/utente/repository.git" onChange={(event) => setRemoteUrl(event.target.value)} />
                  <Button size="sm" variant="outline" disabled={busy || !remoteUrl.trim()} onClick={addRemote}>Collega</Button>
                </div>
                <Field.HelperText id="github-remote-help">Sono accettati URL GitHub HTTPS o SSH.</Field.HelperText>
              </Field.Root>
            </>}
          </div></Collapsible.Content>
        </Collapsible.Root>
      </section>
      <div className={gh.changesWorkbench} ref={changesPrimary} tabIndex={-1}>
        <aside aria-label="Preparazione commit" className={gh.changeSidebar}>
          {filesLimited && <LimitNotice className={gh.limitNoticeSection}>Elenco modifiche limitato a {status.files.length} file visibili. Le azioni di gruppo agiscono solo sui file mostrati.</LimitNotice>}
          <div className={gh.changeGroups}>
            <Collapsible.Root className={gh.changeGroup} defaultOpen><Collapsible.Trigger className={gh.changeGroupTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator><span>Modifiche</span><small className={gh.countBadge}>{unstaged.length}</small></Collapsible.Trigger><Collapsible.Content><div className={gh.changeGroupBody}>{stageable.length > 1 && <Button size="xs" variant="plain" className={gh.groupAction} disabled={busy} onClick={() => stageAll(stageable)}>Aggiungi i {stageable.length} file visibili consentiti</Button>}{unstaged.length ? unstaged.map((file) => <div className={gh.gitFile({ selected: selectedDiff?.path === file.path })} data-context-menu-id={file.path} data-context-menu-kind="git-unstaged-file" data-context-operable={!busy ? 'true' : undefined} data-context-stageable={!busy && !file.sensitive ? 'true' : undefined} key={`change-${file.path}`}><Button size="sm" variant="plain" className={gh.gitFileName} disabled={busy} onClick={(event) => { diffOpener.current = event.currentTarget; void loadDiff(file) }}><FileDiff className={gh.gitFileNameIcon} size={13} /><code className={gh.gitFilePath}>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</code></Button>{file.sensitive && <small className={gh.gitFileProtected}>File riservato</small>}<IconButton size="icon-xs" className={gh.gitFileAction} disabled={busy || file.sensitive} tooltip={file.sensitive ? 'I file riservati non possono essere preparati per il commit dall’app' : 'Aggiungi allo staging'} onClick={() => void stage(file)}><Plus aria-hidden="true" size={13} /></IconButton></div>) : <p className={cx(gh.muted, gh.groupEmpty)}>Nessuna modifica locale.</p>}</div></Collapsible.Content></Collapsible.Root>
            <Collapsible.Root className={gh.changeGroup} defaultOpen><Collapsible.Trigger className={gh.changeGroupTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator><span>Pronti per il commit</span><small className={gh.countBadge}>{staged.length}</small></Collapsible.Trigger><Collapsible.Content><div className={gh.changeGroupBody}>{staged.length > 1 && <Button size="xs" variant="plain" className={gh.groupAction} disabled={busy} onClick={() => unstageAll(staged)}>Rimuovi i {staged.length} file visibili</Button>}{staged.length ? staged.map((file) => <div className={gh.gitFile({ selected: selectedDiff?.path === file.path })} data-context-menu-id={file.path} data-context-menu-kind="git-staged-file" data-context-operable={!busy ? 'true' : undefined} key={`staged-${file.path}`}><Button size="sm" variant="plain" className={gh.gitFileName} disabled={busy} onClick={(event) => { diffOpener.current = event.currentTarget; void loadDiff(file) }}><FileDiff className={gh.gitFileNameIcon} size={13} /><code className={gh.gitFilePath}>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</code></Button><IconButton size="icon-xs" className={gh.gitFileAction} disabled={busy} tooltip="Rimuovi dallo staging" onClick={() => void unstage(file)}><Minus aria-hidden="true" size={13} /></IconButton></div>) : <p className={cx(gh.muted, gh.groupEmpty)}>Nessun file preparato.</p>}</div></Collapsible.Content></Collapsible.Root>
          </div>
          <section className={gh.commitForm}><GitHubErrorNotice error={surfaceErrors['git-commit']} label="Aggiorna stato Git" onClick={() => refreshGitAfterFailure('git-commit')} /><div className={gh.commitHeader}><h2 className={gh.commitTitle}>Commit</h2><span className={gh.commitCount}>{staged.length} {filesLimited ? 'file visibili' : 'file'}</span></div><Field.Root><Field.Textarea aria-label="Messaggio del commit" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={500} placeholder="Descrivi la modifica" /></Field.Root><Button disabled={busy || !staged.length || !commitMessage.trim()} onClick={requestCommit}><GitCommitHorizontal /> Crea commit</Button></section>
        </aside>
        <section aria-live="polite" className={gh.diffWorkspace} ref={diffRegion} tabIndex={-1}><GitHubErrorNotice error={surfaceErrors.diff} label="Riprova diff" onClick={retryFailedDiff} />{selectedDiff ? <><header className={gh.diffHeader}><div className={gh.diffIdentity}><FileDiff className={gh.diffIcon} size={16} /><span className={gh.diffLabel}>Diff</span><code className={gh.diffPath}>{selectedDiff.path}</code></div><Button size="xs" variant="outline" onClick={() => { clearSelectedDiff(); requestAnimationFrame(() => diffOpener.current?.focus()) }}>Chiudi</Button></header><pre className={gh.diffContent}>{selectedDiff.content || 'Nessuna differenza testuale da mostrare.'}</pre></> : <div className={gh.diffEmpty}><FileDiff className={gh.diffEmptyIcon} size={28} /><h2 className={gh.diffEmptyTitle}>Seleziona un file</h2><p className={gh.diffEmptyDescription}>Apri una modifica per confrontare il contenuto prima di aggiungerla al commit.</p></div>}</section>
      </div>
    </Tabs.Content>
    <Tabs.Content value="graph" className={cx(gh.content, gh.graphContent)}><section className={cx(gh.panel, gh.graphPanel)}><h2 className={gh.panelTitle}><GitFork size={15} /> Grafo Git <span className={gh.panelTitleCount}>{status.graph.length}</span></h2><p className={gh.muted}>Cronologia dei branch e dei merge del workspace aperto.</p>{graphLimited && <LimitNotice>Grafo limitato ai primi {status.graph.length} commit disponibili.</LimitNotice>}{graphRows.length ? <div className={gh.graphList}>{graphRows.map((row) => { const width = row.laneCount * 16 + 4; const point = 10 + row.lane * 16; return <div className={gh.graphRow} key={row.commit.sha}><svg aria-hidden="true" className={gh.graphVisual} height={GIT_GRAPH_ROW_HEIGHT} viewBox={`0 0 ${width} ${GIT_GRAPH_ROW_HEIGHT}`} width={width}>{row.links.map((link, index) => <path className={gitGraphPathClass(link.from)} d={`M${10 + link.from * 16} 0 L${10 + link.to * 16} ${GIT_GRAPH_ROW_HEIGHT}`} key={`${link.from}-${link.to}-${index}`} />)}<circle className={gitGraphNodeClass(row.lane)} cx={point} cy="10" r="5" /></svg><div className={gh.graphCommit}><strong className={gh.graphSubject}>{row.commit.subject}</strong><small className={gh.graphMeta}>{row.commit.sha.slice(0, 7)}{row.commit.refs.length ? ` · ${row.commit.refs.join(', ')}` : ''}</small></div></div> })}</div> : <p className={gh.muted}>Nessun commit da visualizzare.</p>}</section></Tabs.Content>
    <Tabs.Content value="issues" className={cx(gh.content, gh.issuesContent)}>{data && <GitHubErrorNotice error={surfaceErrors['github-data']} label="Aggiorna dati GitHub" onClick={() => refreshGitHubAfterFailure('github-data')} />}{githubDataState ?? (data?.githubDiagnostic ? <section className={gh.panel}><GitHubErrorNotice error={surfaceErrors['github-diagnostic']} label="Aggiorna dati GitHub" onClick={() => refreshGitHubAfterFailure('github-diagnostic')} /></section> : <>
      <section className={gh.issueListPanel}>
        <header className={gh.issueListHeader}><div><h2 className={cx(gh.panelTitle, gh.issueListTitle)}>Issue <span className={gh.panelTitleCount}>{data?.issues.length ?? 0}</span></h2><p className={gh.muted}>Attività collegate al repository del workspace.</p></div><Button ref={issueComposerTrigger} onClick={() => setIssueComposerOpen(true)}>Nuova issue</Button></header>
        {issuesLimited && <LimitNotice className={gh.limitNoticeSection}>Elenco issue limitato alle prime {data?.issues.length ?? 0} attività disponibili.</LimitNotice>}
        <div className={gh.issueToolbar}>
          <div className={gh.searchField}><Search aria-hidden="true" className={gh.searchIcon} size={14} /><Field.Root className={gh.searchFieldRoot}><Field.Input className={gh.searchInput} aria-label="Cerca issue per numero, titolo o etichetta" value={issueSearch} onChange={(event) => setIssueSearch(event.target.value)} placeholder="Cerca per numero, titolo o etichetta" type="search" /></Field.Root></div>
          <div className={gh.toolbarSelect}><SelectField aria-label="Filtra issue per stato" options={[{ label: `Aperte (${issueCounts.OPEN ?? 0})`, value: 'OPEN' }, { label: `Chiuse (${issueCounts.CLOSED ?? 0})`, value: 'CLOSED' }, { label: `Tutte (${data?.issues.length ?? 0})`, value: 'all' }]} value={issueStateFilter} onValueChange={(value) => setIssueStateFilter(value as 'all' | 'OPEN' | 'CLOSED')} /></div>
          <span className={gh.toolbarResult}>{visibleIssues.length} risultati</span>
        </div>
        <div className={gh.issueList}>{visibleIssues.length ? visibleIssues.map((issue) => <article className={gh.issue} key={issue.number}><Button variant="plain" aria-haspopup="dialog" className={gh.issueSummary} onClick={(event) => { issueDetailTrigger.current = event.currentTarget; setSelectedIssue(issue); setIssueDetailOpen(true) }}><ChevronRight className={gh.issueChevron} /><span className={gh.issueState({ state: issue.state.toLowerCase() as 'open' | 'closed' })}><Check size={12} /></span><span className={gh.issueNumber}>#{issue.number}</span><span className={gh.issueTitle}><strong className={gh.issueTitleText}>{issue.title}</strong>{issue.labels.length > 0 && <span className={gh.issueLabels}>{issue.labels.slice(0, 3).map((label) => <small className={gh.issueLabel} key={label.name}>{label.name}</small>)}{issue.labelsHasMore && <small className={gh.issueLabelOverflow}>altre etichette…</small>}</span>}</span><small className={gh.issueMeta}>{issue.author?.login ?? 'autore sconosciuto'} · {formatDate(issue.updatedAt)}</small></Button></article>) : <EmptyState className={gh.issueEmpty} description={(data?.issues.length ?? 0) > 0 ? 'Modifica la ricerca o il filtro per vedere altre issue.' : 'Crea la prima issue per tenere traccia del lavoro del repository.'} eyebrow="Issue" icon={<CircleDot size={26} />} title={(data?.issues.length ?? 0) > 0 ? 'Nessun risultato' : 'Nessuna issue'} />}</div>
      </section>
      <Dialog.Root finalFocusEl={() => issueComposerTrigger.current} ids={{ title: 'github-issue-create-title' }} initialFocusEl={() => issueTitleInput.current} lazyMount open={issueComposerOpen} onOpenChange={({ open }) => setIssueComposerOpen(open)}>
        <Dialog.Portal><Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content className={cx(gh.modalContent, gh.issueModal)}>
              <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Repository del workspace</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-issue-create-title">Nuova issue</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi creazione issue"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
              <GitHubErrorNotice error={surfaceErrors.issues} label="Aggiorna issue" onClick={() => refreshGitHubAfterFailure('issues')} />
              <div className={gh.issueForm}>
                <Field.Root id="github-new-issue-title"><Field.Label>Titolo</Field.Label><Field.Input ref={issueTitleInput} id="github-new-issue-title" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} maxLength={256} placeholder="Descrivi il problema o l’attività" /></Field.Root>
                <Field.Root id="github-new-issue-body"><Field.Label>Descrizione</Field.Label><Field.Textarea className={gh.issueBody} id="github-new-issue-body" value={issueBody} onChange={(event) => setIssueBody(event.target.value)} maxLength={65_536} placeholder="Contesto, comportamento atteso e dettagli utili (Markdown)" /></Field.Root>
              </div>
              <footer className={gh.modalFooter}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={busy || !issueTitle.trim()} onClick={() => void createIssue()}><CircleDot /> Crea issue</Button></footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>
      {selectedIssue && <Dialog.Root finalFocusEl={() => issueDetailTrigger.current} ids={{ title: 'github-issue-modal-title' }} open={issueDetailOpen} onOpenChange={({ open }) => setIssueDetailOpen(open)} onExitComplete={() => { if (!issueDetailOpen) setSelectedIssue(null) }}>
        <Dialog.Portal><Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content className={cx(gh.modalContent, gh.itemModal)}>
              <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Issue del workspace</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-issue-modal-title">#{selectedIssue.number} {selectedIssue.title}</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio issue"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
              <div className={gh.itemMeta}><span className={gh.metaBadge}>{selectedIssue.state === 'OPEN' ? 'Aperta' : 'Chiusa'}</span><span className={gh.metaBadge}>{selectedIssue.author?.login ?? 'Autore sconosciuto'}</span><span className={gh.metaBadge}>Aggiornata {formatDate(selectedIssue.updatedAt)}</span>{selectedIssue.labels.map((label) => <span className={gh.metaBadge} key={label.name}>{label.name}</span>)}</div>
              {selectedIssue.labelsHasMore && <LimitNotice>Etichette limitate: questa issue contiene altre etichette.</LimitNotice>}
              <section className={gh.itemContent}><h4 className={gh.itemContentTitle}>Descrizione</h4>{selectedIssue.body ? <MarkdownPreview source={selectedIssue.body} /> : <p className={gh.muted}>Nessuna descrizione disponibile per questa issue.</p>}</section>
              {selectedIssue.bodyTruncated && <LimitNotice>Descrizione abbreviata: apri la issue su GitHub per leggere il contenuto completo.</LimitNotice>}
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>}
    </>)}</Tabs.Content>
    <Tabs.Content value="projects" className={gh.projectTabContent}>{data && <GitHubErrorNotice error={surfaceErrors['github-data']} label="Aggiorna dati GitHub" onClick={() => refreshGitHubAfterFailure('github-data')} />}{githubDataState ?? <Splitter.Root className={cx(gh.content, gh.projectContent)} defaultFixedSize={projectSelectorWidth} onCollapse={({ panelId }) => { if (panelId === 'github-project-picker') setProjectPickerCollapsed(true) }} onExpand={({ panelId }) => { if (panelId === 'github-project-picker') setProjectPickerCollapsed(false) }} panels={githubProjectPanels} storageKey={`vincodelab.github.project-picker-width:${workspace}`}>
      <Splitter.Panel asChild id="github-project-picker"><section className={cx(gh.panel, gh.projectListPanel)}>
        <div className={gh.projectListHeading}><h2 className={cx(gh.panelTitle, gh.projectListTitle)} id="github-project-list-label"><FolderKanban size={15} /> Progetti GitHub del workspace {data && <span className={gh.panelTitleCount}>{data.projects.length}</span>}</h2>{selectedProjectDetails && <Splitter.Context>{({ collapsePanel, expandPanel }) => <Button size="sm" variant="outline" onClick={() => projectPickerCollapsed ? expandPanel('github-project-picker') : collapsePanel('github-project-picker')}>{projectPickerCollapsed ? 'Cambia Project' : 'Comprimi elenco'}</Button>}</Splitter.Context>}</div>
        {projectPickerCollapsed && selectedProjectDetails && <div className={gh.projectActive}><span className={gh.projectActiveLabel}>Project attivo</span><strong className={gh.projectActiveTitle}>{selectedProjectDetails.title}</strong></div>}
        <div className={gh.projectPickerContent({ hidden: projectPickerCollapsed })}>
        {data?.githubDiagnostic ? <GitHubErrorNotice error={surfaceErrors['github-diagnostic']} label="Aggiorna dati GitHub" onClick={() => refreshGitHubAfterFailure('github-diagnostic')} /> : !data?.repository ? <p className={gh.muted}>GitHub non è configurato per questo workspace.</p> : <>
          <p className={gh.muted}>Solo progetti collegati a <strong>{data.repository.nameWithOwner}</strong>.</p>
          {projectsLimited && <LimitNotice>Elenco Project limitato ai primi {data.projects.length} risultati collegati.</LimitNotice>}
          {data.projectsDiagnostic && <GitHubErrorNotice error={surfaceErrors['projects-diagnostic']} label="Aggiorna autorizzazioni e dati" onClick={() => refreshGitHubAfterFailure('projects-diagnostic')} />}
          <GitHubErrorNotice error={surfaceErrors.projects} label="Aggiorna Projects" onClick={() => refreshGitHubAfterFailure('projects')} />
          <div className={gh.projectCreate}><Field.Root className={gh.growField}><Field.Input aria-label="Titolo del nuovo Project" value={projectTitle} maxLength={256} placeholder="Nuovo progetto" onChange={(event) => setProjectTitle(event.target.value)} /></Field.Root><Button size="sm" disabled={busy || !projectTitle.trim()} onClick={requestCreateProject}><Plus /> Crea</Button></div>
          {data.projects.length ? <Listbox.Root className={gh.projectListboxRoot} collection={projectCollection} deselectable={false} ids={{ label: 'github-project-list-label' }} loopFocus selectionMode="single" value={selectedProject ? [String(selectedProject)] : []} onValueChange={({ items }) => { const project = items[0]; if (!project) return; setBoardItemDialogOpen(false); setSelectedBoardItemId(null); void loadBoard(project.number) }}><Listbox.Content className={gh.projectListbox}>{data.projects.map((project) => <Listbox.Item className={gh.projectItem} highlightOnHover item={project} key={project.number}><Listbox.ItemText asChild><span className={gh.projectItemContent}><span className={gh.projectItemHeader}><strong className={gh.projectItemTitle}>{project.title}</strong><span className={gh.projectItemState}>{project.closed ? 'Chiuso' : 'Aperto'}</span></span><small className={gh.projectItemDescription}>{project.shortDescription || 'Nessuna descrizione'}</small></span></Listbox.ItemText><Listbox.ItemIndicator><Check aria-hidden="true" size={14} /></Listbox.ItemIndicator></Listbox.Item>)}</Listbox.Content></Listbox.Root> : <EmptyState className={gh.projectListEmpty} description="Crea il primo Project per organizzare le attività del repository." eyebrow="Projects" icon={<FolderKanban size={26} />} title="Nessun Project collegato" />}
          {selectedProjectDetails && <div className={gh.projectManagement}>
            <h3 className={gh.projectManagementTitle}>Gestisci Project</h3>
            {editingProject?.number === selectedProjectDetails.number ? <><Field.Root><Field.Input aria-label="Titolo Project" value={projectEditTitle} maxLength={256} onChange={(event) => setProjectEditTitle(event.target.value)} /></Field.Root><Field.Root><Field.Textarea aria-label="Descrizione Project" value={projectEditDescription} maxLength={1_024} onChange={(event) => setProjectEditDescription(event.target.value)} /></Field.Root><div className={gh.projectManagementActions}><Button size="sm" disabled={busy || !projectEditTitle.trim()} onClick={requestProjectEdit}>Salva</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingProject(null)}>Annulla</Button></div></> : <div className={gh.projectManagementActions}><Button size="sm" variant="outline" disabled={busy} onClick={() => startProjectEdit(selectedProjectDetails)}>Modifica informazioni</Button><Button size="sm" tone={selectedProjectDetails.closed ? 'accent' : 'danger'} variant="outline" disabled={busy} onClick={() => requestProjectClose(selectedProjectDetails)}>{selectedProjectDetails.closed ? 'Riapri Project' : 'Chiudi Project'}</Button></div>}
          </div>}
        </>}
        </div>
      </section></Splitter.Panel>
      {!projectPickerCollapsed && <Splitter.ResizeTrigger aria-label="Ridimensiona selettore Project GitHub" className={gh.projectResize} id="github-project-picker:github-project-board" title="Trascina per ridimensionare il selettore Project. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>}
      <Splitter.Panel asChild id="github-project-board"><section aria-busy={loadingBoard} className={cx(gh.panel, gh.board)}>
        {loadingBoard && <div aria-live="polite" className={gh.boardLoading} role="status"><Spinner className={gh.boardLoadingIcon} /><strong className={gh.boardLoadingTitle}>Caricamento Project…</strong><span className={gh.boardLoadingDescription}>Sto recuperando le attività e i relativi campi da GitHub.</span></div>}
        <GitHubErrorNotice error={surfaceErrors.board} label="Ricarica board" onClick={retrySelectedBoard} />
        <h2 className={gh.panelTitle}>{board ? board.project.title : 'Board del Project'}</h2>
        {board ? <>
          <div className={gh.boardSummary}><strong className={gh.boardTotal}>{board.items.length}</strong><span className={gh.boardSummaryLabel}>{boardResultLimited ? 'attività visibili del Project' : 'attività caricate dal Project'}</span>{[...boardStatusCounts.entries()].map(([statusName, count]) => <small className={projectStatusClass(statusName)} key={statusName}>{statusName}: {count}</small>)}</div>
          {boardLimitMessages.length > 0 && <LimitNotice>{boardLimitMessages.join(' ')}</LimitNotice>}
          <div className={gh.boardToolbar}>
            <div className={gh.searchField}><Search aria-hidden="true" className={gh.searchIcon} size={14} /><Field.Root className={gh.searchFieldRoot}><Field.Input ref={boardSearchInput} className={gh.searchInput} aria-label="Cerca attività per numero, titolo o campo" value={boardSearch} placeholder="Cerca per numero, titolo o campo" onChange={(event) => setBoardSearch(event.target.value)} /></Field.Root></div>
            <div className={gh.toolbarSelect}><SelectField aria-label="Raggruppa per" options={[{ label: 'Nessun raggruppamento', value: '__none__' }, ...(board?.fields.filter((field) => projectFieldDataType(field) !== 'title').map((field) => ({ label: `Raggruppa per ${field.name}`, value: field.id })) ?? [])]} value={boardGroupFieldId || activeBoardGroupFieldId} onValueChange={setBoardGroupFieldId} /></div>
            <div className={gh.toolbarSelect}><SelectField aria-label="Filtra attività per stato" options={[{ label: 'Tutti gli stati', value: '__all__' }, ...(boardStatusField?.options?.map((option) => ({ label: option.name, value: option.name })) ?? [])]} value={boardStatusFilter || '__all__'} onValueChange={(value) => setBoardStatusFilter(value === '__all__' ? '' : value)} /></div>
            <span className={gh.boardResult}>{boardHasFilters ? `${boardItems.length} risultati` : `${boardItems.length} visibili`}</span>
          </div>
          <div className={gh.projectTable} role="table" aria-colcount={boardPriorityField ? 4 : 3} aria-label="Attività del Project">
            <div role="rowgroup"><div className={cx(gh.projectTableHead, !boardPriorityField && gh.projectTableHeadThree)} role="row"><span className={gh.tableHeaderCell} role="columnheader">Titolo</span><span className={gh.tableHeaderCell} role="columnheader">Assegnatari</span><span className={gh.tableHeaderCell} role="columnheader">Stato</span>{boardPriorityField && <span className={gh.tableHeaderCell} role="columnheader">Priorità</span>}</div></div>
            {boardItems.length ? [...boardGroups.entries()].map(([group, items]) => {
              const collapsed = collapsedBoardGroups.has(group)
              return <Collapsible.Root asChild key={group} open={!collapsed} onOpenChange={({ open }) => setCollapsedBoardGroups((current) => { const next = new Set(current); if (open) next.delete(group); else next.add(group); return next })}>
                <section className={gh.projectGroup} role="rowgroup">
                  <div className={gh.projectGroupHeadingRow} role="row"><div aria-colspan={boardPriorityField ? 4 : 3} className={gh.projectGroupHeadingCell} role="cell"><h3 className={gh.projectGroupHeading}><Collapsible.Trigger className={gh.projectGroupTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={15} /></Collapsible.Indicator><span className={gh.projectGroupLabel}>{activeBoardGroupField?.name || 'Gruppo'}:</span> <strong className={gh.projectGroupTitle}>{group}</strong> <small className={gh.projectGroupCount}>{items.length} attività</small></Collapsible.Trigger></h3></div></div>
                  <Collapsible.Content role="presentation">{orderProjectItemsByHierarchy(items).map(({ item, depth }) => <div className={gh.projectTableRow({ columns: boardPriorityField ? 'four' : 'three', selected: selectedBoardItem?.id === item.id, subissue: depth > 0 })} key={item.id} role="row">
                    <span className={gh.projectTitleCell} role="cell"><Button variant="plain" className={gh.projectTitle({ subissue: depth > 0 })} onClick={(event) => void selectBoardItem(item, event.currentTarget)} title={item.content?.title ?? item.title ?? 'Elemento senza titolo'}><strong className={gh.projectTitleText}>{depth > 0 && <GitBranch aria-hidden="true" className={gh.projectTitleIcon} size={14} />}{item.content?.title ?? item.title ?? 'Elemento senza titolo'}</strong>{item.parent && <small className={gh.projectTitleMeta}>Sub-issue di #{item.parent.number}</small>}{item.content?.number && <small className={gh.projectTitleMeta}>#{item.content.number}</small>}</Button></span>
                    <span className={cx(gh.projectCell, gh.projectAssignees)} role="cell" title={item.assignees?.join(', ') ?? ''}>{item.assignees?.length ? <>{item.assignees.slice(0, 2).map((assignee) => <span className={gh.projectAssignee} key={assignee}>{assignee.slice(0, 2).toUpperCase()}</span>)}{item.assignees.length > 2 && <small className={gh.projectAssigneeOverflow}>+{item.assignees.length - 2}</small>}</> : '—'}</span>
                    <span className={gh.projectCell} role="cell">{boardStatusField?.options?.length ? <SelectField aria-label={`Stato ${item.content?.title ?? item.title ?? 'attività'}`} placeholder="Non impostato" options={boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={boardStatusField.options.find((option) => option.name === item.status)?.id ?? ''} disabled={busy} onValueChange={(value) => { if (value) void updateBoardStatus(item, value) }} /> : <span className={projectStatusClass(item.status)}>{item.status || '—'}</span>}</span>
                    {boardPriorityField && <span className={gh.projectCell} role="cell">{item.fieldValues?.[boardPriorityField.id] ?? '—'}</span>}
                  </div>)}</Collapsible.Content>
                </section>
              </Collapsible.Root>
            }) : <div role="rowgroup"><div role="row"><div aria-colspan={boardPriorityField ? 4 : 3} className={gh.boardEmpty} role="cell"><EmptyState className={gh.boardEmptyState} description={boardHasFilters ? 'Modifica la ricerca o il filtro per vedere altre attività.' : 'Il Project non contiene ancora attività.'} eyebrow="Board" icon={<FolderKanban size={26} />} title={boardHasFilters ? 'Nessun risultato' : 'Nessuna attività'} /></div></div></div>}
          </div>
          {selectedBoardItem && <Dialog.Root finalFocusEl={() => boardItemDialogTrigger.current?.isConnected ? boardItemDialogTrigger.current : boardSearchInput.current} ids={{ title: 'github-item-modal-title' }} open={boardItemDialogOpen} onOpenChange={({ open }) => { setBoardItemDialogOpen(open); if (!open) { projectFieldRequest.current += 1; setLoadingProjectFields(false) } }} onExitComplete={() => { if (!boardItemDialogOpen) setSelectedBoardItemId(null) }}>
            <Dialog.Portal><Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content className={cx(gh.modalContent, gh.itemModal)}>
                <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Attività del Project</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-item-modal-title">{selectedBoardItem.content?.title ?? selectedBoardItem.title ?? 'Attività'}</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio attività"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
                <GitHubErrorNotice error={surfaceErrors['project-fields']} label="Riprova campi" onClick={retrySelectedProjectFields} />
                <div className={gh.itemMeta}>{selectedBoardItem.content?.number && <span className={gh.metaBadge}>#{selectedBoardItem.content.number}</span>}<span className={gh.metaBadge}>{selectedBoardItem.type === 'PULL_REQUEST' ? 'Pull request' : 'Issue'}</span>{selectedBoardItem.status && <span className={projectStatusClass(selectedBoardItem.status)}>{selectedBoardItem.status}</span>}{boardPriorityField && selectedBoardItem.fieldValues?.[boardPriorityField.id] && <span className={gh.metaBadge}>{selectedBoardItem.fieldValues[boardPriorityField.id]}</span>}</div>
                <section className={gh.itemContent}><h4 className={gh.itemContentTitle}>Descrizione</h4>{issueDetail?.body ? <MarkdownPreview source={issueDetail.body} /> : <p className={gh.muted}>Nessuna descrizione disponibile per questa attività.</p>}</section>
                {issueDetail?.bodyTruncated && <LimitNotice>Descrizione abbreviata: apri la issue su GitHub per leggere il contenuto completo.</LimitNotice>}
                {issueDetail?.labelsHasMore && <LimitNotice>Le etichette della issue sono state limitate.</LimitNotice>}
                <section className={gh.itemProperties}>
                  <div className={gh.itemProperty}><span>Assegnatari</span><strong className={gh.itemPropertyValue}>{selectedBoardItem.assignees?.length ? selectedBoardItem.assignees.join(', ') : 'Non assegnata'}</strong></div>
                  <div className={gh.itemProperty}><span>Stato</span>{boardStatusField?.options?.length ? <SelectField aria-label="Stato attività" placeholder="Seleziona stato" options={boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={boardStatusField.options.find((option) => option.name === selectedBoardItem.status)?.id ?? ''} disabled={busy} onValueChange={(value) => { if (value) void updateBoardStatus(selectedBoardItem, value) }} /> : <span className={projectStatusClass(selectedBoardItem.status)}>{selectedBoardItem.status || 'Non impostato'}</span>}</div>
                </section>
                {loadingProjectFields ? <p className={gh.muted}>Caricamento campi attività…</p> : editableBoardFields.map((field) => <Field.Root key={field.id}>
                  <Field.Label>{field.name}</Field.Label>
                  <div className={gh.projectFieldControls}><Field.Input type={projectFieldDataType(field) === 'date' ? 'date' : projectFieldDataType(field) === 'number' ? 'number' : 'text'} value={projectFieldDrafts[field.id] ?? ''} disabled={busy} onChange={(event) => setProjectFieldDrafts((current) => ({ ...current, [field.id]: event.target.value }))} /><Button size="xs" disabled={busy || !projectFieldDrafts[field.id]?.trim()} onClick={() => saveBoardField(selectedBoardItem, field)}>Salva</Button><Button size="xs" variant="outline" disabled={busy || !projectFieldValues[field.id]?.trim()} onClick={() => clearBoardField(selectedBoardItem, field)}>Svuota</Button></div>
                </Field.Root>)}
                <footer className={gh.modalFooter}><Button variant="outline" size="sm" disabled={busy} onClick={() => void archiveBoardItem(selectedBoardItem)}>Archivia attività</Button></footer>
                </Dialog.Content>
              </Dialog.Positioner>
            </Dialog.Portal>
          </Dialog.Root>}
        </> : <EmptyState className={gh.boardPlaceholder} description="Scegli un Project collegato per gestirne la board." eyebrow="Board" icon={<FolderKanban size={26} />} title="Seleziona un Project" />}
      </section></Splitter.Panel>
    </Splitter.Root>}</Tabs.Content>
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
  </div></Tabs.Root>
}
