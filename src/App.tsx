import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { BookOpen, Boxes, ChevronDown, ChevronRight, ChevronUp, Database, FileCode2, FolderOpen, GitFork, LayoutGrid, List, RefreshCw, ScrollText, Search, Settings, TerminalSquare, X } from 'lucide-react'
import { Button, ErrorNotice, Field, IconButton, SegmentGroup, Spinner, Tabs, Toaster, WorkbenchPresence, toast } from '@/components/ui'
import { TerminalToolbar } from '@/components/terminal-toolbar'
import { TerminalAttachments, type TerminalContextAction } from '@/components/terminal-attachments'
import { TerminalPasteStatus } from '@/components/terminal-paste-status'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { BenchmarkViewFaultProbe } from '@/components/benchmark-view-fault-probe'
import { WorkspaceChangeDialog } from '@/components/workspace-change-dialog'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { CommandPalette, type CommandPaletteItem, type CommandPaletteMode } from '@/components/command-palette'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { createAnimationFrameResizeScheduler } from '@/lib/terminal-resize.js'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '@/lib/terminal-preferences.js'
import { shouldFollowTerminalOutput } from '@/lib/terminal-viewport.js'
import { observeXtermTheme, readXtermTheme } from '@/lib/xterm-theme'
import { effectivePreference, setAppPreferencesWorkspace, terminalFontFamily, useAppPreferences } from '@/lib/app-preferences'
import { dispatchApplicationMenuCommand } from '@/lib/app-menu-command'
import { createXtermOutputController } from '@/lib/xterm-output-controller.js'
import type { XtermOutputController } from '@/lib/xterm-output-controller.js'
import { createTerminalPasteController } from '@/lib/terminal-paste-controller.js'
import type { TerminalPasteProgress } from '@/lib/terminal-paste-controller.js'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { WorkbenchCommandRegistry, type WorkbenchCommand } from '@/lib/workbench-command-registry'
import { WorkbenchUsageHistory } from '@/lib/workbench-history'
import { createWorkspaceSessionClient } from '@/lib/workspace-session'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'
import { createPersistentViewState, shouldMountPersistentView, visitPersistentView } from '@/lib/persistent-view-state'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import type { EditorWorkbenchContext, EditorWorkbenchRequest, RemoteOpenRequest } from '@/components/project-editor'
import type { GitHubWorkbenchContext, GitHubWorkbenchRequest } from '@/components/github-workspace'
import type { DatabaseWorkbenchContext } from '@/components/database-workspace'
import type { RedisWorkbenchContext } from '@/components/redis-workspace'
import type { TerminalWorkspaceAction, TerminalWorkspaceActionRequest } from '@/components/terminal-workspace'
import { aiStyles } from '@/theme/styles/ai'
import { homeStyles } from '@/theme/styles/home'
import { shellStyles } from '@/theme/styles/shell'
import { terminalStyles } from '@/theme/styles/terminal'
import '@xterm/xterm/css/xterm.css'

// In sviluppo la pagina è servita da Vite; nella build Electron è un file locale.
// Risolvendo dall'URL della pagina l'icona rimane disponibile in entrambi i contesti.
const appIconUrl = new URL('vincodelab-icon.png', window.location.href).toString()

const TerminalWorkspace = lazy(() => import('@/components/terminal-workspace').then((module) => ({ default: module.TerminalWorkspace })))
const ProjectEditor = lazy(() => import('@/components/project-editor').then((module) => ({ default: module.ProjectEditor })))
const GitHubWorkspace = lazy(() => import('@/components/github-workspace').then((module) => ({ default: module.GitHubWorkspace })))
const DatabaseWorkspace = lazy(() => import('@/components/database-workspace').then((module) => ({ default: module.DatabaseWorkspace })))
const RedisWorkspace = lazy(() => import('@/components/redis-workspace').then((module) => ({ default: module.RedisWorkspace })))
const AppSettings = lazy(() => import('@/components/settings').then((module) => ({ default: module.Settings })))
const ProjectSkills = lazy(() => import('@/components/project-skills').then((module) => ({ default: module.ProjectSkills })))
const ProjectInstructions = lazy(() => import('@/components/project-instructions').then((module) => ({ default: module.ProjectInstructions })))

type LaunchState = 'idle' | 'launching' | 'running' | 'ended' | 'error'
type WorkspaceChangeRequest = { kind: 'choose' } | { kind: 'recent'; path: string }
type WorkspaceOpenFailure = { request: WorkspaceChangeRequest; error: UserError }
type WorkspaceSessionFailure = { error: UserError; kind: 'corrupt' | 'persistence' }
type HomeFailure = { error: UserError; recovery: 'open-workspace' | 'refresh-recents' }
type AiFailureRecovery = 'reload' | 'restart' | 'resume-output' | 'retry-terminal' | 'settings'
type AiFailureContext = {
  category?: UserError['category']
  code?: string
  correlationId?: string
  fallbackDescription: string
  operation: string
  preserved: string
  recovery: AiFailureRecovery
  severity?: UserError['severity']
  title: string
}
type AiSessionFailure = {
  error: UserError
  primaryRecovery: AiFailureRecovery
  secondaryRecovery?: AiFailureRecovery
}
type AiFailureAction = { label: string; onClick: () => void | Promise<void>; pendingLabel?: string }
type AiInputFailureContext = { description: string; operation: string; title: string }
type TerminalPasteFailureRecovery = 'retry-paste' | 'retry-cancel' | 'restart-ai' | 'none'
type TerminalPasteFailure = { error: UserError; recovery: TerminalPasteFailureRecovery }
type WorkspaceGuardScope = 'editor' | 'skills' | 'instructions' | 'database' | 'settings'
type AppSection = 'ai' | 'terminal' | 'editor' | 'github' | 'database' | 'redis' | 'settings'
type WorkbenchCommandContext = {
  hasWorkspace: boolean
  section: AppSection
  aiTab: 'terminal' | 'skills' | 'instructions'
  editor: EditorWorkbenchContext
  github: GitHubWorkbenchContext
  database: DatabaseWorkbenchContext
  redis: RedisWorkbenchContext
}

type FitAddonInstance = { fit: () => void }

type SearchAddonInstance = {  clearDecorations: () => void
  findNext: (term: string, options?: { incremental?: boolean }) => boolean
  findPrevious: (term: string) => boolean
}

const emptyEditorContext: EditorWorkbenchContext = { activeFileId: null, activeFileName: null, dirty: false, source: null, selection: null }
const emptyGitHubContext: GitHubWorkbenchContext = { tab: 'changes', branch: null, changedFiles: [], selectedDiffPath: null }
const emptyDatabaseContext: DatabaseWorkbenchContext = { connectionId: null, connectionName: null, executing: false, sql: '', tableName: null, transactionActive: false }
const emptyRedisContext: RedisWorkbenchContext = { connectionId: null, searching: false }

function workspaceName(workspacePath: string) {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}

function formatLastOpened(timestamp: number) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function compactContextText(value: string, maxLength = 1_600) {
  const compact = value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact
}

function reportRendererFailure(error: unknown, options: Parameters<typeof normalizeUserError>[1]) {
  return reportUserError(normalizeUserError(error, options))
}

function showUserErrorToast(error: UserError, recoveryAction?: { label: string; onClick: () => void }) {
  const description = `${error.description} Riferimento ${error.correlationId}.`
  const dedupeKey = `${error.component ?? 'renderer'}:${error.operation ?? error.category}:${error.code ?? ''}`
  if (error.severity === 'info') {
    toast.info(error.title, { dedupeKey, description, recoveryAction })
    return
  }
  if (error.severity === 'warning') {
    toast.warning(error.title, { dedupeKey, description, recoveryAction })
    return
  }
  toast.error(error.title, {
    dedupeKey,
    description,
    recoveryAction,
  })
}

function reportTransientFailure(
  error: unknown,
  options: Parameters<typeof normalizeUserError>[1],
  recoveryAction?: { label: string; onClick: () => void },
) {
  const incident = reportRendererFailure(error, options)
  showUserErrorToast(incident, recoveryAction)
  return incident
}

function reportTerminalPasteFailure(progress: TerminalPasteProgress): TerminalPasteFailure {
  const reason = progress.reason ?? 'incomplete'
  const context = reason === 'too-large'
    ? {
        category: 'validation' as const,
        code: 'AI_PASTE_TOO_LARGE',
        description: 'Il contenuto supera il limite di sicurezza e non è stato inviato. Riducilo negli appunti e riprova.',
        recovery: 'none' as const,
        title: 'Contenuto troppo grande',
      }
    : reason === 'not-running'
      ? {
          category: 'process' as const,
          code: 'AI_SESSION_NOT_RUNNING',
          description: 'La sessione AI non è disponibile. Il contenuto è rimasto negli appunti e puoi riavviare la sessione.',
          recovery: 'restart-ai' as const,
          title: 'Sessione AI non disponibile',
        }
      : reason === 'busy'
        ? {
            category: 'conflict' as const,
            code: 'AI_PASTE_ALREADY_RUNNING',
            description: 'È già in corso un altro incolla. Il nuovo contenuto non è stato inviato e puoi riprovare quando termina.',
            recovery: 'retry-paste' as const,
            title: 'Incolla già in corso',
          }
        : reason === 'cancel-unavailable'
          ? {
              category: 'process' as const,
              code: 'AI_PASTE_CANCEL_UNCONFIRMED',
              description: 'L’invio locale è stato fermato, ma la sessione AI non ha confermato l’annullamento. I blocchi già trasferiti potrebbero essere presenti nel prompt.',
              recovery: 'retry-cancel' as const,
              title: 'Annullamento non confermato',
            }
          : {
              category: 'process' as const,
              code: 'AI_PASTE_INCOMPLETE',
              description: 'Il trasferimento non è stato completato. Il contenuto non inviato è rimasto negli appunti e puoi riprovare.',
              recovery: 'retry-paste' as const,
              title: 'Contenuto non incollato',
            }
  const cause = progress.error ?? new Error(`Terminal paste ${reason} [${context.code}]`)
  return {
    error: reportRendererFailure(cause, {
      category: context.category,
      code: context.code,
      component: 'ai-terminal',
      description: context.description,
      operation: reason === 'cancel-unavailable' ? 'cancel-terminal-paste' : 'paste-terminal-content',
      recoverable: context.recovery !== 'none',
      title: context.title,
    }),
    recovery: context.recovery,
  }
}

function terminalPasteRecoveryLabel(recovery: TerminalPasteFailureRecovery) {
  if (recovery === 'retry-cancel') return 'Riprova annullamento'
  if (recovery === 'restart-ai') return 'Riavvia sessione'
  return 'Riprova incolla'
}

function normalizeAiSessionFailure(cause: unknown, context: AiFailureContext): AiSessionFailure {
  const classified = normalizeUserError(cause, {
    category: context.category,
    code: context.code,
    component: 'ai-terminal',
    correlationId: context.correlationId,
    operation: context.operation,
    severity: context.severity,
  })
  const signature = `${classified.code ?? ''} ${classified.technicalMessage}`
  const piMissing = classified.code === 'PI_NOT_INSTALLED'
  const rateLimited = /RATE.?LIMIT|TOO_MANY_REQUESTS|\b429\b/iu.test(signature)
  const configurationRequired = classified.category === 'authentication'
    || classified.category === 'configuration'
    || classified.category === 'permission'
    || piMissing
    || /CONFIG|CREDENTIAL|API.?KEY|TOKEN_(?:EXPIRED|INVALID|MISSING)|NOT_CONFIGURED/iu.test(signature)
  const providerFailure = /PROVIDER|MODEL|UPSTREAM|AI_API|API_(?:FAILURE|UNAVAILABLE)/iu.test(signature)
  const category = configurationRequired
    ? 'configuration' as const
    : providerFailure && (classified.category === 'internal' || classified.category === 'persistence')
      ? 'network' as const
      : classified.category === 'internal' || classified.category === 'persistence'
        ? 'process' as const
        : classified.category
  const copy = classified.category === 'cancelled'
    ? {
        description: `L’operazione AI è stata annullata. ${context.preserved}`,
        title: 'Operazione AI annullata',
      }
    : piMissing
      ? {
          description: `Pi Coding Agent non è installato o non è rilevabile. ${context.preserved} Editor, Terminale locale, GitHub, Database e Redis restano disponibili. Installa Pi, quindi aggiorna la verifica nelle Impostazioni.`,
          title: 'Pi Coding Agent non installato',
        }
      : rateLimited
      ? {
          description: `Il provider sta limitando temporaneamente le richieste. ${context.preserved} Attendi qualche minuto prima di riprovare.`,
          title: 'Limite del provider AI raggiunto',
        }
      : configurationRequired
        ? {
            description: `La configurazione del runtime o del provider AI non consente di continuare. ${context.preserved} Apri le Impostazioni per verificarla.`,
            title: 'Configurazione AI da completare',
          }
        : classified.category === 'timeout'
          ? {
              description: `La sessione AI non ha risposto entro il tempo disponibile. ${context.preserved}`,
              title: 'Sessione AI senza risposta',
            }
          : providerFailure
            ? {
                description: `Il provider AI non ha completato la richiesta. ${context.preserved} Controlla lo stato del provider e riprova.`,
                title: 'Provider AI non disponibile',
              }
            : { description: `${context.fallbackDescription} ${context.preserved}`, title: context.title }
  const error = normalizeUserError(cause, {
    category,
    code: classified.code,
    component: 'ai-terminal',
    correlationId: classified.correlationId,
    description: copy.description,
    operation: context.operation,
    severity: context.severity ?? (classified.category === 'cancelled' ? 'info' : classified.severity),
    title: copy.title,
  })
  return {
    error,
    primaryRecovery: configurationRequired ? 'settings' : context.recovery,
    secondaryRecovery: configurationRequired && context.recovery !== 'settings' ? context.recovery : undefined,
  }
}

function sameAiSessionFailure(left: AiSessionFailure | null, right: AiSessionFailure) {
  return Boolean(left
    && left.error.category === right.error.category
    && left.error.code === right.error.code
    && left.error.operation === right.error.operation
    && left.error.title === right.error.title)
}

function AiSessionErrorNotice({ failure, onOpenSettings, onReload, onRestart, onResumeOutput, onRetryTerminal }: {
  failure: AiSessionFailure
  onOpenSettings: () => void
  onReload: () => Promise<void>
  onRestart: () => Promise<void>
  onResumeOutput: () => Promise<void>
  onRetryTerminal: () => void
}) {
  const actionFor = (recovery: AiFailureRecovery): AiFailureAction => {
    if (recovery === 'settings') return { label: 'Apri impostazioni', onClick: onOpenSettings }
    if (recovery === 'reload') return { label: 'Riprova', pendingLabel: 'Ricaricamento…', onClick: onReload }
    if (recovery === 'resume-output') return { label: 'Riprova', pendingLabel: 'Collegamento output…', onClick: onResumeOutput }
    if (recovery === 'retry-terminal') return { label: 'Riprova', pendingLabel: 'Preparazione terminale…', onClick: onRetryTerminal }
    return {
      label: failure.error.operation === 'start-ai-session' ? 'Riprova avvio' : 'Riavvia',
      pendingLabel: 'Riavvio sessione…',
      onClick: onRestart,
    }
  }
  return <ErrorNotice
    action={actionFor(failure.primaryRecovery)}
    error={failure.error}
    secondaryAction={failure.secondaryRecovery ? actionFor(failure.secondaryRecovery) : undefined}
  />
}

