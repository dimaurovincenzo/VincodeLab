import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import type { ProjectFileIndexEntry, RecentWorkspace } from '@/bridge'
import type { CommandPaletteItem, CommandPaletteMode } from '@/components/command-palette'
import type { EditorWorkbenchRequest } from '@/features/editor'
import type { TerminalWorkspaceAction } from '@/features/terminal'
import { dispatchApplicationMenuCommand } from '@/lib/app-menu-command'
import { reportRendererFailure, reportTransientFailure } from '@/lib/renderer-error'
import { WorkbenchCommandRegistry, type WorkbenchCommand } from '@/lib/workbench-command-registry'
import { WorkbenchUsageHistory } from '@/lib/workbench-history'
import type { AppSection, WorkbenchCommandContext, WorkspaceGuardScope } from '../model/app-controller.types'

type UseWorkbenchCommandsOptions = {
  aiTab: WorkbenchCommandContext['aiTab']
  appSection: AppSection
  beginFileIndexRequest: () => number
  changeFontSize: (delta: number) => void
  clearTerminal: () => void
  commandRegistry: WorkbenchCommandRegistry<WorkbenchCommandContext>
  copyTerminalSelection: () => void | Promise<void>
  databaseContext: WorkbenchCommandContext['database']
  editorContext: WorkbenchCommandContext['editor']
  githubContext: WorkbenchCommandContext['github']
  indexedFiles: ProjectFileIndexEntry[]
  isCurrentFileIndexRequest: (request: number) => boolean
  navigateToAppSection: (section: AppSection, focusPrimary?: boolean) => void
  openGitDiffForFile: (filePath: string) => void
  openRecentWorkspace: (workspacePath: string) => void
  openWorkspace: () => void
  openWorkspaceFile: (fileId: string) => void
  paletteMode: CommandPaletteMode
  paletteOpen: boolean
  pasteIntoTerminal: () => void | Promise<void>
  recents: RecentWorkspace[]
  redisContext: WorkbenchCommandContext['redis']
  reloadPi: () => void | Promise<void>
  requestEditorAction: (kind: Exclude<EditorWorkbenchRequest['kind'], 'open-file'>) => void
  requestTerminalAction: (action: TerminalWorkspaceAction) => void
  resetTerminalZoom: () => void
  restartPi: () => void | Promise<void>
  revealWorkspace: () => void | Promise<void>
  saveWorkspaceGuardScope: (scope: WorkspaceGuardScope) => Promise<void>
  selectAllTerminal: () => void
  selectAiTab: (tab: WorkbenchCommandContext['aiTab']) => void
  selectAppSection: (section: AppSection) => void
  sendEditorContextToAi: (includeSelection: boolean) => void
  setIndexedFiles: Dispatch<SetStateAction<ProjectFileIndexEntry[]>>
  setIndexingFiles: Dispatch<SetStateAction<boolean>>
  setPaletteMode: Dispatch<SetStateAction<CommandPaletteMode>>
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  setTerminalSearchOpen: Dispatch<SetStateAction<boolean>>
  usageHistory: WorkbenchUsageHistory
  workspace: string | null
}

function workspaceName(workspacePath: string) {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}

