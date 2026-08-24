const CONTEXT_ACTIONS_BY_SECTION = {
  home: [
    { label: 'Apri cartella…', command: 'workspace.open' },
    { type: 'separator' },
    { label: 'Apri rapidamente…', command: 'workbench.quickOpen' },
    { label: 'Palette comandi…', command: 'workbench.commandPalette' },
    { type: 'separator' },
    { label: 'Impostazioni…', command: 'navigation.settings' },
  ],
  ai: [
    { label: 'Cerca nel Terminale AI', command: 'ai.search' },
    { label: 'Seleziona tutto', command: 'ai.selectAll' },
    { label: 'Pulisci vista Terminale AI', command: 'ai.clear' },
    { type: 'separator' },
    { label: 'Aumenta zoom', command: 'ai.zoomIn' },
    { label: 'Riduci zoom', command: 'ai.zoomOut' },
    { label: 'Ripristina zoom', command: 'ai.zoomReset' },
    { type: 'separator' },
    { label: 'Ricarica risorse Pi (Pi diretto)', command: 'ai.reload' },
    { label: 'Riavvia Terminale AI', command: 'ai.restart' },
  ],
  'ai-skills': [
    { label: 'Salva Skill corrente', command: 'ai.save' },
    { type: 'separator' },
    { label: 'Ricarica risorse Pi (Pi diretto)', command: 'ai.reload' },
    { label: 'Riavvia Terminale AI', command: 'ai.restart' },
  ],
  'ai-instructions': [
    { label: 'Salva istruzioni', command: 'ai.save' },
    { type: 'separator' },
    { label: 'Ricarica risorse Pi (Pi diretto)', command: 'ai.reload' },
    { label: 'Riavvia Terminale AI', command: 'ai.restart' },
  ],
  editor: [
    { label: 'Salva file', command: 'editor.save' },
    { label: 'Cerca nel file', command: 'editor.search' },
    { type: 'separator' },
    { label: 'Focus Editor', command: 'editor.focus' },
    { label: 'Focus Explorer', command: 'editor.focusExplorer' },
    { type: 'separator' },
    { label: 'File successivo', command: 'editor.nextTab' },
    { label: 'File precedente', command: 'editor.previousTab' },
    { label: 'Chiudi file', command: 'editor.close' },
    { type: 'separator' },
    { label: 'Apri diff Git', command: 'editor.openCurrentDiff' },
    { label: 'Invia file a Pi', command: 'editor.sendFileToAi' },
    { label: 'Invia selezione a Pi', command: 'editor.sendSelectionToAi' },
    { type: 'separator' },
    { label: 'Aggiorna Explorer', command: 'editor.refresh' },
  ],
  terminal: [
    { label: 'Nuovo terminale', command: 'terminal.new' },
    { label: 'Terminale precedente', command: 'terminal.previous' },
    { label: 'Terminale successivo', command: 'terminal.next' },
    { label: 'Chiudi terminale', command: 'terminal.close' },
    { type: 'separator' },
    { label: 'Cerca nel terminale', command: 'terminal.search' },
    { label: 'Seleziona tutto', command: 'terminal.selectAll' },
    { label: 'Pulisci vista terminale', command: 'terminal.clear' },
    { type: 'separator' },
    { label: 'Aumenta zoom', command: 'terminal.zoomIn' },
    { label: 'Riduci zoom', command: 'terminal.zoomOut' },
    { label: 'Ripristina zoom', command: 'terminal.zoomReset' },
    { type: 'separator' },
    { label: 'Riavvia terminale', command: 'terminal.restart' },
  ],
  github: [
    { label: 'Focus Modifiche', command: 'github.focusChanges' },
    { type: 'separator' },
    { label: 'Aggiorna dati GitHub', command: 'github.refresh' },
    { label: 'Verifica aggiornamenti remoti…', command: 'github.fetch' },
  ],
  database: [
    { label: 'Focus editor SQL', command: 'database.focus' },
    { type: 'separator' },
    { label: 'Esegui SQL', command: 'database.execute' },
    { label: 'Annulla query attiva', command: 'database.cancel' },
    { label: 'Formatta SQL', command: 'database.format' },
    { label: 'Salva query corrente', command: 'database.saveQuery' },
    { label: 'Aggiorna schema', command: 'database.schema' },
    { type: 'separator' },
    { label: 'Inizia transazione', command: 'database.begin' },
    { label: 'Commit transazione', command: 'database.commit' },
    { label: 'Rollback transazione', command: 'database.rollback' },
  ],
  redis: [
    { label: 'Cerca chiavi o contenuti', command: 'redis.focusSearch' },
    { label: 'Aggiorna chiavi', command: 'redis.refresh' },
    { label: 'Annulla ricerca', command: 'redis.cancel' },
    { type: 'separator' },
    { label: 'Riconnetti', command: 'redis.reconnect' },
    { label: 'Nuova connessione…', command: 'redis.newConnection' },
  ],
  settings: [
    { label: 'Aggiorna impostazioni e risorse', command: 'settings.refresh' },
    { label: 'Rimuovi personalizzazioni workspace…', command: 'settings.resetWorkspacePreferences' },
    { type: 'separator' },
    { label: 'Apri cartella…', command: 'workspace.open' },
    { type: 'separator' },
    { label: 'Apri rapidamente…', command: 'workbench.quickOpen' },
    { label: 'Palette comandi…', command: 'workbench.commandPalette' },
  ],
}