function reportWorkspaceResultError(result: WorkspaceOpenResult, fallback: string) {
  if (!result.error) return null
  return reportRendererFailure(result.errorIncident ?? new Error(result.error), {
    component: 'workspace-shell',
    operation: result.path ? 'start-ai-session' : 'open-workspace',
    title: result.path ? 'Sessione AI non disponibile' : 'Workspace non aperto',
    fallbackDescription: fallback,
  })
}

function primaryFocusTarget(section: AppSection, aiTab: 'terminal' | 'skills' | 'instructions'): WorkspaceSessionFocusTarget {
  if (section === 'ai') return `ai.${aiTab}`
  if (section === 'editor') return 'editor.code'
  if (section === 'terminal') return 'terminal.shell'
  if (section === 'github') return 'github.changes'
  if (section === 'database') return 'database.query'
  if (section === 'redis') return 'redis.keys'
  return 'settings.primary'
}

function App() {
  const { preferences: appPreferences } = useAppPreferences()
  const workspaceSessionMounted = useRef(false)
  const [commandRegistry] = useState(() => new WorkbenchCommandRegistry<WorkbenchCommandContext>({
    hasWorkspace: false,
    section: 'ai',
    aiTab: 'terminal',
    editor: emptyEditorContext,
    github: emptyGitHubContext,
    database: emptyDatabaseContext,
    redis: emptyRedisContext,
  }))
  const [usageHistory] = useState(() => new WorkbenchUsageHistory())
  const [commandRegistryRevision, setCommandRegistryRevision] = useState(0)
  const [usageHistoryRevision, setUsageHistoryRevision] = useState(0)
  const preferredTerminalFontSize = effectivePreference(appPreferences, 'terminal.fontSize', 11)
  const preferredTerminalFontFamily = effectivePreference(appPreferences, 'terminal.fontFamily', 'system-mono')
  const preferredTerminalCursorStyle = effectivePreference(appPreferences, 'terminal.cursorStyle', 'bar') as 'bar' | 'block' | 'underline'
  const preferredTerminalScrollback = effectivePreference(appPreferences, 'terminal.scrollback', 10_000)
  const terminalElement = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const outputController = useRef<XtermOutputController | null>(null)
  const fitAddon = useRef<FitAddonInstance | null>(null)
  const searchAddon = useRef<SearchAddonInstance | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentWorkspace[]>([])
  const [openingWorkspacePath, setOpeningWorkspacePath] = useState<string | null>(null)
  const [workspaceOpenFailure, setWorkspaceOpenFailure] = useState<WorkspaceOpenFailure | null>(null)
  const [status, setStatus] = useState<LaunchState>('idle')
  const [homeFailure, setHomeFailure] = useState<HomeFailure | null>(null)
  const aiFailureRef = useRef<AiSessionFailure | null>(null)
  const [aiFailure, setAiFailure] = useState<AiSessionFailure | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false)
  const [terminalQuery, setTerminalQuery] = useState('')
  const [fontSize, setFontSize] = useState(11)
  const hasUnreadTerminalOutputRef = useRef(false)
  const [hasUnreadTerminalOutput, setHasUnreadTerminalOutput] = useState(false)
  const streamStateIdentityRef = useRef('')
  const [streamState, setStreamState] = useState<TerminalStreamState | null>(null)
  const [pasteProgress, setPasteProgress] = useState<TerminalPasteProgress | null>(null)
  const [pasteFailure, setPasteFailure] = useState<TerminalPasteFailure | null>(null)
  const [pasteController] = useState(() => createTerminalPasteController({
    startPaste: window.vincodeLab.terminal.startPaste,
    writePasteChunk: window.vincodeLab.terminal.writePasteChunk,
    cancelPaste: window.vincodeLab.terminal.cancelPaste,
  }))
  const [terminalRendererGeneration, setTerminalRendererGeneration] = useState(0)
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system')
  const [aiTab, setAiTab] = useState<'terminal' | 'skills' | 'instructions'>('terminal')
  const [appSection, setAppSection] = useState<AppSection>('ai')
  const [settingsRuntimeRequest, setSettingsRuntimeRequest] = useState(0)
  const [loadedSections, setLoadedSections] = useState(createPersistentViewState)
  const [editorContext, setEditorContext] = useState<EditorWorkbenchContext>(emptyEditorContext)
  const [githubContext, setGitHubContext] = useState<GitHubWorkbenchContext>(emptyGitHubContext)
  const [databaseContext, setDatabaseContext] = useState<DatabaseWorkbenchContext>(emptyDatabaseContext)
  const [redisContext, setRedisContext] = useState<RedisWorkbenchContext>(emptyRedisContext)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState<CommandPaletteMode>('commands')
  const [indexedFiles, setIndexedFiles] = useState<ProjectFileIndexEntry[]>([])
  const [indexingFiles, setIndexingFiles] = useState(false)
  const [workspaceSessionState, setWorkspaceSessionState] = useState<WorkspaceSessionState | null>(null)
  const [workspaceSessionRecovery, setWorkspaceSessionRecovery] = useState<WorkspaceSessionFailure | null>(null)
  const [workspaceSession] = useState(() => createWorkspaceSessionClient({ onError: (nextError) => {
    setWorkspaceSessionRecovery({
      error: reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-shell',
        operation: 'save-layout',
        severity: 'warning',
        title: 'Layout del workspace non salvato',
        description: 'La disposizione corrente resta attiva, ma non è stata salvata. Puoi riprovare senza perdere file o modifiche.',
      }),
      kind: 'persistence',
    })
  } }))
  const [editorWorkbenchRequest, setEditorWorkbenchRequest] = useState<EditorWorkbenchRequest | null>(null)
  const [githubWorkbenchRequest, setGitHubWorkbenchRequest] = useState<GitHubWorkbenchRequest | null>(null)
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0)
  const [terminalActionRequest, setTerminalActionRequest] = useState<TerminalWorkspaceActionRequest | undefined>()
  const [databaseFocusRequest, setDatabaseFocusRequest] = useState(0)
  const [redisFocusRequest, setRedisFocusRequest] = useState(0)
  const [remoteOpenRequest, setRemoteOpenRequest] = useState<RemoteOpenRequest | null>(null)
  const [workspaceChangeRequest, setWorkspaceChangeRequest] = useState<WorkspaceChangeRequest | null>(null)
  const [savingBeforeWorkspaceChange, setSavingBeforeWorkspaceChange] = useState(false)
  const [lifecycleCloseRequest, setLifecycleCloseRequest] = useState<LifecycleCloseRequest | null>(null)
  const [savingBeforeLifecycleClose, setSavingBeforeLifecycleClose] = useState(false)
  const workspaceChangeGuards = useRef(new Map<WorkspaceGuardScope, WorkspaceChangeGuard>())
  const workspaceChangeGuard = useRef<WorkspaceChangeGuard>({
    hasUnsavedChanges: () => [...workspaceChangeGuards.current.values()].some((guard) => guard.hasUnsavedChanges()),
    saveAll: async () => {
      for (const guard of workspaceChangeGuards.current.values()) await guard.saveAll()
    },
    discardAll: async () => {
      for (const guard of workspaceChangeGuards.current.values()) await guard.discardAll()
    },
  })
  const remoteOpenNonce = useRef(0)
  const workbenchRequestNonce = useRef(0)
  const fileIndexRequest = useRef(0)
  const fontSizeRef = useRef(fontSize)
  const workspaceOpenGeneration = useRef(0)
  const activeLifecycleCloseRequest = useRef<LifecycleCloseRequest | null>(null)
  const lifecycleCloseOperation = useRef<string | null>(null)
  const respondedLifecycleCloseRequests = useRef(new Set<string>())
  // Tutte le richieste sovrapposte condividono lo stato precedente alla prima:
  // un completamento superato non può lasciare la UI in stato “in avvio”.
  const workspaceStateBeforeOpen = useRef<{ status: LaunchState; homeFailure: HomeFailure | null; aiFailure: AiSessionFailure | null } | null>(null)

  const clearAiFailure = useCallback((operation?: string) => {
    const current = aiFailureRef.current
    if (!current || (operation && current.error.operation !== operation)) return
    aiFailureRef.current = null
    setAiFailure(null)
  }, [])

  const publishAiFailure = useCallback((cause: unknown, context: AiFailureContext) => {
    const next = normalizeAiSessionFailure(cause, context)
    if (sameAiSessionFailure(aiFailureRef.current, next)) return aiFailureRef.current!
    const incident = { ...next, error: reportUserError(next.error) }
    aiFailureRef.current = incident
    setAiFailure(incident)
    return incident
  }, [])

  const showEndedAiSession = useCallback(() => {
    const notice: AiSessionFailure = {
      error: normalizeUserError(new Error('La sessione Pi è terminata normalmente.'), {
        category: 'process',
        code: 'AI_SESSION_ENDED',
        component: 'ai-terminal',
        description: 'La sessione AI è terminata normalmente. L’output resta disponibile e puoi riavviarla quando vuoi.',
        operation: 'session-exit',
        severity: 'info',
        title: 'Sessione AI terminata',
      }),
      primaryRecovery: 'restart',
    }
    aiFailureRef.current = notice
    setAiFailure(notice)
  }, [])

  const refreshRecents = useCallback(async () => {
    try {
      setRecents(await window.vincodeLab.workspace.listRecent())
      setHomeFailure(null)
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-home',
        operation: 'list-recent-workspaces',
        title: 'Workspace recenti non disponibili',
        description: 'Puoi comunque scegliere una cartella oppure aggiornare nuovamente l’elenco.',
      })
      setHomeFailure({ error: incident, recovery: 'refresh-recents' })
    }
  }, [])

  const patchWorkspaceSession = useCallback((updater: (state: Readonly<WorkspaceSessionState>) => WorkspaceSessionState) => {
    if (!workspaceSession.getSnapshot().loaded) return
    workspaceSession.patch(updater)
  }, [workspaceSession])

  const recoverWorkspaceSession = useCallback(async () => {
    if (!workspaceSessionRecovery || workspaceSessionRecovery.kind === 'corrupt') {
      setWorkspaceSessionRecovery(null)
      return
    }
    try {
      await workspaceSession.flush()
      setWorkspaceSessionRecovery(null)
    } catch {
      // Il client conserva la sessione dirty e onError aggiorna questo stesso avviso
      // con il nuovo correlation ID, senza una seconda notifica.
    }
  }, [workspaceSession, workspaceSessionRecovery])

  useEffect(() => commandRegistry.subscribe(() => setCommandRegistryRevision((current) => current + 1)), [commandRegistry])
  useEffect(() => usageHistory.subscribe(() => setUsageHistoryRevision((current) => current + 1)), [usageHistory])

  useEffect(() => {
    workspaceSessionMounted.current = true
    return () => {
      workspaceSessionMounted.current = false
      // StrictMode esegue un cleanup di prova e rimonta subito lo stesso App:
      // rinviare di una microtask distingue quel ciclo da un vero unmount.
      queueMicrotask(() => {
        if (workspaceSessionMounted.current) return
        void workspaceSession.flush().catch((nextError) => {
          // L'app sta uscendo e non esiste più una superficie sicura: resta un evento diagnostico, non un toast tardivo.
          reportRendererFailure(nextError, {
            category: 'persistence',
            component: 'workspace-shell',
            operation: 'flush-on-unmount',
            severity: 'warning',
            title: 'Sessione workspace non salvata',
            fallbackDescription: 'La chiusura è proseguita senza salvare l’ultima disposizione.',
          })
        }).finally(() => {
          if (!workspaceSessionMounted.current) workspaceSession.dispose()
        })
      })
    }
  }, [workspaceSession])

  useEffect(() => {
    let active = true
    void window.vincodeLab.appearance.get().then((value) => {
      if (active) setAppearance(value)
    }).catch((nextError) => {
      // L'app resta utilizzabile con il tema di sistema anche se la preferenza non è disponibile.
      const incident = reportRendererFailure(nextError, {
        category: 'configuration',
        component: 'appearance',
        operation: 'load-theme',
        severity: 'warning',
        title: 'Tema salvato non disponibile',
        description: 'È stato applicato il tema di sistema. Puoi verificare la preferenza nelle Impostazioni.',
      })
      showUserErrorToast(incident, {
        label: 'Apri impostazioni',
        onClick: () => {
          setAppSection('settings')
          setLoadedSections((current) => visitPersistentView(current, 'settings'))
        },
      })
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance
    document.documentElement.style.colorScheme = appearance === 'system' ? 'light dark' : appearance
  }, [appearance])

  useEffect(() => {
    if (!workspace) return
    const snapshot = workspaceSession.getSnapshot()
    if (!snapshot.loaded) return
    const section = appSection
    if (
      snapshot.state.navigation.section === section
      && snapshot.state.navigation.aiTab === aiTab
      && snapshot.state.focus.view === section
      && snapshot.state.focus.target === primaryFocusTarget(section, aiTab)
    ) return
    workspaceSession.patch((current) => ({
      ...current,
      navigation: { section, aiTab },
      focus: { view: section, target: primaryFocusTarget(section, aiTab) },
    }))
  }, [aiTab, appSection, workspace, workspaceSession])

  const changeAppearance = async (value: 'system' | 'light' | 'dark') => {
    try {
      setAppearance(await window.vincodeLab.appearance.set(value))
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'configuration',
        component: 'appearance',
        operation: 'set-theme',
        title: 'Aspetto non aggiornato',
        description: 'Il tema precedente è rimasto attivo. Puoi riprovare senza perdere altre preferenze.',
      }, { label: 'Riprova', onClick: () => { void changeAppearance(value) } })
    }
  }

  const persistAiTerminalPreferences = useCallback(function persistAiTerminalPreferencesAction(workspacePath: string, nextFontSize: number) {
    writeTerminalPreferences(workspacePath, { fontSize: nextFontSize, followOutput: true }, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'save-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non salvate',
          description: 'La nuova dimensione resta attiva in questa sessione, ma potrebbe non essere ripristinata alla prossima apertura.',
        }, { label: 'Salva di nuovo', onClick: () => { persistAiTerminalPreferencesAction(workspacePath, nextFontSize) } })
      },
    })
  }, [])

  const loadAiTerminalPreferences = useCallback(function loadAiTerminalPreferencesAction(workspacePath: string) {
    const preferences = readTerminalPreferences(workspacePath, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'load-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non caricate',
          description: 'È stata applicata la dimensione predefinita. La sessione e l’output sono rimasti disponibili.',
        }, { label: 'Carica di nuovo', onClick: () => { loadAiTerminalPreferencesAction(workspacePath) } })
      },
    })
    fontSizeRef.current = preferences.fontSize
    setFontSize(preferences.fontSize)
    if (terminal.current) terminal.current.options.fontSize = preferences.fontSize
    fitAddon.current?.fit()
  }, [])

  const changeFontSize = useCallback((delta: number) => {
    const next = nextTerminalFontSize(fontSizeRef.current, delta)
    fontSizeRef.current = next
    setFontSize(next)
    if (workspace) persistAiTerminalPreferences(workspace, next)
  }, [persistAiTerminalPreferences, workspace])

  const copyTerminalSelection = useCallback(async function copyTerminalSelectionAction() {
    const selection = terminal.current?.getSelection() ?? ''
    if (!selection) {
      toast.info('Nessun testo selezionato nel terminale.')
      return
    }
    try {
      await navigator.clipboard.writeText(selection)
      toast.success('Testo del terminale copiato.')
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'permission',
        component: 'ai-terminal',
        operation: 'copy-selection',
        title: 'Appunti non disponibili',
        fallbackDescription: 'macOS non ha consentito di copiare la selezione. Verifica i permessi e riprova.',
      })
      showUserErrorToast(incident, { label: 'Riprova', onClick: () => { void copyTerminalSelectionAction() } })
    }
  }, [])

  const clearTerminal = useCallback(() => {
    terminal.current?.clear()
    terminal.current?.focus()
    toast.info('Vista del terminale pulita.')
  }, [])

  const reloadPi = useCallback(async function reloadPiAction() {
    try {
      await window.vincodeLab.pi.reload()
      // Pi ridisegna il proprio footer dopo /reload: il PTY deve ricevere la geometria
      // della superficie ormai stabilizzata, non quella precedente al repaint.
      const refitAfterReload = () => {
        const xterm = terminal.current
        if (!xterm) return
        fitAddon.current?.fit()
        window.vincodeLab.terminal.resize({ cols: xterm.cols, rows: xterm.rows })
      }
      scheduleVisibleTerminalRefit(refitAfterReload)
      // Il renderer di Pi completa il proprio layout dopo il comando. Un secondo fit
      // copre il caso in cui xterm non aveva ancora misurato la dimensione della cella.
      window.setTimeout(refitAfterReload, 160)
      clearAiFailure('reload-ai-resources')
      toast.success('Pi sta ricaricando skill, prompt ed estensioni.')
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'reload-ai-resources',
        preserved: 'La sessione corrente e l’output già disponibile sono rimasti invariati.',
        recovery: 'reload',
        title: 'Risorse AI non ricaricate',
        fallbackDescription: 'Non è stato possibile ricaricare skill, prompt ed estensioni.',
      })
    }
  }, [clearAiFailure, publishAiFailure])

  const restartPi = useCallback(async () => {
    setStatus('launching')
    try {
      await window.vincodeLab.pi.restart()
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restart-ai-session',
        preserved: 'L’output precedente è rimasto disponibile.',
        recovery: 'restart',
        title: 'Sessione AI non riavviata',
        fallbackDescription: 'Non è stato possibile riavviare la sessione AI.',
      })
      setStatus('error')
      return
    }
    setStatus('running')
    clearAiFailure()
    const controller = outputController.current
    if (!controller) {
      publishAiFailure(new Error('AI output controller unavailable [AI_OUTPUT_CONTROLLER_UNAVAILABLE]'), {
        operation: 'initialize-ai-terminal',
        preserved: 'La sessione è stata riavviata e il workspace resta disponibile.',
        recovery: 'retry-terminal',
        title: 'Sessione riavviata, terminale non disponibile',
        fallbackDescription: 'Il collegamento visivo alla sessione AI deve essere preparato nuovamente.',
      })
      return
    }
    try {
      await controller.reconnect(() => window.vincodeLab.terminal.resume({}))
      toast.success('Sessione Pi riavviata')
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restore-ai-output',
        preserved: 'La sessione è stata riavviata e l’output precedente è rimasto visibile.',
        recovery: 'resume-output',
        title: 'Sessione riavviata, output non collegato',
        fallbackDescription: 'La sessione è attiva, ma il collegamento al nuovo output non è stato ripristinato.',
      })
    }
  }, [clearAiFailure, publishAiFailure])

  const retryAiOutput = useCallback(async () => {
    const controller = outputController.current
    if (!controller) {
      publishAiFailure(new Error('AI output controller unavailable [AI_OUTPUT_CONTROLLER_UNAVAILABLE]'), {
        operation: 'initialize-ai-terminal',
        preserved: 'Il workspace e l’output già visibile sono rimasti disponibili.',
        recovery: 'retry-terminal',
        title: 'Terminale AI non disponibile',
        fallbackDescription: 'Il collegamento alla sessione AI deve essere preparato nuovamente.',
      })
      return
    }
    const attemptedFailure = aiFailureRef.current
    try {
      await controller.reconnect(() => window.vincodeLab.terminal.resume({}))
      if (aiFailureRef.current === attemptedFailure) clearAiFailure()
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restore-ai-output',
        preserved: 'L’output già visibile è rimasto disponibile.',
        recovery: 'resume-output',
        title: 'Output della sessione AI non collegato',
        fallbackDescription: 'Il collegamento all’output della sessione non è stato ripristinato.',
      })
    }
  }, [clearAiFailure, publishAiFailure])

  const retryAiTerminal = useCallback(() => {
    setStatus('launching')
    setTerminalRendererGeneration((value) => value + 1)
  }, [])

  const openAiSettings = useCallback(() => {
    setSettingsRuntimeRequest((current) => current + 1)
    setAppSection('settings')
    setLoadedSections((current) => visitPersistentView(current, 'settings'))
  }, [])

  const pasteIntoTerminal = useCallback(async function pasteIntoTerminalAction() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        setPasteProgress(null)
        setPasteFailure(null)
        toast.info('Gli appunti non contengono testo da incollare.')
        return
      }
      setPasteFailure(null)
      const result = await pasteController.send(text, setPasteProgress)
      if (result.status === 'complete' || result.status === 'cancelled') {
        setPasteProgress(null)
        setPasteFailure(null)
        terminal.current?.focus()
        return
      }
      if (result.status === 'failed') {
        setPasteProgress(result)
        setPasteFailure(reportTerminalPasteFailure(result))
      }
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'permission',
        component: 'ai-terminal',
        operation: 'paste-clipboard',
        title: 'Appunti non disponibili',
        description: 'macOS non ha consentito di leggere gli appunti. Il prompt è rimasto invariato; verifica i permessi e riprova.',
      })
      setPasteProgress({ error: nextError, reason: 'clipboard-unavailable', sentBytes: 0, status: 'failed', totalBytes: 0 })
      setPasteFailure({ error: incident, recovery: 'retry-paste' })
    }
  }, [pasteController])

  const cancelTerminalPaste = useCallback(async () => {
    try {
      const result = await pasteController.cancel(setPasteProgress)
      if (result.status === 'failed') {
        setPasteProgress(result)
        setPasteFailure(reportTerminalPasteFailure(result))
        return
      }
      setPasteProgress(null)
      setPasteFailure(null)
    } catch (nextError) {
      const result: TerminalPasteProgress = {
        error: nextError,
        reason: 'cancel-unavailable',
        sentBytes: pasteProgress?.sentBytes ?? 0,
        status: 'failed',
        totalBytes: pasteProgress?.totalBytes ?? 0,
      }
      setPasteProgress(result)
      setPasteFailure(reportTerminalPasteFailure(result))
    }
  }, [pasteController, pasteProgress])

  const recoverTerminalPaste = useCallback(async () => {
    const recovery = pasteFailure?.recovery
    if (recovery === 'retry-cancel') {
      await cancelTerminalPaste()
      return
    }
    if (recovery === 'restart-ai') {
      setPasteProgress(null)
      setPasteFailure(null)
      await restartPi()
      return
    }
    if (recovery === 'retry-paste') await pasteIntoTerminal()
  }, [cancelTerminalPaste, pasteFailure, pasteIntoTerminal, restartPi])

  const closeTerminalPasteStatus = useCallback(() => {
    setPasteProgress(null)
    setPasteFailure(null)
  }, [])

  const resetTerminalZoom = useCallback(() => {
    fontSizeRef.current = preferredTerminalFontSize
    setFontSize(preferredTerminalFontSize)
    if (workspace) persistAiTerminalPreferences(workspace, preferredTerminalFontSize)
  }, [persistAiTerminalPreferences, preferredTerminalFontSize, workspace])

  const closeTerminalSearch = useCallback(() => {
    searchAddon.current?.clearDecorations()
    setTerminalQuery('')
    setTerminalSearchOpen(false)
    requestAnimationFrame(() => terminal.current?.focus())
  }, [])

  const updateHasUnreadTerminalOutput = useCallback((nextValue: boolean) => {
    if (hasUnreadTerminalOutputRef.current === nextValue) return
    hasUnreadTerminalOutputRef.current = nextValue
    setHasUnreadTerminalOutput(nextValue)
  }, [])

  const updateTerminalStreamState = useCallback((nextState: TerminalStreamState | null) => {
    const identity = nextState ? `${nextState.sessionId}:${nextState.status}` : ''
    if (streamStateIdentityRef.current === identity) return
    streamStateIdentityRef.current = identity
    setStreamState(nextState)
  }, [])

  const revealTerminalOutput = useCallback(() => {
    terminal.current?.scrollToBottom()
    updateHasUnreadTerminalOutput(false)
  }, [updateHasUnreadTerminalOutput])

  const restoreWorkspaceStateBeforeOpen = useCallback(() => {
    const previous = workspaceStateBeforeOpen.current
    workspaceStateBeforeOpen.current = null
    if (!previous) return
    setStatus(previous.status)
    setHomeFailure(previous.homeFailure)
    aiFailureRef.current = previous.aiFailure
    setAiFailure(previous.aiFailure)
  }, [])

  const handleWorkspaceResult = useCallback((result: WorkspaceOpenResult | null, announce = true) => {
    setOpeningWorkspacePath(null)
    setWorkspaceOpenFailure(null)
    if (!result) {
      restoreWorkspaceStateBeforeOpen()
      return
    }
    workspaceStateBeforeOpen.current = null
    const workspaceIncident = result.path
      ? null
      : reportWorkspaceResultError(result, 'Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')
    if (workspaceIncident && !result.path) {
      setStatus('error')
      setHomeFailure({ error: workspaceIncident, recovery: 'open-workspace' })
      return
    }

    clearAiFailure()
    const startFailure = result.path && result.error
      ? publishAiFailure(result.errorIncident ?? new Error(result.error), {
          operation: 'start-ai-session',
          preserved: 'Il workspace è aperto e gli strumenti locali restano disponibili.',
          recovery: 'restart',
          title: 'Sessione AI non disponibile',
          fallbackDescription: 'Non è stato possibile avviare la sessione AI.',
        })
      : null

    if (result.path) {
      setAppPreferencesWorkspace(result.path)
      loadAiTerminalPreferences(result.path)
    }
    updateHasUnreadTerminalOutput(false)
    updateTerminalStreamState(null)
    setWorkspace(result.path ?? null)
    setLoadedSections(createPersistentViewState())
    setRemoteOpenRequest(null)
    setEditorWorkbenchRequest(null)
    setGitHubWorkbenchRequest(null)
    setTerminalActionRequest(undefined)
    setEditorContext(emptyEditorContext)
    setGitHubContext(emptyGitHubContext)
    setDatabaseContext(emptyDatabaseContext)
    setRedisContext(emptyRedisContext)
    setIndexedFiles([])
    fileIndexRequest.current += 1
    setPaletteOpen(false)
    setWorkspaceSessionState(null)
    setWorkspaceSessionRecovery(null)
    setAppSection('ai')
    setAiTab('terminal')
    setStatus(startFailure ? 'error' : 'running')
    setHomeFailure(null)
    if (result.path) {
      void workspaceSession.load().then((restored) => {
        if (!restored.applied) return
        if (restored.recovery?.kind === 'corrupt') {
          setWorkspaceSessionRecovery({
            error: reportRendererFailure(new Error('Layout workspace salvato non valido.'), {
              category: 'persistence',
              code: 'PERSISTENCE_SESSION_CORRUPT',
              component: 'workspace-shell',
              correlationId: restored.recovery.correlationId,
              operation: 'restore-layout',
              severity: 'warning',
              title: 'Layout del workspace ripristinato',
              description: 'La disposizione salvata non era valida. File e dati sono rimasti al sicuro ed è stato applicato il layout predefinito.',
            }),
            kind: 'corrupt',
          })
        }
        setWorkspaceSessionState(restored.state)
        setAppSection(restored.state.navigation.section)
        setAiTab(restored.state.navigation.aiTab)
        const restoredSection = restored.state.navigation.section
        setLoadedSections((current) => {
          let next = current
          if (restoredSection !== 'ai') next = visitPersistentView(next, restoredSection)
          if (restored.state.navigation.aiTab !== 'terminal') next = visitPersistentView(next, restored.state.navigation.aiTab)
          return next
        })
      }).catch((nextError) => {
        setWorkspaceSessionRecovery({
          error: reportRendererFailure(nextError, {
            category: 'persistence',
            component: 'workspace-shell',
            operation: 'restore-layout',
            severity: 'warning',
            title: 'Layout del workspace non ripristinato',
            description: 'File e dati restano disponibili; è stato usato il layout predefinito. Puoi riprovare il salvataggio della disposizione corrente.',
          }),
          kind: 'persistence',
        })
      })
    }
    if (announce) {
      if (!startFailure) {
        toast.success('Sessione Pi avviata', { description: result.path ? workspaceName(result.path) : undefined })
      }
    }
    void refreshRecents()
  }, [clearAiFailure, loadAiTerminalPreferences, publishAiFailure, refreshRecents, restoreWorkspaceStateBeforeOpen, updateHasUnreadTerminalOutput, updateTerminalStreamState, workspaceSession])

  const selectAppSection = useCallback((section: AppSection) => {
    setAppSection(section)
    if (section !== 'ai') setLoadedSections((current) => visitPersistentView(current, section))
  }, [])

  const selectAiTab = useCallback((tab: 'terminal' | 'skills' | 'instructions') => {
    setAiTab(tab)
    if (tab !== 'terminal') setLoadedSections((current) => visitPersistentView(current, tab))
  }, [])

  const navigateToAppSection = useCallback((section: AppSection, focusPrimary = false) => {
    selectAppSection(section)
    if (!focusPrimary) return
    workbenchRequestNonce.current += 1
    const nonce = workbenchRequestNonce.current
    if (section === 'ai') {
      selectAiTab('terminal')
      requestAnimationFrame(() => terminal.current?.focus())
    }
    if (section === 'editor') setEditorWorkbenchRequest({ kind: 'focus-editor', nonce })
    if (section === 'terminal') setTerminalFocusRequest(nonce)
    if (section === 'github') setGitHubWorkbenchRequest({ kind: 'focus-primary', nonce })
    if (section === 'database') setDatabaseFocusRequest(nonce)
    if (section === 'redis') setRedisFocusRequest(nonce)
  }, [selectAiTab, selectAppSection])

  const requestEditorAction = useCallback((kind: Exclude<EditorWorkbenchRequest['kind'], 'open-file'>) => {
    selectAppSection('editor')
    workbenchRequestNonce.current += 1
    setEditorWorkbenchRequest({ kind, nonce: workbenchRequestNonce.current })
  }, [selectAppSection])

  const requestTerminalAction = useCallback((action: TerminalWorkspaceAction) => {
    selectAppSection('terminal')
    workbenchRequestNonce.current += 1
    setTerminalActionRequest({ action, id: workbenchRequestNonce.current })
  }, [selectAppSection])

  const openWorkspaceFile = useCallback((fileId: string) => {
    selectAppSection('editor')
    workbenchRequestNonce.current += 1
    setEditorWorkbenchRequest({ kind: 'open-file', fileId, nonce: workbenchRequestNonce.current })
    if (workspace) usageHistory.recordFile(fileId, workspace)
  }, [selectAppSection, usageHistory, workspace])

  const openCommandPalette = useCallback(() => {
    setPaletteMode('commands')
    setPaletteOpen(true)
  }, [])

  const openQuickOpen = useCallback(function openQuickOpenAction() {
    setPaletteMode(workspace ? 'files' : 'workspaces')
    setPaletteOpen(true)
    if (!workspace) return
    const request = ++fileIndexRequest.current
    setIndexingFiles(true)
    void window.vincodeLab.files.list().then((result) => {
      if (request !== fileIndexRequest.current) return
      const rootFiles = result.entries.filter((entry) => entry.kind === 'file').map((entry) => ({
        id: entry.id,
        name: entry.name,
        directory: '',
        extension: entry.name.includes('.') ? entry.name.split('.').at(-1)?.toLocaleLowerCase('it-IT') ?? '' : '',
        size: 0,
        modifiedAt: 0,
      }))
      setIndexedFiles((current) => current.length > 0 ? current : rootFiles)
    }).catch((nextError) => {
      // L'indice ricorsivo resta l'owner visivo di Quick Open; la lista radice è solo un'ottimizzazione.
      reportRendererFailure(nextError, {
        category: 'filesystem',
        component: 'quick-open',
        operation: 'list-root-files',
        severity: 'warning',
        title: 'Anteprima dei file non disponibile',
        fallbackDescription: 'Quick Open continua usando l’indice completo.',
      })
    })
    void window.vincodeLab.files.index().then((result) => {
      if (request === fileIndexRequest.current) setIndexedFiles(result.files)
    }).catch((nextError) => {
      if (request === fileIndexRequest.current) {
        reportTransientFailure(nextError, {
          category: 'filesystem',
          component: 'quick-open',
          operation: 'index-workspace-files',
          title: 'Indice di Quick Open non aggiornato',
          description: 'I risultati già disponibili restano visibili. Puoi ricreare l’indice senza chiudere la palette.',
        }, { label: 'Riprova', onClick: openQuickOpenAction })
      }
    }).finally(() => {
      if (request === fileIndexRequest.current) setIndexingFiles(false)
    })
  }, [workspace])

  const reportCommandFailure = useCallback((commandId: string, cause: unknown) => {
    const commandTitle = commandRegistry.getState(commandId)?.command.title ?? 'Comando selezionato'
    reportTransientFailure(cause, {
      component: 'command-palette',
      operation: 'execute-command',
      title: `Comando “${commandTitle}” non eseguito`,
      description: 'L’azione non è stata applicata e lo stato corrente è rimasto invariato. Puoi scegliere di nuovo il comando.',
    }, { label: 'Apri comandi', onClick: openCommandPalette })
  }, [commandRegistry, openCommandPalette])

  const openRemoteFileInEditor = useCallback((fileId: string) => {
    remoteOpenNonce.current += 1
    setRemoteOpenRequest({ id: fileId, nonce: remoteOpenNonce.current })
    selectAppSection('editor')
  }, [selectAppSection])

  useEffect(() => {
    const section: AppMenuSection = workspace
      ? appSection === 'ai' && aiTab !== 'terminal' ? `ai-${aiTab}` : appSection
      : appSection === 'settings' ? 'settings' : 'home'
    window.vincodeLab.appMenu.setContext(section)
  }, [aiTab, appSection, workspace])

  useEffect(() => {
    const openContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editor = target?.closest('input, textarea, [contenteditable="true"]') as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
      const isInput = editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      const editable = Boolean(editor && (!isInput || (!editor.disabled && !editor.readOnly)))
      const fieldSelection = isInput && editor.selectionStart !== null && editor.selectionEnd !== null && editor.selectionEnd > editor.selectionStart
      const documentSelection = (window.getSelection()?.toString().length ?? 0) > 0
      const remoteTarget = target?.closest<HTMLElement>('[data-remote-context-id]')
      const remoteKind = remoteTarget?.dataset.remoteContextKind
      const workspaceTarget = target?.closest<HTMLElement>('[data-workspace-context-id]')
      const workspaceKind = workspaceTarget?.dataset.workspaceContextKind
      const genericTarget = target?.closest<HTMLElement>('[data-context-menu-kind]')
      const contextTarget = editable ? null : remoteTarget ?? workspaceTarget ?? genericTarget
      const contextKind = (editable ? undefined : remoteKind ?? workspaceKind ?? genericTarget?.dataset.contextMenuKind) as ContextMenuKind | undefined
      const contextId = editable
        ? undefined
        : remoteTarget?.dataset.remoteContextId ?? workspaceTarget?.dataset.workspaceContextId ?? genericTarget?.dataset.contextMenuId
      const commandStates = commandRegistry.list()
      const enabledCommands = commandStates.length > 0
        ? commandStates.filter(({ enabled }) => enabled).map(({ command }) => command.id as AppMenuCommand)
        : undefined
      event.preventDefault()
      const request = {
        kind: contextKind ?? (target?.closest('.xterm') ? 'terminal' : 'default'),
        editable,
        hasSelection: fieldSelection || documentSelection,
        ...(contextId !== undefined ? { contextId } : {}),
        ...(enabledCommands ? { enabledCommands } : {}),
        contextFlags: {
          expanded: contextTarget?.dataset.contextExpanded === 'true',
          cancellable: contextTarget?.dataset.contextCancellable === 'true',
          retryable: contextTarget?.dataset.contextRetryable === 'true',
          dirty: contextTarget?.dataset.contextDirty === 'true',
          hasOtherTabs: contextTarget?.dataset.contextHasOtherTabs === 'true',
          hasRightTabs: contextTarget?.dataset.contextHasRightTabs === 'true',
          stageable: contextTarget?.dataset.contextStageable === 'true',
          operable: contextTarget?.dataset.contextOperable === 'true',
          canCreate: contextTarget?.dataset.contextCanCreate === 'true',
          hasVisibleValue: contextTarget?.dataset.contextHasVisibleValue === 'true',
        },
      }
      const requestContextMenu = () => {
        void window.vincodeLab.contextMenu.open(request).catch((nextError) => {
          reportTransientFailure(nextError, {
            component: 'context-menu',
            operation: 'open-context-menu',
            title: 'Menu contestuale non aperto',
            description: 'La selezione è rimasta invariata. Puoi riprovare oppure usare la palette comandi.',
          }, { label: 'Riprova', onClick: requestContextMenu })
        })
      }
      requestContextMenu()
    }
    document.addEventListener('contextmenu', openContextMenu)
    return () => document.removeEventListener('contextmenu', openContextMenu)
  }, [commandRegistry])

  const reportWorkspaceOpenFailure = useCallback((request: WorkspaceChangeRequest, error: UserError) => {
    restoreWorkspaceStateBeforeOpen()
    setOpeningWorkspacePath(null)
    setWorkspaceOpenFailure({ request, error })
  }, [restoreWorkspaceStateBeforeOpen])

  const performWorkspaceChange = useCallback(async (request: WorkspaceChangeRequest) => {
    const operationId = ++workspaceOpenGeneration.current
    workspaceStateBeforeOpen.current ??= { status, homeFailure, aiFailure }
    setWorkspaceOpenFailure(null)
    setStatus('launching')
    setHomeFailure(null)
    clearAiFailure()
    setOpeningWorkspacePath(request.kind === 'recent' ? request.path : null)
    if (workspace) {
      try {
        await workspaceSession.flush()
      } catch (nextError) {
        if (operationId === workspaceOpenGeneration.current) {
          setWorkspaceSessionRecovery({
            error: normalizeUserError(nextError, {
              category: 'persistence',
              component: 'workspace-shell',
              operation: 'save-layout-before-workspace-change',
              severity: 'warning',
              title: 'Cambio workspace sospeso',
              description: 'Il layout corrente non è stato salvato. File e modifiche sono rimasti al sicuro; salva il layout e riprova il cambio workspace.',
            }),
            kind: 'persistence',
          })
          restoreWorkspaceStateBeforeOpen()
          setOpeningWorkspacePath(null)
          return
        }
      }
    }
    if (operationId !== workspaceOpenGeneration.current) return
    try {
      const result = request.kind === 'recent'
        ? await window.vincodeLab.workspace.openRecent(request.path)
        : await window.vincodeLab.workspace.open()
      if (operationId !== workspaceOpenGeneration.current) return
      if (result?.error && !result.path) {
        const incident = reportWorkspaceResultError(result, 'Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')
        reportWorkspaceOpenFailure(request, incident ?? reportRendererFailure(new Error('Workspace non aperto.'), {
          component: 'workspace-shell',
          operation: 'open-workspace',
          title: 'Workspace non aperto',
          description: 'Il workspace precedente è rimasto disponibile. Puoi riprovare.',
        }))
        return
      }
      handleWorkspaceResult(result)
    } catch (nextError) {
      if (operationId !== workspaceOpenGeneration.current) return
      const incident = reportRendererFailure(nextError, {
        component: 'workspace-shell',
        operation: 'open-workspace',
        title: 'Workspace non aperto',
        fallbackDescription: 'Il servizio workspace non ha completato la richiesta. Il workspace precedente è rimasto aperto.',
      })
      reportWorkspaceOpenFailure(request, incident)
    } finally {
      if (operationId === workspaceOpenGeneration.current) setOpeningWorkspacePath(null)
    }
  }, [aiFailure, clearAiFailure, handleWorkspaceResult, homeFailure, reportWorkspaceOpenFailure, restoreWorkspaceStateBeforeOpen, status, workspace, workspaceSession])

  const requestWorkspaceChange = useCallback((request: WorkspaceChangeRequest) => {
    if (activeLifecycleCloseRequest.current) return
    if (workspaceChangeGuard.current.hasUnsavedChanges()) {
      setWorkspaceChangeRequest(request)
      return
    }
    void performWorkspaceChange(request)
  }, [performWorkspaceChange])

  const openWorkspace = useCallback(() => requestWorkspaceChange({ kind: 'choose' }), [requestWorkspaceChange])
  const openRecentWorkspace = useCallback((workspacePath: string) => requestWorkspaceChange({ kind: 'recent', path: workspacePath }), [requestWorkspaceChange])
  const revealWorkspace = useCallback(async function revealWorkspaceAction() {
    try {
      await window.vincodeLab.workspace.reveal()
    } catch (nextError) {
      reportTransientFailure(nextError, {
        component: 'workspace-shell',
        operation: 'reveal-workspace',
        title: 'Workspace non mostrato nel Finder',
        description: 'Il workspace è rimasto aperto e puoi continuare a lavorare. Verifica che la cartella sia ancora accessibile e riprova.',
      }, { label: 'Riprova', onClick: () => { void revealWorkspaceAction() } })
    }
  }, [])

  useEffect(() => window.vincodeLab.appMenu.onCommand((command) => {
    if (command === 'workspace.open') {
      setPaletteOpen(false)
      openWorkspace()
      return
    }
    if (command === 'workspace.reveal') {
      void revealWorkspace()
      return
    }
    if (paletteOpen && command !== 'workbench.commandPalette' && command !== 'workbench.quickOpen') return
    void commandRegistry.execute(command, { source: 'menu' }).then((execution) => {
      if (execution.status === 'not-found') dispatchApplicationMenuCommand(command)
      if (execution.status === 'failed') reportCommandFailure(execution.commandId, execution.error)
    }).catch((nextError) => reportCommandFailure(command, nextError))
  }), [commandRegistry, openWorkspace, paletteOpen, reportCommandFailure, revealWorkspace])

  const registerWorkspaceGuard = useCallback((scope: WorkspaceGuardScope, guard: WorkspaceChangeGuard | null) => {
    if (guard) workspaceChangeGuards.current.set(scope, guard)
    else workspaceChangeGuards.current.delete(scope)
  }, [])
  const handleEditorWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('editor', guard), [registerWorkspaceGuard])
  const handleSkillsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('skills', guard), [registerWorkspaceGuard])
  const handleInstructionsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('instructions', guard), [registerWorkspaceGuard])
  const handleDatabaseWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('database', guard), [registerWorkspaceGuard])
  const handleSettingsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('settings', guard), [registerWorkspaceGuard])

  const saveAndChangeWorkspace = useCallback(async () => {
    const request = workspaceChangeRequest
    const guard = workspaceChangeGuard.current
    if (!request || !guard) return
    setSavingBeforeWorkspaceChange(true)
    try {
      await guard.saveAll()
      setWorkspaceChangeRequest(null)
      await performWorkspaceChange(request)
    } catch {
      // L'editor mostra il dettaglio del file non salvato e il dialogo resta aperto.
    } finally {
      setSavingBeforeWorkspaceChange(false)
    }
  }, [performWorkspaceChange, workspaceChangeRequest])

  const discardAndChangeWorkspace = useCallback(async () => {
    const request = workspaceChangeRequest
    if (!request) return
    setSavingBeforeWorkspaceChange(true)
    try {
      await workspaceChangeGuard.current.discardAll()
      setWorkspaceChangeRequest(null)
      await performWorkspaceChange(request)
    } catch {
      // La guardia che non riesce a ripristinare mantiene il dialogo e mostra il dettaglio.
    } finally {
      setSavingBeforeWorkspaceChange(false)
    }
  }, [performWorkspaceChange, workspaceChangeRequest])

  const respondToLifecycleClose = useCallback((requestId: string, decision: LifecycleCloseDecision) => {
    if (respondedLifecycleCloseRequests.current.has(requestId)) return false
    respondedLifecycleCloseRequests.current.add(requestId)
    if (activeLifecycleCloseRequest.current?.requestId === requestId) {
      activeLifecycleCloseRequest.current = null
      lifecycleCloseOperation.current = null
    }
    setLifecycleCloseRequest((current) => current?.requestId === requestId ? null : current)
    window.vincodeLab.lifecycle.respondToClose(requestId, decision)
    return true
  }, [])

  const flushWorkspaceSessionForClose = useCallback(async () => {
    // Una patch può arrivare mentre una write precedente è ancora in volo. Continua
    // finché la revisione più recente risulta persistita prima di autorizzare l'uscita.
    do {
      await workspaceSession.flush()
    } while (workspaceSession.getSnapshot().dirty)
  }, [workspaceSession])

  const handleLifecycleCloseRequest = useCallback((request: LifecycleCloseRequest) => {
    if (respondedLifecycleCloseRequests.current.has(request.requestId)) return
    const activeRequest = activeLifecycleCloseRequest.current
    if (activeRequest?.requestId === request.requestId) return
    if (activeRequest) {
      // Il processo principale non dovrebbe sovrapporre richieste, ma una richiesta
      // diversa non deve sostituire il dialogo a cui l'utente sta già rispondendo.
      respondToLifecycleClose(request.requestId, 'cancel')
      return
    }

    activeLifecycleCloseRequest.current = request
    setWorkspaceChangeRequest(null)
    if (workspaceChangeGuard.current.hasUnsavedChanges()) {
      setLifecycleCloseRequest(request)
      return
    }

    lifecycleCloseOperation.current = request.requestId
    void flushWorkspaceSessionForClose().then(() => {
      if (workspaceChangeGuard.current.hasUnsavedChanges()) {
        lifecycleCloseOperation.current = null
        setLifecycleCloseRequest(request)
        return
      }
      respondToLifecycleClose(request.requestId, 'proceed')
    }).catch(() => {
      // workspaceSession.onError mantiene il singolo avviso persistente con la recovery;
      // la chiusura viene soltanto annullata, senza duplicare lo stesso incidente in un toast.
      respondToLifecycleClose(request.requestId, 'cancel')
    }).finally(() => {
      if (lifecycleCloseOperation.current === request.requestId) lifecycleCloseOperation.current = null
    })
  }, [flushWorkspaceSessionForClose, respondToLifecycleClose])

  useEffect(() => window.vincodeLab.lifecycle.onCloseRequested(handleLifecycleCloseRequest), [handleLifecycleCloseRequest])

  const cancelLifecycleClose = useCallback(() => {
    const request = activeLifecycleCloseRequest.current
    if (!request || lifecycleCloseOperation.current) return
    respondToLifecycleClose(request.requestId, 'cancel')
  }, [respondToLifecycleClose])

  const completeLifecycleClose = useCallback(async (action: 'save' | 'discard') => {
    const request = activeLifecycleCloseRequest.current
    if (!request || lifecycleCloseOperation.current) return
    lifecycleCloseOperation.current = request.requestId
    setSavingBeforeLifecycleClose(true)
    try {
      if (action === 'save') await workspaceChangeGuard.current.saveAll()
      else await workspaceChangeGuard.current.discardAll()
      await flushWorkspaceSessionForClose()
      respondToLifecycleClose(request.requestId, 'proceed')
    } catch {
      // La guardia della sezione interessata (o workspaceSession.onError) possiede già
      // l'ErrorNotice locale; manteniamo aperta l'app senza una notifica globale duplicata.
      respondToLifecycleClose(request.requestId, 'cancel')
    } finally {
      if (lifecycleCloseOperation.current === request.requestId) lifecycleCloseOperation.current = null
      setSavingBeforeLifecycleClose(false)
    }
  }, [flushWorkspaceSessionForClose, respondToLifecycleClose])

  const openWorkspaceInNewInstance = useCallback(async function openWorkspaceInNewInstanceAction(workspacePath: string) {
    try {
      const result = await window.vincodeLab.workspace.openInNewInstance(workspacePath)
      if (!result.launched) {
        const refusalCode = result.reason ? `WORKSPACE_NEW_INSTANCE_${result.reason.replaceAll('-', '_').toUpperCase()}` : 'WORKSPACE_NEW_INSTANCE_REFUSED'
        reportTransientFailure(new Error(`Workspace new instance refused: ${result.reason ?? 'unknown'} [${refusalCode}]`), {
          code: refusalCode,
          component: 'workspace-switcher',
          operation: 'open-workspace-new-window',
          title: 'Nuova finestra non aperta',
          description: 'Il workspace è rimasto disponibile in questa finestra. Puoi riprovare senza interrompere il lavoro corrente.',
        }, { label: 'Riprova', onClick: () => { void openWorkspaceInNewInstanceAction(workspacePath) } })
        return false
      }
      toast.success('Workspace aperto in una nuova finestra.', { description: workspacePath })
      return true
    } catch (nextError) {
      reportTransientFailure(nextError, {
        component: 'workspace-switcher',
        operation: 'open-workspace-new-window',
        title: 'Nuova finestra non aperta',
        description: 'Il workspace è rimasto disponibile in questa finestra. Puoi riprovare senza interrompere il lavoro corrente.',
      }, { label: 'Riprova', onClick: () => { void openWorkspaceInNewInstanceAction(workspacePath) } })
      return false
    }
  }, [])

  useEffect(() => window.vincodeLab.contextMenu?.onAction?.((action) => {
    if (action.contextKind !== 'recent-workspace' || !action.contextId) return
    if (action.command === 'recentWorkspace.open') openRecentWorkspace(action.contextId)
    if (action.command === 'recentWorkspace.openNew') void openWorkspaceInNewInstance(action.contextId)
  }) ?? (() => undefined), [openRecentWorkspace, openWorkspaceInNewInstance])

  useEffect(() => {
    let active = true
    void window.vincodeLab.workspace.listRecent().then((recentWorkspaces) => {
      if (active) setRecents(recentWorkspaces)
    }).catch((nextError) => {
      if (active) {
        const incident = reportRendererFailure(nextError, {
          category: 'persistence',
          component: 'workspace-home',
          operation: 'list-recent-workspaces',
          title: 'Workspace recenti non disponibili',
          fallbackDescription: 'Puoi comunque scegliere una cartella e continuare.',
        })
        setHomeFailure({ error: incident, recovery: 'refresh-recents' })
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const operationId = workspaceOpenGeneration.current
    void window.vincodeLab.workspace.getActive().then((result) => {
      if (active && operationId === workspaceOpenGeneration.current && result?.path) handleWorkspaceResult(result, false)
    }).catch((nextError) => {
      if (!active || operationId !== workspaceOpenGeneration.current) return
      const incident = reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-home',
        operation: 'restore-active-workspace',
        severity: 'warning',
        title: 'Workspace precedente non ripristinato',
        description: 'La Home resta disponibile e nessun file è stato modificato. Scegli una cartella per continuare.',
      })
      setHomeFailure({ error: incident, recovery: 'open-workspace' })
    })
    return () => { active = false }
  }, [handleWorkspaceResult])

  useEffect(() => {
    const unsubscribeExit = window.vincodeLab.terminal.onExit(({ exitCode, signal }) => {
      setStatus(exitCode === 0 && !signal ? 'ended' : 'error')
      if (exitCode === 0 && !signal) {
        showEndedAiSession()
      } else if (signal) {
        publishAiFailure(new Error(`PTY signal ${signal}`), {
          operation: 'ai-session-crash',
          preserved: 'L’output già ricevuto è rimasto disponibile.',
          recovery: 'restart',
          title: 'Sessione AI interrotta',
          fallbackDescription: 'La sessione AI si è interrotta in modo imprevisto.',
        })
      } else {
        publishAiFailure(new Error(`PTY exit code ${exitCode ?? 'unknown'}`), {
          operation: 'ai-session-crash',
          preserved: 'L’output già ricevuto è rimasto disponibile.',
          recovery: 'restart',
          title: 'Sessione AI terminata in modo imprevisto',
          fallbackDescription: 'La sessione AI si è chiusa prima di completare il lavoro.',
        })
      }
    })

    return () => {
      unsubscribeExit()
    }
  }, [publishAiFailure, showEndedAiSession])

  useEffect(() => {
    const subscribe = window.vincodeLab.terminal.onError
    if (!subscribe) return
    return subscribe((event) => {
      if (event.operation === 'resize') {
        const incident = reportRendererFailure(event.error, {
          category: event.error.category,
          code: event.error.code,
          component: 'ai-terminal',
          correlationId: event.error.correlationId,
          description: 'La sessione resta attiva, ma la nuova dimensione del terminale non è stata applicata. Puoi riprovare senza perdere l’output.',
          operation: 'resize-ai-terminal',
          severity: 'warning',
          title: 'Dimensione del terminale non aggiornata',
        })
        showUserErrorToast(incident, {
          label: 'Riprova',
          onClick: () => {
            const xterm = terminal.current
            if (!xterm) return
            fitAddon.current?.fit()
            window.vincodeLab.terminal.resize({ cols: xterm.cols, rows: xterm.rows })
          },
        })
        return
      }

      const outputOperation = event.operation === 'ready' || event.operation === 'ack'
      publishAiFailure(event.error, {
        category: event.error.category,
        code: event.error.code,
        correlationId: event.error.correlationId,
        fallbackDescription: outputOperation
          ? 'Il collegamento all’output della sessione non ha completato una conferma.'
          : 'La sessione AI non ha confermato l’ultimo input da tastiera.',
        operation: outputOperation ? 'restore-ai-output' : 'send-ai-input',
        preserved: outputOperation
          ? 'L’output già visibile è rimasto disponibile.'
          : 'Il prompt e l’output già visibile sono rimasti disponibili; l’ultimo carattere potrebbe non essere stato inviato.',
        recovery: outputOperation ? 'resume-output' : 'restart',
        severity: event.error.severity,
        title: outputOperation ? 'Output della sessione AI non sincronizzato' : 'Input non inviato alla sessione AI',
      })
    })
  }, [publishAiFailure])

  useEffect(() => {
    const unsubscribe = window.vincodeLab.workspace.onOpened((result) => {
      workspaceOpenGeneration.current += 1
      handleWorkspaceResult(result)
    })
    return unsubscribe
  }, [handleWorkspaceResult])

  useEffect(() => {
    if (!terminalSearchOpen) return
    if (!terminalQuery) {
      searchAddon.current?.clearDecorations()
      return
    }
    searchAddon.current?.findNext(terminalQuery, { incremental: true })
  }, [terminalQuery, terminalSearchOpen])

  useEffect(() => {
    if (!terminal.current) return
    terminal.current.options.fontSize = fontSize
    requestAnimationFrame(() => fitAddon.current?.fit())
  }, [fontSize])

  useEffect(() => {
    if (!workspace || appSection !== 'ai' || aiTab !== 'terminal' || !terminal.current) return

    return scheduleVisibleTerminalRefit(() => {
      fitAddon.current?.fit()
      if (terminal.current) {
        window.vincodeLab.terminal.resize({ cols: terminal.current.cols, rows: terminal.current.rows })
      }
    })
  }, [aiTab, appSection, workspace])

  useEffect(() => {
    if (appSection !== 'ai' || aiTab !== 'terminal') return
    const report = () => {
      const metrics = outputController.current?.metrics()
      if (metrics) window.vincodeLab.terminal.reportRendererMetrics(metrics)
    }
    report()
    const intervalId = window.setInterval(report, 2_000)
    return () => window.clearInterval(intervalId)
  }, [aiTab, appSection, terminalRendererGeneration])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !workspace
        || appSection !== 'ai'
        || aiTab !== 'terminal'
        || paletteOpen
        || (!event.metaKey && !event.ctrlKey)
        || suppressGlobalTerminalShortcut(event.target)
      ) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setTerminalSearchOpen(true)
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        changeFontSize(1)
      }
      if (event.key === '-') {
        event.preventDefault()
        changeFontSize(-1)
      }
      if (event.key === '0') {
        event.preventDefault()
        resetTerminalZoom()
      }
      if (event.key.toLowerCase() === 'c' && terminal.current?.hasSelection()) {
        event.preventDefault()
        void copyTerminalSelection()
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void pasteIntoTerminal()
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        clearTerminal()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [aiTab, appSection, changeFontSize, clearTerminal, copyTerminalSelection, paletteOpen, pasteIntoTerminal, resetTerminalZoom, workspace])

  useEffect(() => {
    if (!workspace || !terminalElement.current || terminal.current) return
    let disposed = false
    let cleanup: (() => void) | undefined

    // xterm pesa più della pagina Recenti: viene scaricato solo quando Pi deve essere visualizzato.
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-search')]).then(([xtermModule, fitModule, searchModule]) => {
      if (disposed || !terminalElement.current) return

      const xterm = new xtermModule.Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: preferredTerminalCursorStyle,
        fontFamily: terminalFontFamily(preferredTerminalFontFamily),
        fontSize: fontSizeRef.current,
        lineHeight: 1.35,
        scrollback: preferredTerminalScrollback,
        scrollSensitivity: 1,
        theme: readXtermTheme(),
      })
      const nextFitAddon = new fitModule.FitAddon()
      const nextSearchAddon = new searchModule.SearchAddon()
      xterm.loadAddon(nextFitAddon)
      xterm.loadAddon(nextSearchAddon)
      fitAddon.current = nextFitAddon
      searchAddon.current = nextSearchAddon
      xterm.open(terminalElement.current)
      terminal.current = xterm
      if (aiFailureRef.current?.error.operation === 'initialize-ai-terminal') {
        clearAiFailure('initialize-ai-terminal')
        setStatus('running')
      }

      let dimensions = { cols: 0, rows: 0 }
      const fit = () => {
        nextFitAddon.fit()
        const nextDimensions = { cols: xterm.cols, rows: xterm.rows }
        if (nextDimensions.cols === dimensions.cols && nextDimensions.rows === dimensions.rows) return
        dimensions = nextDimensions
        window.vincodeLab.terminal.resize(nextDimensions)
      }
      const resizeScheduler = createAnimationFrameResizeScheduler(fit)
      const resizeObserver = new ResizeObserver(resizeScheduler.schedule)
      resizeObserver.observe(terminalElement.current)
      resizeScheduler.schedule()
      const cancelInitialRefit = scheduleVisibleTerminalRefit(resizeScheduler.schedule)
      const delayedInitialRefit = window.setTimeout(resizeScheduler.schedule, 160)

      const controller = createXtermOutputController({
        write: (data, done) => xterm.write(data, done),
        ack: window.vincodeLab.terminal.ack,
        ready: window.vincodeLab.terminal.ready,
        onRendered: () => {
          if (shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })) xterm.scrollToBottom()
          else updateHasUnreadTerminalOutput(true)
        },
        onWriteError: (nextError) => publishAiFailure(nextError, {
          operation: 'render-ai-output',
          preserved: 'La sessione e l’output già visibile sono rimasti disponibili.',
          recovery: 'resume-output',
          title: 'Output della sessione AI non aggiornato',
          fallbackDescription: 'Il terminale non ha completato il rendering dell’ultimo blocco.',
        }),
      })
      outputController.current = controller
      const unsubscribeOutput = window.vincodeLab.terminal.onOutput((block) => controller.accept(block))
      const unsubscribeStreamState = window.vincodeLab.terminal.onStreamState(updateTerminalStreamState)
      // Il PTY resta nel processo principale: uno xterm ricreato riparte dallo snapshot
      // e conferma il watermark prima che il flusso live possa proseguire.
      void window.vincodeLab.terminal.resume({}).then((snapshot) => {
        controller.restore(snapshot)
        clearAiFailure('restore-ai-output')
      }).catch((nextError) => {
        updateTerminalStreamState(null)
        // Se Pi non è partito, il mancato resume è una conseguenza dello stesso
        // incidente: la superficie di avvio resta l'unica comunicazione utile.
        if (aiFailureRef.current?.error.operation === 'start-ai-session') return
        publishAiFailure(nextError, {
          operation: 'restore-ai-output',
          preserved: 'L’output già visibile è rimasto disponibile.',
          recovery: 'resume-output',
          title: 'Storico della sessione AI non disponibile',
          fallbackDescription: 'Il collegamento allo storico della sessione non è stato ripristinato.',
        })
      })

      const inputDisposable = xterm.onData(window.vincodeLab.terminal.writeKey)
      const scrollDisposable = xterm.onScroll(() => updateHasUnreadTerminalOutput(!shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })))
      xterm.focus()
      cleanup = () => {
        unsubscribeOutput()
        unsubscribeStreamState()
        controller.dispose()
        inputDisposable.dispose()
        scrollDisposable.dispose()
        resizeScheduler.cancel()
        cancelInitialRefit()
        window.clearTimeout(delayedInitialRefit)
        resizeObserver.disconnect()
        xterm.dispose()
        fitAddon.current = null
        searchAddon.current = null
        outputController.current = null
        terminal.current = null
      }
    }).catch((nextError) => {
      if (disposed) return
      publishAiFailure(nextError, {
        operation: 'initialize-ai-terminal',
        preserved: 'Il workspace e gli altri strumenti restano disponibili.',
        recovery: 'retry-terminal',
        title: 'Terminale AI non disponibile',
        fallbackDescription: 'Non è stato possibile preparare il terminale AI.',
      })
      setStatus('error')
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [clearAiFailure, preferredTerminalCursorStyle, preferredTerminalFontFamily, preferredTerminalScrollback, publishAiFailure, terminalRendererGeneration, updateHasUnreadTerminalOutput, updateTerminalStreamState, workspace])

  useEffect(() => {
    // xterm usa canvas: aggiorniamo l'istanza senza ricreare il PTY né perdere lo storico.
    return observeXtermTheme((theme) => {
      if (terminal.current) terminal.current.options.theme = theme
    })
  }, [])

  useEffect(() => {
    fontSizeRef.current = preferredTerminalFontSize
    queueMicrotask(() => setFontSize(preferredTerminalFontSize))
    if (!terminal.current) return
    terminal.current.options.fontSize = preferredTerminalFontSize
    terminal.current.options.fontFamily = terminalFontFamily(preferredTerminalFontFamily)
    terminal.current.options.cursorStyle = preferredTerminalCursorStyle
    terminal.current.options.scrollback = preferredTerminalScrollback
    fitAddon.current?.fit()
  }, [preferredTerminalCursorStyle, preferredTerminalFontFamily, preferredTerminalFontSize, preferredTerminalScrollback])

  const sendAiInput = useCallback(async (data: string) => {
    await window.vincodeLab.terminal.writeInput(data)
    terminal.current?.focus()
  }, [])

  const writeAiInput = useCallback(async function writeAiInputAction(data: string, context: AiInputFailureContext) {
    try {
      await sendAiInput(data)
      return true
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'process',
        component: 'ai-context',
        operation: context.operation,
        title: context.title,
        description: context.description,
      }, {
        label: 'Riprova',
        onClick: () => { void writeAiInputAction(data, context) },
      })
      return false
    }
  }, [sendAiInput])

  const insertEditorContextIntoAi = useCallback(async function insertEditorContextIntoAiAction(includeSelection: boolean) {
    if (!editorContext.activeFileId || editorContext.source !== 'workspace') return
    if (includeSelection && editorContext.dirty) {
      toast.info('Salva il file prima di inviare la selezione a Pi.', { description: 'Il riferimento deve corrispondere al contenuto disponibile nel workspace.' })
      return
    }
    try {
      const attachment = await window.vincodeLab.files.prepareAttachment(editorContext.activeFileId)
      const lineRange = includeSelection && editorContext.selection
        ? ` righe ${editorContext.selection.fromLine}–${editorContext.selection.toLine}`
        : ''
      const inserted = await writeAiInput(`@${attachment.absolutePath}${lineRange} `, {
        description: 'Il riferimento preparato è rimasto disponibile, ma non è stato aggiunto al prompt. La sessione AI non è stata modificata.',
        operation: includeSelection ? 'insert-editor-selection-context' : 'insert-editor-file-context',
        title: includeSelection ? 'Selezione non aggiunta al contesto AI' : 'File non aggiunto al contesto AI',
      })
      if (!inserted) return
      toast.success(includeSelection ? 'Selezione aggiunta al contesto AI.' : 'File aggiunto al contesto AI.', { description: editorContext.activeFileId })
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'filesystem',
        component: 'ai-context',
        operation: 'prepare-file-context',
        title: 'File non aggiunto al contesto AI',
        description: 'Il file e la sessione AI sono rimasti invariati. Puoi riprovare dopo aver verificato che il file sia ancora accessibile.',
      }, { label: 'Riprova', onClick: () => { void insertEditorContextIntoAiAction(includeSelection) } })
    }
  }, [editorContext, writeAiInput])

  const sendEditorContextToAi = useCallback((includeSelection: boolean) => {
    navigateToAppSection('ai', true)
    window.setTimeout(() => { void insertEditorContextIntoAi(includeSelection) }, 0)
  }, [insertEditorContextIntoAi, navigateToAppSection])

  const openGitDiffForFile = useCallback((filePath: string) => {
    selectAppSection('github')
    workbenchRequestNonce.current += 1
    setGitHubWorkbenchRequest({ kind: 'open-file-diff', filePath, nonce: workbenchRequestNonce.current })
  }, [selectAppSection])

  const workbenchContext = useMemo<WorkbenchCommandContext>(() => ({
    hasWorkspace: Boolean(workspace),
    section: appSection,
    aiTab,
    editor: editorContext,
    github: githubContext,
    database: databaseContext,
    redis: redisContext,
  }), [aiTab, appSection, databaseContext, editorContext, githubContext, redisContext, workspace])

  useEffect(() => commandRegistry.setContext(workbenchContext), [commandRegistry, workbenchContext])

  const workbenchCommands = useMemo<WorkbenchCommand<WorkbenchCommandContext>[]>(() => {
    const workspaceOnly = (context: WorkbenchCommandContext) => context.hasWorkspace
    const inSection = (section: AppSection) => (context: WorkbenchCommandContext) => context.hasWorkspace && context.section === section
    const navigate = (section: AppSection) => () => navigateToAppSection(section, true)
    const relay = (command: AppMenuCommand) => () => dispatchApplicationMenuCommand(command)
    return [
      { id: 'workbench.commandPalette', title: 'Mostra palette comandi', category: 'Workbench', shortcut: '⌘⇧P', run: openCommandPalette },
      { id: 'workbench.quickOpen', title: 'Apri rapidamente un file o workspace', category: 'Workbench', shortcut: '⌘P', run: openQuickOpen },
      { id: 'workspace.open', title: 'Apri cartella…', category: 'Workspace', shortcut: '⌘O', run: openWorkspace },
      { id: 'navigation.ai', title: 'Vai al Terminale AI', category: 'Navigazione', shortcut: '⌘1', when: workspaceOnly, run: navigate('ai') },
      { id: 'navigation.editor', title: 'Vai all’Editor', category: 'Navigazione', shortcut: '⌘2', when: workspaceOnly, run: navigate('editor') },
      { id: 'navigation.terminal', title: 'Vai al Terminale', category: 'Navigazione', shortcut: '⌘3', when: workspaceOnly, run: navigate('terminal') },
      { id: 'navigation.github', title: 'Vai a GitHub', category: 'Navigazione', shortcut: '⌘4', when: workspaceOnly, run: navigate('github') },
      { id: 'navigation.database', title: 'Vai al Database', category: 'Navigazione', shortcut: '⌘5', when: workspaceOnly, run: navigate('database') },
      { id: 'navigation.redis', title: 'Vai a Redis', category: 'Navigazione', shortcut: '⌘6', when: workspaceOnly, run: navigate('redis') },
      { id: 'navigation.settings', title: 'Apri Impostazioni', category: 'Navigazione', shortcut: '⌘,', run: navigate('settings') },
      { id: 'ai.skills', title: 'Apri Skill progetto', category: 'AI', when: workspaceOnly, run: () => { selectAppSection('ai'); selectAiTab('skills') } },
      { id: 'ai.instructions', title: 'Apri Istruzioni progetto', category: 'AI', when: workspaceOnly, run: () => { selectAppSection('ai'); selectAiTab('instructions') } },
      { id: 'ai.save', title: 'Salva Skill o Istruzioni correnti', category: 'AI', shortcut: '⌘S', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab !== 'terminal', run: async (context) => {
        const scope = context.aiTab === 'skills' ? 'skills' : 'instructions'
        await workspaceChangeGuards.current.get(scope)?.saveAll()
      } },
      { id: 'ai.reload', title: 'Ricarica risorse Pi', category: 'AI', shortcut: '⌘⌥R', when: workspaceOnly, run: () => reloadPi() },
      { id: 'ai.restart', title: 'Riavvia sessione Pi', category: 'AI', when: workspaceOnly, run: () => restartPi() },
      { id: 'ai.copy', title: 'Copia selezione Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => copyTerminalSelection() },
      { id: 'ai.paste', title: 'Incolla nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => pasteIntoTerminal() },
      { id: 'ai.search', title: 'Cerca nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => setTerminalSearchOpen(true) },
      { id: 'ai.selectAll', title: 'Seleziona tutto nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => { terminal.current?.selectAll(); terminal.current?.focus() } },
      { id: 'ai.clear', title: 'Pulisci vista Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: clearTerminal },
      { id: 'ai.zoomIn', title: 'Aumenta zoom Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => changeFontSize(1) },
      { id: 'ai.zoomOut', title: 'Riduci zoom Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => changeFontSize(-1) },
      { id: 'ai.zoomReset', title: 'Ripristina zoom Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: resetTerminalZoom },
      { id: 'editor.save', title: 'Salva file corrente', category: 'Editor', shortcut: '⌘S', when: inSection('editor'), enabled: (context) => Boolean(context.editor.activeFileId && context.editor.dirty), run: relay('editor.save') },
      { id: 'editor.search', title: 'Cerca nel file', category: 'Editor', shortcut: '⌘F', when: inSection('editor'), enabled: (context) => Boolean(context.editor.activeFileId), run: relay('editor.search') },
      { id: 'editor.focusExplorer', title: 'Focus Explorer', category: 'Editor', shortcut: '⇧⌘E', when: workspaceOnly, run: () => requestEditorAction('focus-explorer') },
      { id: 'editor.focus', title: 'Focus Editor', category: 'Editor', when: workspaceOnly, enabled: (context) => Boolean(context.editor.activeFileId), run: () => requestEditorAction('focus-editor') },
      { id: 'editor.nextTab', title: 'File successivo', category: 'Editor', shortcut: '⌃Tab', when: inSection('editor'), run: () => requestEditorAction('next-tab') },
      { id: 'editor.previousTab', title: 'File precedente', category: 'Editor', shortcut: '⌃⇧Tab', when: inSection('editor'), run: () => requestEditorAction('previous-tab') },
      { id: 'editor.close', title: 'Chiudi file corrente', category: 'Editor', shortcut: '⌘W', when: inSection('editor'), enabled: (context) => Boolean(context.editor.activeFileId), run: () => requestEditorAction('close-active') },
      { id: 'editor.refresh', title: 'Aggiorna Explorer', category: 'Editor', when: inSection('editor'), run: relay('editor.refresh') },
      { id: 'editor.openCurrentDiff', title: 'Apri diff del file corrente', category: 'Git', keywords: ['modifiche file git'], when: workspaceOnly, enabled: (context) => context.editor.source === 'workspace' && Boolean(context.editor.activeFileId), run: (context) => { if (context.editor.activeFileId) openGitDiffForFile(context.editor.activeFileId) } },
      { id: 'editor.sendFileToAi', title: 'Invia file corrente a Pi', category: 'AI', keywords: ['contesto allega'], when: workspaceOnly, enabled: (context) => context.editor.source === 'workspace' && Boolean(context.editor.activeFileId), run: () => sendEditorContextToAi(false) },
      { id: 'editor.sendSelectionToAi', title: 'Invia selezione corrente a Pi', category: 'AI', keywords: ['contesto righe'], when: workspaceOnly, enabled: (context) => context.editor.source === 'workspace' && Boolean(context.editor.selection) && !context.editor.dirty, run: () => sendEditorContextToAi(true) },
      { id: 'terminal.focus', title: 'Focus Terminale', category: 'Terminale', keywords: ['shell'], shortcut: '⌃`', when: workspaceOnly, run: () => requestTerminalAction('focus') },
      { id: 'terminal.new', title: 'Nuovo terminale', category: 'Terminale', shortcut: '⌃⇧`', when: workspaceOnly, run: () => requestTerminalAction('new') },
      { id: 'terminal.previous', title: 'Terminale precedente', category: 'Terminale', shortcut: '⇧⌘[', when: inSection('terminal'), run: () => requestTerminalAction('previous') },
      { id: 'terminal.next', title: 'Terminale successivo', category: 'Terminale', shortcut: '⇧⌘]', when: inSection('terminal'), run: () => requestTerminalAction('next') },
      { id: 'terminal.close', title: 'Chiudi terminale attivo', category: 'Terminale', shortcut: '⌘W', when: inSection('terminal'), run: () => requestTerminalAction('close') },
      { id: 'terminal.search', title: 'Cerca nel terminale', category: 'Terminale', shortcut: '⌘F', when: inSection('terminal'), run: relay('terminal.search') },
      { id: 'terminal.clear', title: 'Pulisci vista terminale', category: 'Terminale', shortcut: '⌘K', when: inSection('terminal'), run: relay('terminal.clear') },
      { id: 'terminal.restart', title: 'Riavvia terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.restart') },
      { id: 'terminal.copy', title: 'Copia selezione terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.copy') },
      { id: 'terminal.paste', title: 'Incolla nel terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.paste') },
      { id: 'terminal.selectAll', title: 'Seleziona tutto nel terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.selectAll') },
      { id: 'terminal.zoomIn', title: 'Aumenta zoom terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.zoomIn') },
      { id: 'terminal.zoomOut', title: 'Riduci zoom terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.zoomOut') },
      { id: 'terminal.zoomReset', title: 'Ripristina zoom terminale', category: 'Terminale', when: inSection('terminal'), run: relay('terminal.zoomReset') },
      { id: 'github.focusChanges', title: 'Apri modifiche Git', category: 'Git', keywords: ['source control'], when: workspaceOnly, run: navigate('github') },
      { id: 'github.refresh', title: 'Aggiorna dati GitHub', category: 'Git', shortcut: '⌘⌥G', when: inSection('github'), run: relay('github.refresh') },
      { id: 'github.fetch', title: 'Verifica aggiornamenti remoti', category: 'Git', when: inSection('github'), run: relay('github.fetch') },
      { id: 'database.focus', title: 'Focus editor SQL', category: 'Database', when: workspaceOnly, run: navigate('database') },
      { id: 'database.execute', title: 'Esegui SQL', category: 'Database', shortcut: '⌘↵', when: inSection('database'), enabled: (context) => Boolean(context.database.connectionId && context.database.sql.trim()), run: relay('database.execute') },
      { id: 'database.cancel', title: 'Annulla query attiva', category: 'Database', when: inSection('database'), enabled: (context) => context.database.executing, run: relay('database.cancel') },
      { id: 'database.format', title: 'Formatta SQL', category: 'Database', shortcut: '⌥⇧F', when: inSection('database'), run: relay('database.format') },
      { id: 'database.schema', title: 'Aggiorna schema', category: 'Database', when: inSection('database'), enabled: (context) => Boolean(context.database.connectionId), run: relay('database.schema') },
      { id: 'database.saveQuery', title: 'Salva query corrente', category: 'Database', when: inSection('database'), enabled: (context) => Boolean(context.database.connectionId && context.database.sql.trim()), run: relay('database.saveQuery') },
      { id: 'database.begin', title: 'Inizia transazione', category: 'Database', when: inSection('database'), enabled: (context) => Boolean(context.database.connectionId && !context.database.transactionActive && !context.database.executing), run: relay('database.begin') },
      { id: 'database.commit', title: 'Commit transazione', category: 'Database', when: inSection('database'), enabled: (context) => context.database.transactionActive, run: relay('database.commit') },
      { id: 'database.rollback', title: 'Rollback transazione', category: 'Database', when: inSection('database'), enabled: (context) => context.database.transactionActive, run: relay('database.rollback') },
      { id: 'redis.focusSearch', title: 'Cerca chiavi o contenuti Redis', category: 'Redis', shortcut: '⌘F', when: inSection('redis'), run: relay('redis.focusSearch') },
      { id: 'redis.refresh', title: 'Aggiorna chiavi Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => Boolean(context.redis.connectionId), run: relay('redis.refresh') },
      { id: 'redis.newConnection', title: 'Nuova connessione Redis', category: 'Redis', when: inSection('redis'), run: relay('redis.newConnection') },
      { id: 'redis.reconnect', title: 'Riconnetti Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => Boolean(context.redis.connectionId), run: relay('redis.reconnect') },
      { id: 'redis.cancel', title: 'Annulla ricerca Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => context.redis.searching, run: relay('redis.cancel') },
      { id: 'settings.refresh', title: 'Aggiorna impostazioni e risorse', category: 'Impostazioni', when: (context) => context.section === 'settings', run: relay('settings.refresh') },
      { id: 'settings.resetWorkspacePreferences', title: 'Rimuovi personalizzazioni del workspace', category: 'Impostazioni', when: (context) => context.section === 'settings', enabled: (context) => context.hasWorkspace, run: relay('settings.resetWorkspacePreferences') },
    ]
  }, [changeFontSize, clearTerminal, copyTerminalSelection, navigateToAppSection, openCommandPalette, openGitDiffForFile, openQuickOpen, openWorkspace, pasteIntoTerminal, reloadPi, requestEditorAction, requestTerminalAction, resetTerminalZoom, restartPi, selectAiTab, selectAppSection, sendEditorContextToAi])

  useEffect(() => commandRegistry.registerAll(workbenchCommands), [commandRegistry, workbenchCommands])

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    void commandRegistryRevision
    void usageHistoryRevision
    void workbenchContext
    return commandRegistry.list().filter(({ command }) => command.id !== 'workbench.commandPalette').map(({ command, enabled }) => ({
      id: `command:${command.id}`,
      label: command.title,
      description: command.description,
      category: command.category,
      keywords: command.keywords,
      shortcut: command.shortcut,
      disabled: !enabled,
      usage: usageHistory.getUsage('command', command.id),
    }))
  }, [commandRegistry, commandRegistryRevision, usageHistory, usageHistoryRevision, workbenchContext])

  const quickOpenItems = useMemo<CommandPaletteItem[]>(() => {
    void usageHistoryRevision
    const indexedIds = new Set(indexedFiles.map((file) => file.id))
    const recentFiles = workspace ? usageHistory.list('file')
      .filter((entry) => entry.scope === workspace && !indexedIds.has(entry.id))
      .map((entry) => ({
        id: `file:${entry.id}`,
        label: entry.id.split('/').at(-1) ?? entry.id,
        description: entry.id.includes('/') ? entry.id.slice(0, entry.id.lastIndexOf('/')) : 'Radice workspace',
        path: entry.id,
        category: 'File recente',
        keywords: ['recente'],
        usage: usageHistory.getUsage('file', entry.id, workspace),
      })) : []
    return [
      ...recentFiles,
      ...indexedFiles.map((file) => ({
      id: `file:${file.id}`,
      label: file.name,
      description: file.directory || 'Radice workspace',
      path: file.id,
      category: 'File',
      keywords: [file.extension],
      usage: workspace ? usageHistory.getUsage('file', file.id, workspace) : undefined,
    })),
      ...recents.filter((recent) => recent.path !== workspace).map((recent) => ({
      id: `workspace:${recent.path}`,
      label: workspaceName(recent.path),
      description: recent.path,
      path: recent.path,
      category: 'Workspace',
      keywords: ['cartella', 'progetto', 'recente'],
      })),
    ]
  }, [indexedFiles, recents, usageHistory, usageHistoryRevision, workspace])

  const paletteItems = paletteMode === 'commands' ? commandPaletteItems : quickOpenItems
  const selectPaletteItem = useCallback(async (item: CommandPaletteItem) => {
    if (item.id.startsWith('command:')) {
      const commandId = item.id.slice('command:'.length)
      const execution = await commandRegistry.execute(commandId, { source: 'palette' })
      if (execution.status === 'executed') {
        usageHistory.recordCommand(commandId)
        if (commandId === 'workbench.quickOpen' || commandId === 'workbench.commandPalette') return false
        return true
      }
      if (execution.status === 'failed') reportCommandFailure(execution.commandId, execution.error)
      return false
    }
    if (item.id.startsWith('file:')) {
      openWorkspaceFile(item.id.slice('file:'.length))
      return true
    }
    if (item.id.startsWith('workspace:')) {
      openRecentWorkspace(item.id.slice('workspace:'.length))
      return true
    }
    return false
  }, [commandRegistry, openRecentWorkspace, openWorkspaceFile, reportCommandFailure, usageHistory])

  const updateTerminalSession = useCallback((next: Pick<WorkspaceSessionState['terminal'], 'tab' | 'openSessionCount' | 'activeSessionOrdinal'>) => {
    const current = workspaceSession.getSnapshot().state.terminal
    if (
      current.tab === next.tab
      && current.openSessionCount === next.openSessionCount
      && current.activeSessionOrdinal === next.activeSessionOrdinal
    ) return
    patchWorkspaceSession((current) => ({
      ...current,
      terminal: { ...current.terminal, ...next },
    }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateEditorSession = useCallback((next: WorkspaceSessionState['editor']) => {
    const current = workspaceSession.getSnapshot().state.editor
    if (JSON.stringify(current) === JSON.stringify(next)) return
    patchWorkspaceSession((state) => ({ ...state, editor: next }))
  }, [patchWorkspaceSession, workspaceSession])

  const refreshWorkspaceSessionForRecovery = useCallback(() => {
    const snapshot = workspaceSession.getSnapshot()
    if (snapshot.loaded) setWorkspaceSessionState(snapshot.state)
  }, [workspaceSession])

  const updateGitHubSession = useCallback((next: Pick<WorkspaceSessionState['github'], 'tab' | 'selectedDiffPath' | 'selectedProjectNumber' | 'issueStateFilter'>) => {
    const current = workspaceSession.getSnapshot().state.github
    if (current.tab === next.tab && current.selectedDiffPath === next.selectedDiffPath && current.selectedProjectNumber === next.selectedProjectNumber && current.issueStateFilter === next.issueStateFilter) return
    patchWorkspaceSession((state) => ({ ...state, github: { ...state.github, ...next } }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateDatabaseSession = useCallback((next: Pick<WorkspaceSessionState['database'], 'selectedConnectionId' | 'sidebarTab' | 'view' | 'expandedSchemaIds' | 'selectedTableName' | 'activeSavedQueryId'>) => {
    const current = workspaceSession.getSnapshot().state.database
    if (
      current.selectedConnectionId === next.selectedConnectionId
      && current.sidebarTab === next.sidebarTab
      && current.view === next.view
      && current.selectedTableName === next.selectedTableName
      && current.activeSavedQueryId === next.activeSavedQueryId
      && current.expandedSchemaIds.join('\0') === next.expandedSchemaIds.join('\0')
    ) return
    patchWorkspaceSession((state) => ({ ...state, database: { ...state.database, ...next } }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateRedisSession = useCallback((next: WorkspaceSessionState['redis']) => {
    const current = workspaceSession.getSnapshot().state.redis
    if (
      current.selectedConnectionId === next.selectedConnectionId
      && current.databaseIndex === next.databaseIndex
      && current.view === next.view
      && current.typeFilter === next.typeFilter
      && current.inspectorTab === next.inspectorTab
    ) return
    patchWorkspaceSession((state) => ({ ...state, redis: next }))
  }, [patchWorkspaceSession, workspaceSession])

  const aiContextActions: TerminalContextAction[] = [
    ...(editorContext.activeFileId && editorContext.source === 'workspace' ? [{
      id: 'editor-file',
      label: editorContext.activeFileName ?? 'File corrente',
      description: `Inserisci ${editorContext.activeFileId} nel prompt`,
      onSelect: () => { void insertEditorContextIntoAi(false) },
    }] : []),
    ...(editorContext.selection && editorContext.activeFileId && editorContext.source === 'workspace' ? [{
      id: 'editor-selection',
      label: `Righe ${editorContext.selection.fromLine}–${editorContext.selection.toLine}`,
      description: editorContext.dirty ? 'Salva il file per usare questa selezione' : 'Inserisci il file e l’intervallo selezionato nel prompt',
      disabled: editorContext.dirty,
      onSelect: () => { void insertEditorContextIntoAi(true) },
    }] : []),
    ...(githubContext.selectedDiffPath ? [{
      id: 'git-diff',
      label: `Diff · ${githubContext.selectedDiffPath.split('/').at(-1)}`,
      description: `Chiedi a Pi di analizzare il diff Git di ${githubContext.selectedDiffPath}`,
      onSelect: () => {
        void writeAiInput(`Analizza il diff Git di ${githubContext.selectedDiffPath} `, {
          description: 'Il riferimento al diff non è stato aggiunto al prompt. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-git-diff-context',
          title: 'Diff non aggiunto al contesto AI',
        })
      },
    }] : githubContext.changedFiles.length > 0 ? [{
      id: 'git-changes',
      label: `${githubContext.changedFiles.length} modifiche Git`,
      description: 'Chiedi a Pi di analizzare le modifiche Git correnti',
      onSelect: () => {
        void writeAiInput('Analizza le modifiche Git correnti del workspace ', {
          description: 'Il riferimento alle modifiche Git non è stato aggiunto al prompt. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-git-changes-context',
          title: 'Modifiche Git non aggiunte al contesto AI',
        })
      },
    }] : []),
    ...(databaseContext.connectionId && databaseContext.sql.trim() ? [{
      id: 'database-query',
      label: `SQL · ${databaseContext.connectionName ?? 'connessione attiva'}`,
      description: 'Inserisci la query SQL corrente nel prompt senza eseguirla',
      onSelect: () => {
        void writeAiInput(`Contesto SQL (${databaseContext.connectionName ?? 'connessione attiva'}): ${compactContextText(databaseContext.sql)} `, {
          description: 'La query non è stata aggiunta al prompt e non è stata eseguita. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-database-query-context',
          title: 'Query non aggiunta al contesto AI',
        })
      },
    }] : []),
  ]

  const filteredRecents = recents.filter((recent) => recent.path.toLocaleLowerCase('it-IT').includes(search.toLocaleLowerCase('it-IT')))
  const terminalStatus = status === 'running' ? 'Pi pronto' : status === 'launching' ? 'Avvio Pi…' : status === 'ended' ? 'Sessione terminata' : status === 'error' ? 'Errore Pi' : 'In attesa'

  return <Tabs.Root asChild value={workspace ? appSection : appSection === 'settings' ? 'settings' : 'home'} onValueChange={({ value }) => selectAppSection(value === 'home' ? 'ai' : value as typeof appSection)}><main className={shellStyles.root}>
      <Toaster closeButton />
      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        items={paletteItems}
        emptyLabel={paletteMode === 'files' && indexingFiles ? 'Indicizzazione dei file in corso…' : undefined}
        onOpenChange={setPaletteOpen}
        onSelect={selectPaletteItem}
        onSelectionError={(nextError, item) => reportTransientFailure(nextError, {
          component: 'command-palette',
          operation: 'apply-selection',
          title: `Selezione “${item.label}” non applicata`,
          description: 'La palette è stata chiusa senza modificare lo stato corrente. Puoi riaprirla e riprovare.',
        }, { label: 'Riapri palette', onClick: () => setPaletteOpen(true) })}
      />
      <WorkspaceChangeDialog
        intent={lifecycleCloseRequest?.reason ?? 'workspace'}
        open={lifecycleCloseRequest !== null || workspaceChangeRequest !== null}
        saving={lifecycleCloseRequest ? savingBeforeLifecycleClose : savingBeforeWorkspaceChange}
        onCancel={lifecycleCloseRequest ? cancelLifecycleClose : () => setWorkspaceChangeRequest(null)}
        onDiscard={lifecycleCloseRequest ? () => void completeLifecycleClose('discard') : () => void discardAndChangeWorkspace()}
        onSave={lifecycleCloseRequest ? () => void completeLifecycleClose('save') : () => void saveAndChangeWorkspace()}
      />
      <header className={`window-toolbar ${shellStyles.toolbar}`}>
        <WorkspaceSwitcher appIconUrl={appIconUrl} currentPath={workspace} recents={recents} onChooseDirectory={openWorkspace} onOpenHere={openRecentWorkspace} onOpenNew={openWorkspaceInNewInstance} />
        <Tabs.List className={shellStyles.navigation} aria-label="Sezioni applicazione">
          {workspace && <>
          <Tabs.Trigger value="ai"><BookOpen aria-hidden="true" size={14} /> AI</Tabs.Trigger>
          <Tabs.Trigger value="editor"><FileCode2 aria-hidden="true" size={14} /> Editor</Tabs.Trigger>
          <Tabs.Trigger value="terminal"><TerminalSquare aria-hidden="true" size={14} /> Terminale</Tabs.Trigger>
          <Tabs.Trigger value="github"><GitFork aria-hidden="true" size={14} /> GitHub</Tabs.Trigger>
          <Tabs.Trigger value="database"><Database aria-hidden="true" size={14} /> Database</Tabs.Trigger>
          <Tabs.Trigger value="redis"><Boxes aria-hidden="true" size={14} /> Redis</Tabs.Trigger>
          </>}
          {!workspace && <Tabs.Trigger value="home"><LayoutGrid aria-hidden="true" size={14} /> Recenti</Tabs.Trigger>}
          <Tabs.Trigger value="settings"><Settings aria-hidden="true" size={14} /> Impostazioni</Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
      </header>

      {workspaceOpenFailure && <ErrorNotice
        action={{ label: 'Riprova apertura', pendingLabel: 'Apertura…', onClick: () => requestWorkspaceChange(workspaceOpenFailure.request) }}
        className={shellStyles.statusNotice}
        error={workspaceOpenFailure.error}
      />}

      {workspace && workspaceSessionRecovery && <ErrorNotice
        action={{
          label: workspaceSessionRecovery.kind === 'corrupt' ? 'Continua' : 'Salva di nuovo',
          pendingLabel: workspaceSessionRecovery.kind === 'corrupt' ? 'Ripristino…' : 'Salvataggio…',
          onClick: recoverWorkspaceSession,
        }}
        className={shellStyles.statusNotice}
        error={workspaceSessionRecovery.error}
      />}

      {workspace ? (
        <div className={shellStyles.sectionStack}>
        {shouldMountPersistentView(loadedSections, 'settings', appSection === 'settings') && <Tabs.Content asChild key="settings" value="settings"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="Impostazioni"><Suspense fallback={<div className={terminalStyles.loading}>Caricamento impostazioni…</div>}><AppSettings active={appSection === 'settings'} appearance={appearance} openRuntimeRequest={settingsRuntimeRequest} onAppearanceChange={changeAppearance} onWorkspaceGuardChange={handleSettingsWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        <Tabs.Content asChild key="ai" value="ai"><section className={`${shellStyles.sectionPage} ${aiStyles.workbench}`} key={workspace}>
          <Tabs.Root className={aiStyles.tabsRoot} value={aiTab} onValueChange={({ value }) => selectAiTab(value as typeof aiTab)}>
          <Tabs.List className={aiStyles.tabsList} aria-label="Sezioni AI">
            <Tabs.Trigger value="terminal"><TerminalSquare aria-hidden="true" size={15} /> Terminale AI</Tabs.Trigger>
            <Tabs.Trigger value="skills"><BookOpen aria-hidden="true" size={15} /> Skill progetto</Tabs.Trigger>
            <Tabs.Trigger value="instructions"><ScrollText aria-hidden="true" size={15} /> Istruzioni progetto</Tabs.Trigger>
            <Tabs.Indicator />
          </Tabs.List>
          <Tabs.Content value="terminal" className={aiStyles.tabPanel}><ViewErrorBoundary viewName="Terminale AI"><div className={terminalStyles.workspace} aria-label={`Terminale Pi: ${workspace}`}>
          <div className={terminalStyles.meta}>
            <span className={`${terminalStyles.statusDot} ${status === 'launching' ? terminalStyles.statusLaunching : status === 'error' ? terminalStyles.statusError : status !== 'running' ? terminalStyles.statusInactive : ''}`} aria-hidden="true" />
            <span>{workspace}</span>
          </div>
          <div className={terminalStyles.controls} aria-label="Controlli terminale">
            {(streamState?.status === 'paused' || streamState?.status === 'stalled') && <div className={terminalStyles.streamStatus} role="status"><Spinner size={14} /> Rendering rallentato · recupero automatico in corso</div>}
            {terminalSearchOpen ? (
              <Field.Root className={terminalStyles.find}>
                <Search aria-hidden="true" size={14} />
                <Field.Input className={terminalStyles.findInput} autoFocus aria-label="Cerca nel terminale" onChange={(event) => setTerminalQuery(event.target.value)} placeholder="Cerca nel terminale" value={terminalQuery} />
                <IconButton size="icon-xs" tooltip="Risultato precedente" onClick={() => terminalQuery && searchAddon.current?.findPrevious(terminalQuery)}><ChevronUp aria-hidden="true" size={14} /></IconButton>
                <IconButton size="icon-xs" tooltip="Risultato successivo" onClick={() => terminalQuery && searchAddon.current?.findNext(terminalQuery)}><ChevronDown aria-hidden="true" size={14} /></IconButton>
                <IconButton size="icon-xs" tooltip="Chiudi ricerca" onClick={closeTerminalSearch}><X aria-hidden="true" size={14} /></IconButton>
              </Field.Root>
            ) : <span className={terminalStyles.hint}>⌘F cerca · ⌘± zoom</span>}
            <IconButton className={terminalStyles.reload} tooltip="Ricarica Pi" onClick={() => void reloadPi()}><RefreshCw aria-hidden="true" size={15} /></IconButton>
            <TerminalToolbar fontSize={fontSize} statusLabel={terminalStatus} onClear={clearTerminal} onCopy={() => void copyTerminalSelection()} onPaste={() => void pasteIntoTerminal()} onResetZoom={resetTerminalZoom} onRestart={() => void restartPi()} onSearch={() => setTerminalSearchOpen(true)} onZoom={changeFontSize} />
          </div>
          <TerminalAttachments contextActions={aiContextActions} onInsert={sendAiInput} />
          <div className={terminalStyles.surface}><div className={terminalStyles.xtermHost} data-xterm-host="ai" key={workspace} ref={terminalElement} /></div>
          {pasteProgress && <TerminalPasteStatus
            failure={pasteFailure?.error}
            failureAction={pasteFailure && pasteFailure.recovery !== 'none'
              ? { label: terminalPasteRecoveryLabel(pasteFailure.recovery), onClick: recoverTerminalPaste }
              : undefined}
            progress={pasteProgress}
            onCancel={() => { void cancelTerminalPaste() }}
            onClose={closeTerminalPasteStatus}
          />}
          {hasUnreadTerminalOutput && <Button className={terminalStyles.newOutput} size="sm" variant="subtle" onClick={revealTerminalOutput}>Nuovo output</Button>}
          {aiFailure && <AiSessionErrorNotice failure={aiFailure} onOpenSettings={openAiSettings} onReload={reloadPi} onRestart={restartPi} onResumeOutput={retryAiOutput} onRetryTerminal={retryAiTerminal} />}
        </div></ViewErrorBoundary></Tabs.Content>
          {shouldMountPersistentView(loadedSections, 'skills', aiTab === 'skills') && <Tabs.Content value="skills" className={aiStyles.tabPanel}><ViewErrorBoundary viewName="Skill progetto"><Suspense fallback={<div className={terminalStyles.loading}>Caricamento Skill…</div>}><ProjectSkills workspace={workspace} onWorkspaceGuardChange={handleSkillsWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></Tabs.Content>}
          {shouldMountPersistentView(loadedSections, 'instructions', aiTab === 'instructions') && <Tabs.Content value="instructions" className={aiStyles.tabPanel}><ViewErrorBoundary viewName="Istruzioni progetto"><Suspense fallback={<div className={terminalStyles.loading}>Caricamento istruzioni…</div>}><ProjectInstructions onWorkspaceGuardChange={handleInstructionsWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></Tabs.Content>}
          </Tabs.Root>
        </section></Tabs.Content>
        {(loadedSections.editor || appSection === 'editor') && <Tabs.Content asChild key="editor" value="editor"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="Editor" onRetry={refreshWorkspaceSessionForRecovery}><BenchmarkViewFaultProbe viewName="Editor" /><Suspense fallback={<div className={terminalStyles.loading}>Caricamento editor…</div>}><ProjectEditor initialState={workspaceSessionState?.editor} key={workspace} remoteOpenRequest={remoteOpenRequest} workspace={workspace} workbenchRequest={editorWorkbenchRequest} onContextChange={setEditorContext} onOpenGitDiff={openGitDiffForFile} onSendContextToAi={sendEditorContextToAi} onSessionChange={updateEditorSession} onWorkspaceGuardChange={handleEditorWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        {(loadedSections.terminal || appSection === 'terminal') && <Tabs.Content asChild key="terminal" value="terminal"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="Terminale" onRetry={refreshWorkspaceSessionForRecovery}><Suspense fallback={<div className={terminalStyles.loading}>Caricamento terminale…</div>}><TerminalWorkspace actionRequest={terminalActionRequest} active={appSection === 'terminal'} focusRequest={terminalFocusRequest} initialState={workspaceSessionState?.terminal} key={workspace} workspace={workspace} onSessionChange={updateTerminalSession} onOpenRemoteFile={openRemoteFileInEditor} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        {(loadedSections.github || appSection === 'github') && <Tabs.Content asChild key="github" value="github"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="GitHub" onRetry={refreshWorkspaceSessionForRecovery}><Suspense fallback={<div className={terminalStyles.loading}>Caricamento GitHub…</div>}><GitHubWorkspace active={appSection === 'github'} initialState={workspaceSessionState?.github} key={workspace} workspace={workspace} workbenchRequest={githubWorkbenchRequest} onContextChange={setGitHubContext} onOpenFile={openWorkspaceFile} onSessionChange={updateGitHubSession} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        {(loadedSections.database || appSection === 'database') && <Tabs.Content asChild key="database" value="database"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="Database" onRetry={refreshWorkspaceSessionForRecovery}><Suspense fallback={<div className={terminalStyles.loading}>Caricamento Database…</div>}><DatabaseWorkspace focusRequest={databaseFocusRequest} initialState={workspaceSessionState?.database} key={workspace} workspace={workspace} onContextChange={setDatabaseContext} onSessionChange={updateDatabaseSession} onWorkspaceGuardChange={handleDatabaseWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        {(loadedSections.redis || appSection === 'redis') && <Tabs.Content asChild key="redis" value="redis"><section className={shellStyles.sectionPage}><ViewErrorBoundary viewName="Redis" onRetry={refreshWorkspaceSessionForRecovery}><Suspense fallback={<div className={terminalStyles.loading}>Caricamento Redis…</div>}><RedisWorkspace focusRequest={redisFocusRequest} initialState={workspaceSessionState?.redis} key={workspace} workspace={workspace} onContextChange={setRedisContext} onSessionChange={updateRedisSession} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        </div>
      ) : (
        <>
        {shouldMountPersistentView(loadedSections, 'settings', appSection === 'settings') && <Tabs.Content asChild value="settings"><section className={shellStyles.standalonePage}><ViewErrorBoundary viewName="Impostazioni"><Suspense fallback={<div className={terminalStyles.loading}>Caricamento impostazioni…</div>}><AppSettings active={appSection === 'settings'} appearance={appearance} openRuntimeRequest={settingsRuntimeRequest} onAppearanceChange={changeAppearance} onWorkspaceGuardChange={handleSettingsWorkspaceGuardChange} /></Suspense></ViewErrorBoundary></section></Tabs.Content>}
        <Tabs.Content asChild value="home"><section className={homeStyles.root} aria-label="Workspace recenti">
          <div className={homeStyles.content}>
            <div className={homeStyles.toolbar}>
              <SegmentGroup.Root className={homeStyles.viewControls} aria-label="Modalità di visualizzazione" orientation="horizontal" value={view} onValueChange={({ value }) => { if (value) setView(value as typeof view) }}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Item aria-label="Vista griglia" title="Vista griglia" value="grid"><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText><LayoutGrid aria-hidden="true" size={16} /></SegmentGroup.ItemText></SegmentGroup.Item>
                <SegmentGroup.Item aria-label="Vista elenco" title="Vista elenco" value="list"><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText><List aria-hidden="true" size={16} /></SegmentGroup.ItemText></SegmentGroup.Item>
              </SegmentGroup.Root>
              <h1 className={homeStyles.title}>Recenti <span className={homeStyles.count}>{recents.length}</span></h1>
              <Field.Root className={homeStyles.search}>
                <Search aria-hidden="true" size={14} />
                <Field.Input className={homeStyles.searchInput} aria-label="Cerca workspace" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca workspace…" type="search" />
              </Field.Root>
              <Button variant="outline" size="sm" onClick={openWorkspace} disabled={status === 'launching'}>
                <FolderOpen aria-hidden="true" /> Apri cartella…
              </Button>
            </div>

            <div className={homeStyles.body}>
              <div className={homeStyles.bodyHeader}>
                <div className={homeStyles.bodyHeadingCopy}>
                  <h2 className={homeStyles.bodyTitle}>Workspace recenti</h2>
                  <p className={homeStyles.bodyDescription}>Cartelle locali ordinate per ultimo utilizzo.</p>
                </div>
                <span className={homeStyles.bodyMeta}>{filteredRecents.length} {filteredRecents.length === 1 ? 'workspace' : 'workspace'}</span>
              </div>
              <WorkbenchPresence
                className={homeStyles.results}
                presenceKey={filteredRecents.length > 0 ? `recents-${view}` : search ? 'search-empty' : 'empty'}
              >
              {filteredRecents.length > 0 ? (
                <div className={view === 'grid' ? homeStyles.grid : homeStyles.list}>
                  {filteredRecents.map((recent) => (
                    <Button aria-busy={openingWorkspacePath === recent.path} className={homeStyles.card({ layout: view })} data-context-menu-id={recent.path} data-context-menu-kind="recent-workspace" key={recent.path} onClick={() => openRecentWorkspace(recent.path)} disabled={status === 'launching'} variant="plain">
                      <span className={homeStyles.cardIcon}><FolderOpen aria-hidden="true" size={20} /></span>
                      <span className={homeStyles.cardDetails}>
                        <strong className={homeStyles.cardName}>{workspaceName(recent.path)}</strong>
                        <small className={homeStyles.cardPath}>{recent.path}</small>
                      </span>
                      <time className={homeStyles.cardTime({ layout: view })} dateTime={new Date(recent.lastOpenedAt).toISOString()}>{openingWorkspacePath === recent.path ? 'Apertura…' : `Aperto ${formatLastOpened(recent.lastOpenedAt)}`}</time>
                      <ChevronRight className={homeStyles.cardChevron} aria-hidden="true" size={14} />
                    </Button>
                  ))}
                </div>
              ) : (
                <div className={homeStyles.empty}>
                  <div className={homeStyles.emptyIcon}><FolderOpen aria-hidden="true" size={32} /></div>
                  <h2 className={homeStyles.emptyTitle}>{search ? 'Nessun workspace trovato' : 'Nessun progetto recente'}</h2>
                  <p className={homeStyles.emptyDescription}>{search ? `Nessun risultato per “${search}”. Prova un percorso o un nome diverso.` : 'Non hai ancora aperto alcuna cartella in VincodeLab. Scegli una cartella per iniziare.'}</p>
                  {!search && <Button onClick={openWorkspace} disabled={status === 'launching'}><FolderOpen aria-hidden="true" /> Scegli cartella</Button>}
                </div>
              )}
              </WorkbenchPresence>
              {homeFailure && <ErrorNotice
                action={homeFailure.recovery === 'refresh-recents'
                  ? { label: 'Aggiorna recenti', pendingLabel: 'Aggiornamento…', onClick: refreshRecents }
                  : { label: 'Scegli cartella', onClick: openWorkspace }}
                error={homeFailure.error}
              />}
            </div>
          </div>
        </section></Tabs.Content>
        </>
      )}
    </main></Tabs.Root>
}

export default App
