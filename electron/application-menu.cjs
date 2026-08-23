const APP_SECTIONS = new Set(['home', 'ai', 'ai-skills', 'ai-instructions', 'editor', 'terminal', 'github', 'database', 'settings'])

const AI_RESOURCE_ACTIONS = [
  { label: 'Salva risorsa corrente', command: 'ai.save', accelerator: 'CmdOrCtrl+S' },
  { label: 'Ricarica risorse Pi', command: 'ai.reload', accelerator: 'CmdOrCtrl+Alt+R' },
  { label: 'Riavvia sessione Pi', command: 'ai.restart' },
]

const ACTIONS_BY_SECTION = {
  home: [],
  ai: [
    { label: 'Ricarica risorse Pi', command: 'ai.reload', accelerator: 'CmdOrCtrl+Alt+R' },
    { label: 'Riavvia sessione Pi', command: 'ai.restart' },
  ],
  'ai-skills': AI_RESOURCE_ACTIONS,
  'ai-instructions': AI_RESOURCE_ACTIONS,
  editor: [
    { label: 'Salva file', command: 'editor.save', accelerator: 'CmdOrCtrl+S' },
    { label: 'Cerca nel file', command: 'editor.search', accelerator: 'CmdOrCtrl+F' },
    { label: 'Focus Explorer', command: 'editor.focusExplorer', accelerator: 'CmdOrCtrl+Shift+E' },
    { label: 'File successivo', command: 'editor.nextTab', accelerator: 'Ctrl+Tab' },
    { label: 'File precedente', command: 'editor.previousTab', accelerator: 'Ctrl+Shift+Tab' },
    { label: 'Chiudi file', command: 'editor.close', accelerator: 'CmdOrCtrl+W' },
    { label: 'Aggiorna Explorer', command: 'editor.refresh' },
  ],
  terminal: [
    { label: 'Nuovo terminale', command: 'terminal.new' },
    { label: 'Terminale precedente', command: 'terminal.previous', accelerator: 'CmdOrCtrl+Shift+[' },
    { label: 'Terminale successivo', command: 'terminal.next', accelerator: 'CmdOrCtrl+Shift+]' },
    { label: 'Chiudi terminale', command: 'terminal.close', accelerator: 'CmdOrCtrl+W' },
    { type: 'separator' },
    { label: 'Cerca nel terminale', command: 'terminal.search', accelerator: 'CmdOrCtrl+F' },
    { label: 'Pulisci vista terminale', command: 'terminal.clear', accelerator: 'CmdOrCtrl+K' },
    { label: 'Riavvia terminale', command: 'terminal.restart' },
  ],
  github: [
    { label: 'Aggiorna dati GitHub', command: 'github.refresh', accelerator: 'CmdOrCtrl+Alt+G' },
    { label: 'Verifica aggiornamenti remoti…', command: 'github.fetch' },
  ],
  database: [
    { label: 'Esegui SQL', command: 'database.execute', accelerator: 'CmdOrCtrl+Enter' },
    { label: 'Formatta SQL', command: 'database.format', accelerator: 'Alt+Shift+F' },
    { label: 'Aggiorna schema', command: 'database.schema', accelerator: 'CmdOrCtrl+Alt+R' },
  ],
  settings: [],
}

const NAVIGATION_ITEMS = [
  { label: 'Terminale AI', command: 'navigation.ai', accelerator: 'CmdOrCtrl+1', requiresWorkspace: true },
  { label: 'Editor', command: 'navigation.editor', accelerator: 'CmdOrCtrl+2', requiresWorkspace: true },
  { label: 'Terminale', command: 'navigation.terminal', accelerator: 'CmdOrCtrl+3', requiresWorkspace: true },
  { label: 'GitHub', command: 'navigation.github', accelerator: 'CmdOrCtrl+4', requiresWorkspace: true },
  { label: 'Database', command: 'navigation.database', accelerator: 'CmdOrCtrl+5', requiresWorkspace: true },
  { label: 'Focus Terminale', command: 'terminal.focus', accelerator: 'Ctrl+`', requiresWorkspace: true },
  { label: 'Nuovo terminale', command: 'terminal.new', accelerator: 'Ctrl+Shift+`', requiresWorkspace: true },
  { type: 'separator' },
  { label: 'Impostazioni…', command: 'navigation.settings' },
]

