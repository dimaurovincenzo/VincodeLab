const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MENU_CONTEXT_INVOKE_CHANNELS,
  MENU_CONTEXT_SEND_CHANNELS,
  createMenuContextHandlers,
  createMenuContextListeners,
  registerMenuContextIpc,
} = require('../electron/ipc/domains/menu-context.ipc.cjs')

const UUID = '123e4567-e89b-42d3-a456-426614174000'

function menuContextFixture(overrides = {}) {
  const calls = []
  const handles = new Map()
  const listeners = new Map()
  const template = [{ label: 'Menu fixture' }]
  const popupResult = { shown: true }
  let activeSection = 'editor'
  const dispatchApplicationMenuCommand = () => undefined
  const dispatchContextMenuCommand = () => undefined
  const menu = {
    popup: (options) => { calls.push(['popup', options]); return popupResult },
  }
  const dependencies = {
    appSections: new Set(['home', 'editor', 'terminal', 'github']),
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    buildMenuFromTemplate: (receivedTemplate) => {
      calls.push(['build-menu', receivedTemplate])
      return menu
    },
    confineIpcOneWay: (channel, listener) => {
      const confined = (...args) => listener(...args)
      calls.push(['confine', channel, listener, confined])
      return confined
    },
    createContextMenuTemplate: (input) => {
      calls.push(['template', input])
      return template
    },
    createMenu: () => { calls.push(['create-menu']) },
    dispatchApplicationMenuCommand,
    dispatchContextMenuCommand,
    getActiveAppSection: () => { calls.push(['get-section']); return activeSection },
    getMainWindow: () => { calls.push(['get-window']); return { id: 'main-window' } },
    isApplicationMenuCommand: (command) => ['editor.save', 'terminal.copy'].includes(command),
    listRecentWorkspaces: () => {
      calls.push(['list-recents'])
      return [{ path: '/workspace/recent' }]
    },
    log: (...args) => { calls.push(['log', ...args]) },
    requireActiveWorkspace: () => { calls.push(['workspace']); return '/workspace/current' },
    resolveProjectDirectory: (workspacePath, directoryId) => {
      calls.push(['resolve-directory', workspacePath, directoryId])
      return directoryId ? `${workspacePath}/${directoryId}` : workspacePath
    },
    resolveProjectFile: (workspacePath, fileId) => {
      calls.push(['resolve-file', workspacePath, fileId])
      return `${workspacePath}/${fileId}`
    },
    setActiveAppSection: (section) => { calls.push(['set-section', section]); activeSection = section },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handles.has(channel), false, `invoke duplicato: ${channel}`)
      handles.set(channel, handler)
    },
    on(channel, listener) {
      assert.equal(listeners.has(channel), false, `send duplicato: ${channel}`)
      listeners.set(channel, listener)
    },
  }
  return {
    calls,
    dependencies,
    dispatchApplicationMenuCommand,
    dispatchContextMenuCommand,
    handles,
    ipcMain,
    listeners,
    popupResult,
    template,
  }
}

function lastTemplateInput(calls) {
  return calls.findLast(([kind]) => kind === 'template')?.[1]
}

test('registra manifesti invoke e send confinando il listener one-way', () => {
  const fixture = menuContextFixture()
  const registration = registerMenuContextIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })
  const confinement = fixture.calls.find(([kind]) => kind === 'confine')

  assert.deepEqual(MENU_CONTEXT_INVOKE_CHANNELS, ['contextMenu:open'])
  assert.deepEqual(MENU_CONTEXT_SEND_CHANNELS, ['appMenu:setContext'])
  assert.deepEqual([...fixture.handles.keys()], MENU_CONTEXT_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.listeners.keys()], MENU_CONTEXT_SEND_CHANNELS)
  assert.equal(fixture.listeners.get('appMenu:setContext'), confinement[3])
  assert.deepEqual(registration.invokeChannels, MENU_CONTEXT_INVOKE_CHANNELS)
  assert.deepEqual(registration.sendChannels, MENU_CONTEXT_SEND_CHANNELS)
  assert.equal(Object.isFrozen(registration), true)
})