const REMOTE_CONTEXT_ACTIONS = {
  'remote-file': [
    { label: 'Scarica e apri', command: 'remote.downloadOpen' },
    { label: 'Scarica in…', command: 'remote.downloadAs' },
    { type: 'separator' },
    { label: 'Copia percorso remoto', command: 'remote.copyPath' },
    { label: 'Rinomina…', command: 'remote.rename' },
    { type: 'separator' },
    { label: 'Elimina…', command: 'remote.delete', destructive: true },
  ],
  'remote-directory': [
    { label: 'Apri cartella', command: 'remote.openDirectory' },
    { type: 'separator' },
    { label: 'Copia percorso remoto', command: 'remote.copyPath' },
    { label: 'Rinomina…', command: 'remote.rename' },
    { type: 'separator' },
    { label: 'Elimina…', command: 'remote.delete', destructive: true },
  ],
  'remote-local-file': [
    { label: 'Apri nell’Editor', command: 'remoteLocal.open' },
    { label: 'Mostra copia nel Finder', command: 'remoteLocal.reveal' },
    { type: 'separator' },
    { label: 'Copia percorso remoto', command: 'remoteLocal.copyPath' },
    { type: 'separator' },
    { label: 'Scarta copia locale…', command: 'remoteLocal.discard', destructive: true },
  ],
  'remote-transfer': [
    { label: 'Annulla trasferimento', command: 'remoteTransfer.cancel', requiresFlag: 'cancellable' },
    { label: 'Riprova trasferimento', command: 'remoteTransfer.retry', requiresFlag: 'retryable' },
  ],
}

const WORKSPACE_CONTEXT_ACTIONS = {
  'workspace-file': [
    { label: 'Apri', command: 'workspaceFile.open' },
    { label: 'Apri con…', command: 'workspaceFile.openWith' },
    { type: 'separator' },
    { label: 'Rinomina…', command: 'workspaceFile.rename' },
    { label: 'Duplica', command: 'workspaceFile.duplicate' },
    { type: 'separator' },
    { label: 'Copia nome', command: 'workspaceEntry.copyName' },
    { label: 'Copia percorso relativo', command: 'workspaceEntry.copyRelativePath' },
    { label: 'Copia percorso completo', command: 'workspaceEntry.copyAbsolutePath' },
    { label: 'Mostra nel Finder', command: 'workspaceEntry.reveal' },
    { type: 'separator' },
    { label: 'Sposta nel Cestino…', command: 'workspaceFile.trash', destructive: true },
  ],
  'workspace-directory': [
    { label: 'Nuovo file', command: 'workspaceDirectory.newFile' },
    { label: 'Nuova cartella…', command: 'workspaceDirectory.newDirectory' },
    { type: 'separator' },
    { dynamic: 'directory-toggle' },
    { label: 'Aggiorna Explorer', command: 'workspaceExplorer.refresh' },
    { type: 'separator' },
    { label: 'Rinomina…', command: 'workspaceDirectory.rename' },
    { label: 'Duplica', command: 'workspaceDirectory.duplicate' },
    { type: 'separator' },
    { label: 'Copia nome', command: 'workspaceEntry.copyName' },
    { label: 'Copia percorso relativo', command: 'workspaceEntry.copyRelativePath' },
    { label: 'Copia percorso completo', command: 'workspaceEntry.copyAbsolutePath' },
    { label: 'Mostra nel Finder', command: 'workspaceEntry.reveal' },
    { type: 'separator' },
    { label: 'Sposta nel Cestino…', command: 'workspaceDirectory.trash', destructive: true },
  ],
  'workspace-root': [
    { label: 'Nuovo file', command: 'workspaceDirectory.newFile' },
    { label: 'Nuova cartella…', command: 'workspaceDirectory.newDirectory' },
    { type: 'separator' },
    { label: 'Comprimi tutte le cartelle', command: 'workspaceExplorer.collapseAll' },
    { label: 'Aggiorna Explorer', command: 'workspaceExplorer.refresh' },
    { type: 'separator' },
    { label: 'Copia percorso workspace', command: 'workspaceEntry.copyAbsolutePath' },
    { label: 'Mostra workspace nel Finder', command: 'workspaceEntry.reveal' },
  ],
  'editor-workspace-tab': [
    { label: 'Salva', command: 'editorTab.save', requiresFlag: 'dirty' },
    { type: 'separator' },
    { label: 'Rinomina…', command: 'workspaceFile.rename' },
    { label: 'Duplica', command: 'workspaceFile.duplicate' },
    { label: 'Apri con…', command: 'workspaceFile.openWith' },
    { label: 'Mostra nel Finder', command: 'workspaceEntry.reveal' },
    { type: 'separator' },
    { label: 'Copia nome', command: 'workspaceEntry.copyName' },
    { label: 'Copia percorso relativo', command: 'workspaceEntry.copyRelativePath' },
    { label: 'Copia percorso completo', command: 'workspaceEntry.copyAbsolutePath' },
    { type: 'separator' },
    { label: 'Chiudi', command: 'editorTab.close' },
    { label: 'Chiudi gli altri', command: 'editorTab.closeOthers', requiresFlag: 'hasOtherTabs' },
    { label: 'Chiudi a destra', command: 'editorTab.closeRight', requiresFlag: 'hasRightTabs' },
    { label: 'Chiudi tutti', command: 'editorTab.closeAll' },
    { type: 'separator' },
    { label: 'Sposta nel Cestino…', command: 'workspaceFile.trash', destructive: true },
  ],
  'editor-remote-tab': [
    { label: 'Salva copia locale', command: 'editorTab.save', requiresFlag: 'dirty' },
    { label: 'Confronta con il server', command: 'editorRemote.compare' },
    { label: 'Carica sul server…', command: 'editorRemote.upload' },
    { label: 'Mostra copia nel Finder', command: 'editorRemote.reveal' },
    { type: 'separator' },
    { label: 'Chiudi', command: 'editorTab.close' },
    { label: 'Chiudi gli altri', command: 'editorTab.closeOthers', requiresFlag: 'hasOtherTabs' },
    { label: 'Chiudi a destra', command: 'editorTab.closeRight', requiresFlag: 'hasRightTabs' },
    { label: 'Chiudi tutti', command: 'editorTab.closeAll' },
  ],
}