const WORKBENCH_ITEMS = [
  { label: 'Palette comandi…', command: 'workbench.commandPalette', accelerator: 'CmdOrCtrl+Shift+P' },
  { label: 'Apri rapidamente…', command: 'workbench.quickOpen', accelerator: 'CmdOrCtrl+P' },
]

// I menu contestuali riusano lo stesso bus validato del menu applicazione.
// Questi comandi non devono necessariamente comparire nella barra menu: sono
// azioni renderer contestuali, ma restano esplicitamente allowlisted nel main.
const CONTEXT_MENU_APPLICATION_COMMANDS = [
  'ai.skills',
  'ai.instructions',
  'ai.search',
  'ai.selectAll',
  'ai.clear',
  'ai.zoomIn',
  'ai.zoomOut',
  'ai.zoomReset',
  'editor.focus',
  'editor.openCurrentDiff',
  'editor.sendFileToAi',
  'editor.sendSelectionToAi',
  'terminal.selectAll',
  'terminal.zoomIn',
  'terminal.zoomOut',
  'terminal.zoomReset',
  'github.focusChanges',
  'database.focus',
  'database.cancel',
  'database.saveQuery',
  'database.begin',
  'database.commit',
  'database.rollback',
  'settings.refresh',
  'settings.resetWorkspacePreferences',
]

const APPLICATION_MENU_COMMANDS = new Set([
  'workspace.open',
  'workspace.reveal',
  'ai.copy',
  'ai.paste',
  'terminal.copy',
  'terminal.paste',
  ...WORKBENCH_ITEMS.map((item) => item.command),
  ...NAVIGATION_ITEMS.filter((item) => item.command).map((item) => item.command),
  ...Object.values(ACTIONS_BY_SECTION).flat().filter((item) => item.command).map((item) => item.command),
  ...CONTEXT_MENU_APPLICATION_COMMANDS,
])

function isApplicationMenuCommand(command) {
  return typeof command === 'string' && APPLICATION_MENU_COMMANDS.has(command)
}

function commandItem(item, onCommand, enabled = true) {
  return {
    ...item,
    enabled,
    click: () => onCommand(item.command),
  }
}

function createApplicationMenuTemplate({ appName = 'VincodeLab', activeSection, hasWorkspace, isDevelopment, onCommand }) {
  const section = APP_SECTIONS.has(activeSection) ? activeSection : 'home'
  const actions = ACTIONS_BY_SECTION[section]
  const actionMenu = actions.length
    ? actions.map((item) => item.type === 'separator' ? item : commandItem(item, onCommand, hasWorkspace || section === 'settings'))
    : [{ label: section === 'settings' ? 'Nessuna azione disponibile' : 'Apri un workspace per usare le azioni', enabled: false }]

  const viewItems = [
    ...(isDevelopment ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        commandItem({ label: 'Impostazioni…', command: 'navigation.settings', accelerator: 'CmdOrCtrl+,' }, onCommand),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Workspace',
      submenu: [
        commandItem({ label: 'Apri cartella…', command: 'workspace.open', accelerator: 'CmdOrCtrl+O' }, onCommand),
        commandItem({ label: 'Mostra nel Finder', command: 'workspace.reveal' }, onCommand, hasWorkspace),
        { type: 'separator' },
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Vai',
      submenu: [
        ...WORKBENCH_ITEMS.map((item) => commandItem(item, onCommand)),
        { type: 'separator' },
        ...NAVIGATION_ITEMS.map((item) => item.type === 'separator'
          ? item
          : commandItem(item, onCommand, !item.requiresWorkspace || hasWorkspace)),
      ],
    },
    { label: 'Azioni', submenu: actionMenu },
    { label: 'Vista', submenu: viewItems },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
}

module.exports = { APP_SECTIONS, WORKBENCH_ITEMS, createApplicationMenuTemplate, isApplicationMenuCommand }