test('setContext valida la sezione, evita rebuild identici e aggiorna prima del menu', () => {
  const fixture = menuContextFixture()
  const listener = createMenuContextListeners(fixture.dependencies).get('appMenu:setContext')
  const event = { sender: { id: 7 } }

  listener(event, 'editor')
  assert.deepEqual(fixture.calls, [['guard', event], ['get-section']])

  fixture.calls.length = 0
  listener(event, 'github')
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['get-section'],
    ['set-section', 'github'],
    ['create-menu'],
  ])

  fixture.calls.length = 0
  assert.equal(listener(event, 'unknown'), undefined)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['log', 'warn', 'application_menu_context_rejected'],
  ])
})

test('tutti i kind riconosciuti conservano ID e validazioni contestuali', () => {
  const fixture = menuContextFixture()
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
  const event = { sender: { id: 9 } }
  const cases = [
    ['remote-file', UUID],
    ['remote-directory', UUID],
    ['remote-local-file', UUID],
    ['remote-transfer', UUID],
    ['editor-remote-tab', UUID],
    ['workspace-file', 'src/App.tsx'],
    ['editor-workspace-tab', 'README.md'],
    ['workspace-directory', 'src'],
    ['workspace-root', null],
    ['recent-workspace', '/workspace/recent'],
    ['terminal-tab', UUID],
    ['git-unstaged-file', 'src/App.tsx'],
    ['git-staged-file', 'README.md'],
    ['redis-key', 'cmVkaXM6a2V5'],
  ]

  for (const [kind, contextId] of cases) {
    fixture.calls.length = 0
    const request = { kind, ...(contextId === null ? {} : { contextId }) }
    assert.deepEqual(handler(event, request), { opened: true }, kind)
    const input = lastTemplateInput(fixture.calls)
    assert.equal(input.activeSection, 'editor', kind)
    assert.equal(input.params.contextKind, kind, kind)
    assert.equal(input.params.contextId, contextId, kind)
    assert.equal(input.onCommand, fixture.dispatchApplicationMenuCommand, kind)
    assert.equal(input.onContextCommand, fixture.dispatchContextMenuCommand, kind)
    assert.deepEqual(fixture.calls.slice(-3), [
      ['build-menu', fixture.template],
      ['get-window'],
      ['popup', { window: { id: 'main-window' } }],
    ], kind)
  }
})

test('normalizza superficie, selezione, enabledCommands e tutti i flag con booleani stretti', () => {
  const fixture = menuContextFixture()
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
  const flags = {
    expanded: true,
    cancellable: true,
    retryable: true,
    stageable: true,
    dirty: true,
    hasOtherTabs: true,
    hasRightTabs: true,
    operable: true,
    canCreate: true,
    hasVisibleValue: true,
  }

  assert.deepEqual(handler({}, {
    kind: 'terminal',
    editable: true,
    hasSelection: true,
    enabledCommands: ['terminal.copy'],
    contextFlags: flags,
  }), { opened: true })
  assert.deepEqual(lastTemplateInput(fixture.calls).params, {
    isEditable: false,
    surfaceKind: 'terminal',
    selectionText: 'selected',
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: false,
      canSelectAll: false,
    },
    enabledCommands: ['terminal.copy'],
    contextFlags: flags,
  })

  fixture.calls.length = 0
  handler({}, { editable: true, hasSelection: true, contextFlags: { dirty: 1, operable: 'yes' } })
  assert.deepEqual(lastTemplateInput(fixture.calls).params.editFlags, {
    canUndo: true,
    canRedo: true,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canSelectAll: true,
  })
  assert.equal(lastTemplateInput(fixture.calls).params.contextFlags.dirty, false)
  assert.equal(lastTemplateInput(fixture.calls).params.contextFlags.operable, false)
})

test('risolve file, directory, radice, Git e recenti nel solo workspace attivo', () => {
  const fixture = menuContextFixture()
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')

  for (const [request, expectedAfterGuard] of [
    [
      { kind: 'workspace-file', contextId: 'src/App.tsx' },
      [['workspace'], ['resolve-file', '/workspace/current', 'src/App.tsx']],
    ],
    [
      { kind: 'workspace-directory', contextId: 'src' },
      [['workspace'], ['resolve-directory', '/workspace/current', 'src']],
    ],
    [
      { kind: 'workspace-root' },
      [['workspace'], ['resolve-directory', '/workspace/current', '']],
    ],
    [
      { kind: 'git-staged-file', contextId: 'src/App.tsx' },
      [['workspace'], ['resolve-directory', '/workspace/current', '']],
    ],
    [
      { kind: 'recent-workspace', contextId: '/workspace/recent' },
      [['list-recents']],
    ],
  ]) {
    fixture.calls.length = 0
    const event = {}
    handler(event, request)
    const expectedPrefix = [['guard', event], ...expectedAfterGuard]
    assert.deepEqual(fixture.calls.slice(0, expectedPrefix.length), expectedPrefix, request.kind)
  }
})