const RECENT_WORKSPACE_ACTIONS = [
  { label: 'Apri', command: 'recentWorkspace.open' },
  { label: 'Apri in una nuova finestra', command: 'recentWorkspace.openNew' },
  { type: 'separator' },
  { label: 'Copia percorso', command: 'recentWorkspace.copyPath' },
  { label: 'Mostra nel Finder', command: 'recentWorkspace.reveal' },
]

const TERMINAL_TAB_ACTIONS = [
  { label: 'Attiva terminale', command: 'terminalTab.activate' },
  { label: 'Nuovo terminale', command: 'terminalTab.new', requiresFlag: 'canCreate' },
  { type: 'separator' },
  { label: 'Riavvia terminale', command: 'terminalTab.restart', requiresFlag: 'operable' },
  { label: 'Chiudi terminale', command: 'terminalTab.close', requiresFlag: 'operable' },
]

const GIT_FILE_ACTIONS = {
  'git-unstaged-file': [
    { label: 'Mostra modifiche', command: 'gitFile.diff', requiresFlag: 'operable' },
    { label: 'Apri nell’Editor', command: 'gitFile.open', requiresFlag: 'operable' },
    { type: 'separator' },
    { label: 'Aggiungi allo staging', command: 'gitFile.stage', requiresFlag: 'stageable' },
    { type: 'separator' },
    { label: 'Copia percorso', command: 'gitFile.copyPath' },
    { label: 'Mostra nel Finder', command: 'gitFile.reveal' },
  ],
  'git-staged-file': [
    { label: 'Mostra modifiche', command: 'gitFile.diff', requiresFlag: 'operable' },
    { label: 'Apri nell’Editor', command: 'gitFile.open', requiresFlag: 'operable' },
    { type: 'separator' },
    { label: 'Rimuovi dallo staging', command: 'gitFile.unstage', requiresFlag: 'operable' },
    { type: 'separator' },
    { label: 'Copia percorso', command: 'gitFile.copyPath' },
    { label: 'Mostra nel Finder', command: 'gitFile.reveal' },
  ],
}

const REDIS_KEY_ACTIONS = [
  { label: 'Apri nell’inspector', command: 'redisKey.open' },
  { label: 'Cerca nel contenuto', command: 'redisKey.searchPayload' },
  { label: 'Aggiorna', command: 'redisKey.refresh' },
  { type: 'separator' },
  { label: 'Copia nome chiave', command: 'redisKey.copyName' },
  { label: 'Copia valore visibile', command: 'redisKey.copyVisibleValue', requiresFlag: 'hasVisibleValue' },
]