export function useWorkbenchCommands({
  aiTab,
  appSection,
  beginFileIndexRequest,
  changeFontSize,
  clearTerminal,
  commandRegistry,
  copyTerminalSelection,
  databaseContext,
  editorContext,
  githubContext,
  indexedFiles,
  isCurrentFileIndexRequest,
  navigateToAppSection,
  openGitDiffForFile,
  openRecentWorkspace,
  openWorkspace,
  openWorkspaceFile,
  paletteMode,
  paletteOpen,
  pasteIntoTerminal,
  recents,
  redisContext,
  reloadPi,
  requestEditorAction,
  requestTerminalAction,
  resetTerminalZoom,
  restartPi,
  revealWorkspace,
  saveWorkspaceGuardScope,
  selectAllTerminal,
  selectAiTab,
  selectAppSection,
  sendEditorContextToAi,
  setIndexedFiles,
  setIndexingFiles,
  setPaletteMode,
  setPaletteOpen,
  setTerminalSearchOpen,
  usageHistory,
  workspace,
}: UseWorkbenchCommandsOptions) {
  const [commandRegistryRevision, setCommandRegistryRevision] = useState(0)
  const [usageHistoryRevision, setUsageHistoryRevision] = useState(0)

  useEffect(() => commandRegistry.subscribe(() => setCommandRegistryRevision((current) => current + 1)), [commandRegistry])
  useEffect(() => usageHistory.subscribe(() => setUsageHistoryRevision((current) => current + 1)), [usageHistory])

  const openCommandPalette = useCallback(() => {
    setPaletteMode('commands')
    setPaletteOpen(true)
  }, [setPaletteMode, setPaletteOpen])

  const openQuickOpen = useCallback(function openQuickOpenAction() {
    setPaletteMode(workspace ? 'files' : 'workspaces')
    setPaletteOpen(true)
    if (!workspace) return
    const request = beginFileIndexRequest()
    setIndexingFiles(true)
    void appBridge.files.list().then((result) => {
      if (!isCurrentFileIndexRequest(request)) return
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
    void appBridge.files.index().then((result) => {
      if (isCurrentFileIndexRequest(request)) setIndexedFiles(result.files)
    }).catch((nextError) => {
      if (isCurrentFileIndexRequest(request)) {
        reportTransientFailure(nextError, {
          category: 'filesystem',
          component: 'quick-open',
          operation: 'index-workspace-files',
          title: 'Indice di Quick Open non aggiornato',
          description: 'I risultati già disponibili restano visibili. Puoi ricreare l’indice senza chiudere la palette.',
        }, { label: 'Riprova', onClick: openQuickOpenAction })
      }
    }).finally(() => {
      if (isCurrentFileIndexRequest(request)) setIndexingFiles(false)
    })
  }, [beginFileIndexRequest, isCurrentFileIndexRequest, setIndexedFiles, setIndexingFiles, setPaletteMode, setPaletteOpen, workspace])

  const reportCommandFailure = useCallback((commandId: string, cause: unknown) => {
    const commandTitle = commandRegistry.getState(commandId)?.command.title ?? 'Comando selezionato'
    reportTransientFailure(cause, {
      component: 'command-palette',
      operation: 'execute-command',
      title: `Comando “${commandTitle}” non eseguito`,
      description: 'L’azione non è stata applicata e lo stato corrente è rimasto invariato. Puoi scegliere di nuovo il comando.',
    }, { label: 'Apri comandi', onClick: openCommandPalette })
  }, [commandRegistry, openCommandPalette])

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
        await saveWorkspaceGuardScope(scope)
      } },
      { id: 'ai.reload', title: 'Ricarica risorse Pi (Pi diretto)', category: 'AI', shortcut: '⌘⌥R', when: workspaceOnly, run: () => reloadPi() },
      { id: 'ai.restart', title: 'Riavvia Terminale AI', category: 'AI', when: workspaceOnly, run: () => restartPi() },
      { id: 'ai.copy', title: 'Copia selezione Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => copyTerminalSelection() },
      { id: 'ai.paste', title: 'Incolla nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => pasteIntoTerminal() },
      { id: 'ai.search', title: 'Cerca nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: () => setTerminalSearchOpen(true) },
      { id: 'ai.selectAll', title: 'Seleziona tutto nel Terminale AI', category: 'AI', when: (context) => context.hasWorkspace && context.section === 'ai' && context.aiTab === 'terminal', run: selectAllTerminal },
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
      { id: 'redis.disconnect', title: 'Disconnetti Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => context.redis.canDisconnect, run: relay('redis.disconnect') },
      { id: 'redis.reconnect', title: 'Riconnetti Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => Boolean(context.redis.connectionId), run: relay('redis.reconnect') },
      { id: 'redis.cancel', title: 'Annulla ricerca Redis', category: 'Redis', when: inSection('redis'), enabled: (context) => context.redis.searching, run: relay('redis.cancel') },
      { id: 'settings.refresh', title: 'Aggiorna impostazioni e risorse', category: 'Impostazioni', when: (context) => context.section === 'settings', run: relay('settings.refresh') },
      { id: 'settings.resetWorkspacePreferences', title: 'Rimuovi personalizzazioni del workspace', category: 'Impostazioni', when: (context) => context.section === 'settings', enabled: (context) => context.hasWorkspace, run: relay('settings.resetWorkspacePreferences') },
    ]
  }, [changeFontSize, clearTerminal, copyTerminalSelection, navigateToAppSection, openCommandPalette, openGitDiffForFile, openQuickOpen, openWorkspace, pasteIntoTerminal, reloadPi, requestEditorAction, requestTerminalAction, resetTerminalZoom, restartPi, saveWorkspaceGuardScope, selectAiTab, selectAllTerminal, selectAppSection, sendEditorContextToAi, setTerminalSearchOpen])

  useEffect(() => commandRegistry.registerAll(workbenchCommands), [commandRegistry, workbenchCommands])

  useEffect(() => appBridge.appMenu.onCommand((command) => {
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
  }), [commandRegistry, openWorkspace, paletteOpen, reportCommandFailure, revealWorkspace, setPaletteOpen])

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

  return { paletteItems, selectPaletteItem }
}

export type WorkbenchCommandsController = ReturnType<typeof useWorkbenchCommands>