test('rifiuta kind e ID non validi prima di costruire il menu', () => {
  const fixture = menuContextFixture()
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
  const cases = [
    [{ kind: 'remote-file', contextId: 'not-a-uuid' }, /Elemento remoto non valido\./],
    [{ kind: 'terminal-tab', contextId: 'not-a-uuid' }, /Sessione terminale non valida\./],
    [{ kind: 'workspace-file' }, /File del workspace non valido\./],
    [{ kind: 'workspace-directory' }, /Cartella del workspace non valida\./],
    [{ kind: 'recent-workspace', contextId: '/workspace/missing' }, /Workspace recente non valido\./],
    [{ kind: 'git-unstaged-file' }, /File Git non valido\./],
    [{ kind: 'git-unstaged-file', contextId: '../outside.txt' }, /File Git non valido\./],
    [{ kind: 'git-staged-file', contextId: '.' }, /File Git non valido\./],
    [{ kind: 'git-staged-file', contextId: 'src\0secret.txt' }, /File Git non valido\./],
    [{ kind: 'redis-key', contextId: 'chiave con spazi' }, /Chiave Redis non valida\./],
  ]

  for (const [request, expected] of cases) {
    fixture.calls.length = 0
    assert.throws(() => handler({}, request), expected)
    assert.equal(fixture.calls.some(([kind]) => kind === 'template' || kind === 'popup'), false)
  }
})

test('enabledCommands accetta solo la allowlist bounded e non trasforma kind sconosciuti in contesto', () => {
  const fixture = menuContextFixture()
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
  const invalid = [
    { enabledCommands: 'editor.save' },
    { enabledCommands: Array.from({ length: 101 }, () => 'editor.save') },
    { enabledCommands: ['not.allowed'] },
  ]

  for (const request of invalid) {
    assert.throws(() => handler({}, request), /Stato comandi contestuali non valido\./)
  }

  fixture.calls.length = 0
  assert.deepEqual(handler({}, { kind: 'unknown', contextId: 'ignored' }), { opened: true })
  const params = lastTemplateInput(fixture.calls).params
  assert.equal(Object.hasOwn(params, 'contextKind'), false)
  assert.equal(Object.hasOwn(params, 'contextId'), false)
})

test('propaga guardie, resolver, template builder e popup senza cambiare gli errori', () => {
  const event = { sender: { id: 12 } }
  for (const [dependency, request] of [
    ['assertTrustedSender', {}],
    ['resolveProjectFile', { kind: 'workspace-file', contextId: 'src/App.tsx' }],
    ['createContextMenuTemplate', {}],
    ['buildMenuFromTemplate', {}],
  ]) {
    const expected = new Error(`${dependency} failed`)
    const fixture = menuContextFixture({ [dependency]: () => { throw expected } })
    const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
    assert.throws(() => handler(event, request), (error) => error === expected)
  }

  const popupError = new Error('popup failed')
  const fixture = menuContextFixture({
    buildMenuFromTemplate: () => ({ popup: () => { throw popupError } }),
  })
  const handler = createMenuContextHandlers(fixture.dependencies).get('contextMenu:open')
  assert.throws(() => handler(event, {}), (error) => error === popupError)
})

test('il listener propaga invariati errori di guardia, stato e rebuild al confine one-way', () => {
  const event = { sender: { id: 13 } }
  for (const dependency of ['assertTrustedSender', 'setActiveAppSection', 'createMenu']) {
    const expected = new Error(`${dependency} failed`)
    const fixture = menuContextFixture({ [dependency]: () => { throw expected } })
    const listener = createMenuContextListeners(fixture.dependencies).get('appMenu:setContext')
    assert.throws(() => listener(event, 'github'), (error) => error === expected)
  }
})