const NATIVE_ROLE_LABELS = {
  undo: 'Annulla',
  redo: 'Ripeti',
  cut: 'Taglia',
  copy: 'Copia',
  paste: 'Incolla',
  selectAll: 'Seleziona tutto',
}

function nativeItem(role, enabled) {
  return { role, label: NATIVE_ROLE_LABELS[role], enabled: Boolean(enabled) }
}

function commandEnabled(command, params) {
  return !Array.isArray(params?.enabledCommands) || params.enabledCommands.includes(command)
}

function commandItem(item, onCommand, params) {
  if (item.type === 'separator') return item
  return { ...item, enabled: commandEnabled(item.command, params), click: () => onCommand(item.command) }
}

function editableItems(editFlags = {}) {
  return [
    nativeItem('undo', editFlags.canUndo),
    nativeItem('redo', editFlags.canRedo),
    { type: 'separator' },
    nativeItem('cut', editFlags.canCut),
    nativeItem('copy', editFlags.canCopy),
    nativeItem('paste', editFlags.canPaste),
    { type: 'separator' },
    nativeItem('selectAll', editFlags.canSelectAll),
  ]
}

function baseItems(activeSection, params, onCommand) {
  if (params?.isEditable) return editableItems(params.editFlags)

  // xterm disegna il testo su canvas: i ruoli DOM non possono raggiungere la
  // selezione o il PTY. Il bridge applicativo viene usato soltanto sul canvas,
  // non su toolbar, allegati o altre regioni della stessa pagina.
  if (params?.surfaceKind === 'terminal' && (activeSection === 'ai' || activeSection === 'terminal')) {
    return [
      commandItem({ label: 'Copia', command: `${activeSection}.copy` }, onCommand, params),
      commandItem({ label: 'Incolla', command: `${activeSection}.paste` }, onCommand, params),
    ]
  }

  const hasSelection = typeof params?.selectionText === 'string' && params.selectionText.length > 0
  return [
    nativeItem('copy', params?.editFlags?.canCopy || hasSelection),
    nativeItem('paste', false),
  ]
}

function resolveDynamicContextItem(item, params) {
  if (item.dynamic !== 'directory-toggle') return item
  return params?.contextFlags?.expanded
    ? { label: 'Comprimi cartella', command: 'workspaceDirectory.collapse' }
    : { label: 'Espandi cartella', command: 'workspaceDirectory.expand' }
}

function contextCommandItem(item, params, onContextCommand) {
  if (item.type === 'separator') return item
  const resolved = resolveDynamicContextItem(item, params)
  const flagEnabled = !resolved.requiresFlag || params?.contextFlags?.[resolved.requiresFlag] === true
  const explicitlyEnabled = !Array.isArray(params?.enabledContextCommands) || params.enabledContextCommands.includes(resolved.command)
  return {
    ...resolved,
    enabled: flagEnabled && explicitlyEnabled,
    click: () => onContextCommand(resolved.command, params.contextId, params.contextKind),
  }
}

function contextualItems(items, params, onContextCommand) {
  return items
    .map((item) => contextCommandItem(item, params, onContextCommand))
    .filter((item, index, all) => item.type !== 'separator' || (index > 0 && index < all.length - 1 && all[index - 1]?.type !== 'separator'))
}

function createContextMenuTemplate({ activeSection, params = {}, onCommand, onContextCommand = () => undefined }) {
  if (Object.hasOwn(REMOTE_CONTEXT_ACTIONS, params.contextKind)) {
    return contextualItems(REMOTE_CONTEXT_ACTIONS[params.contextKind], params, onContextCommand)
  }
  if (Object.hasOwn(WORKSPACE_CONTEXT_ACTIONS, params.contextKind)) {
    return contextualItems(WORKSPACE_CONTEXT_ACTIONS[params.contextKind], params, onContextCommand)
  }
  if (params.contextKind === 'recent-workspace') {
    return contextualItems(RECENT_WORKSPACE_ACTIONS, params, onContextCommand)
  }
  if (params.contextKind === 'terminal-tab') {
    return contextualItems(TERMINAL_TAB_ACTIONS, params, onContextCommand)
  }
  if (Object.hasOwn(GIT_FILE_ACTIONS, params.contextKind)) {
    return contextualItems(GIT_FILE_ACTIONS[params.contextKind], params, onContextCommand)
  }
  if (params.contextKind === 'redis-key') {
    return contextualItems(REDIS_KEY_ACTIONS, params, onContextCommand)
  }
  const section = Object.hasOwn(CONTEXT_ACTIONS_BY_SECTION, activeSection) ? activeSection : 'home'
  const base = baseItems(section, params, onCommand)
  const actions = CONTEXT_ACTIONS_BY_SECTION[section].map((item) => commandItem(item, onCommand, params))
  return actions.length ? [...base, { type: 'separator' }, ...actions] : base
}

module.exports = { createContextMenuTemplate }
