const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  assertEditorAccessiblePath,
  isEditorVisibleFile,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
} = require('../electron/domains/filesystem/project-access-policy.cjs')
const {
  PROJECT_FILE_ACTIONS_HOST_METHODS,
  createProjectFileActionsHostPort,
} = require('../electron/domains/filesystem/project-file-actions-host.port.cjs')
const {
  createProjectFileActions,
} = require('../electron/domains/filesystem/project-file-actions.cjs')
const {
  createProjectFileActionsFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-file-actions-filesystem.adapter.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')

test('la porta actions espone solo operazioni host semantiche, preserva il receiver ed è immutabile', () => {
  const implementation = {
    prefix: '/resolved',
    isMacApplicationBundle(applicationPath) { return applicationPath.endsWith('.app') },
    prepareAttachment(_workspacePath, fileId) { return { absolutePath: `${this.prefix}/${fileId}`, name: fileId } },
    resolveDirectory(_workspacePath, directoryId) { return `${this.prefix}/${directoryId}` },
    resolveFile(_workspacePath, fileId) { return `${this.prefix}/${fileId}` },
  }
  const port = createProjectFileActionsHostPort(implementation)

  assert.deepEqual(PROJECT_FILE_ACTIONS_HOST_METHODS, [
    'isMacApplicationBundle',
    'prepareAttachment',
    'resolveDirectory',
    'resolveFile',
  ])
  assert.deepEqual(Object.keys(port), PROJECT_FILE_ACTIONS_HOST_METHODS)
  assert.equal(Object.isFrozen(port), true)
  assert.equal(port.resolveFile('/workspace', 'src/App.tsx'), '/resolved/src/App.tsx')
  assert.deepEqual(port.prepareAttachment('/workspace', 'README.md'), {
    absolutePath: '/resolved/README.md',
    name: 'README.md',
  })
  assert.throws(() => createProjectFileActionsHostPort({}), /incompleta: isMacApplicationBundle/)
  assert.throws(() => createProjectFileActionsHostPort(null), /non valida/)
  assert.throws(() => createProjectFileActions({}), /non valida/)
})

test('la policy pura conserva ID, nomi, kind, file nascosti ed esclusione node_modules', () => {
  assert.equal(validateProjectDirectoryId(''), '')
  assert.equal(validateProjectDirectoryId('src/components'), 'src/components')
  assert.equal(validateProjectEntryId('.secrets/cert.pem'), '.secrets/cert.pem')
  assert.equal(validateProjectEntryName('.env'), '.env')
  assert.equal(validateProjectEntryKind('file'), 'file')
  assert.equal(validateProjectEntryKind('directory'), 'directory')
  assert.equal(isEditorVisibleFile('.env'), true)
  assert.doesNotThrow(() => assertEditorAccessiblePath('.git/config'))

  for (const invalidId of ['../outside', '/absolute', 'src/', 'src//file', 'src\\file', 'src\0file']) {
    assert.throws(() => validateProjectEntryId(invalidId), /Percorso file non valido/)
  }
  assert.throws(() => validateProjectEntryId('src/Node_Modules/pkg'), /non è accessibile/)
  assert.throws(() => validateProjectEntryName(''), /Nome file non valido/)
  assert.throws(() => validateProjectEntryName('a'.repeat(256)), /Nome file non valido/)
  assert.throws(() => validateProjectEntryKind('link'), /Tipo elemento non valido/)
})

test('il dominio valida prima dell host e conserva ordine, callback, cancellazione e DTO', async () => {
  const events = []
  const actions = createProjectFileActions(createProjectFileActionsHostPort({
    isMacApplicationBundle(applicationPath) {
      events.push(['is-app', applicationPath])
      return applicationPath.endsWith('.app')
    },
    prepareAttachment(workspacePath, fileId) {
      events.push(['attachment', workspacePath, fileId])
      return { absolutePath: `/resolved/${fileId}`, name: fileId.split('/').at(-1) }
    },
    resolveDirectory(workspacePath, directoryId) {
      events.push(['resolve-directory', workspacePath, directoryId])
      return `/resolved/${directoryId}`
    },
    resolveFile(workspacePath, fileId) {
      events.push(['resolve-file', workspacePath, fileId])
      return `/resolved/${fileId}`
    },
  }))

  assert.equal(Object.isFrozen(actions), true)
  assert.deepEqual(Object.keys(actions), [
    'openProjectFileWith',
    'prepareProjectFileAttachment',
    'revealProjectDirectory',
    'revealProjectFile',
  ])
  assert.equal(actions.openProjectFileWith.length, 3)
  assert.equal(actions.prepareProjectFileAttachment.length, 2)
  assert.equal(actions.revealProjectDirectory.length, 3)
  assert.equal(actions.revealProjectFile.length, 3)
  assert.deepEqual(actions.prepareProjectFileAttachment('/workspace', 'src/App.tsx'), {
    absolutePath: '/resolved/src/App.tsx',
    name: 'App.tsx',
  })
  assert.deepEqual(actions.revealProjectFile('/workspace', 'src/App.tsx', {
    showItemInFolder(filePath) { events.push(['show-file', filePath]) },
  }), { revealed: true })
  assert.deepEqual(actions.revealProjectDirectory('/workspace', 'src', {
    showItemInFolder(directoryPath) { events.push(['show-directory', directoryPath]) },
  }), { revealed: true })

  events.length = 0
  assert.deepEqual(await actions.openProjectFileWith('/workspace', 'README.md', {
    async chooseApplication() {
      events.push(['choose'])
      return '/Applications/Editor.app'
    },
    async openWith(applicationPath, filePath) {
      events.push(['open', applicationPath, filePath])
    },
  }), { opened: true })
  assert.deepEqual(events, [
    ['resolve-file', '/workspace', 'README.md'],
    ['choose'],
    ['is-app', '/Applications/Editor.app'],
    ['open', '/Applications/Editor.app', '/resolved/README.md'],
  ])

  events.length = 0
  assert.deepEqual(await actions.openProjectFileWith('/workspace', 'README.md', {
    async chooseApplication() {
      events.push(['choose'])
      return null
    },
    async openWith() { events.push(['unexpected-open']) },
  }), { opened: false })
  assert.deepEqual(events, [
    ['resolve-file', '/workspace', 'README.md'],
    ['choose'],
  ])

  events.length = 0
  await assert.rejects(() => actions.openProjectFileWith('/workspace', 'README.md', {
    async chooseApplication() {
      events.push(['choose'])
      return '/tmp/editor'
    },
    async openWith() { events.push(['unexpected-open']) },
  }), /applicazione macOS valida/)
  assert.deepEqual(events, [
    ['resolve-file', '/workspace', 'README.md'],
    ['choose'],
    ['is-app', '/tmp/editor'],
  ])

  events.length = 0
  assert.throws(() => actions.revealProjectFile('/workspace', '../outside', { showItemInFolder() {} }), /Percorso file non valido/)
  await assert.rejects(() => actions.openProjectFileWith('/workspace', 'node_modules/pkg.js', {
    async chooseApplication() { events.push(['unexpected-choose']) },
    async openWith() {},
  }), /non è accessibile/)
  assert.deepEqual(events, [])
})

test('l adapter condivide il traversal, confina file e directory e mantiene la validazione tecnica macOS', () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-actions-'))
  const workspace = path.join(container, 'workspace')
  const alias = path.join(container, 'workspace-alias')
  const external = path.join(container, 'external')
  try {
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    fs.mkdirSync(external)
    fs.writeFileSync(path.join(workspace, 'src', 'App.tsx'), 'export default null\n')
    fs.symlinkSync(workspace, alias)
    fs.symlinkSync(external, path.join(workspace, 'outside'))

    const host = createProjectFileActionsFilesystemAdapter()
    const root = fs.realpathSync(workspace)
    assert.equal(host.resolveDirectory(alias, ''), root)
    assert.equal(host.resolveDirectory(alias, 'src'), path.join(root, 'src'))
    assert.equal(host.resolveFile(alias, 'src/App.tsx'), path.join(root, 'src', 'App.tsx'))
    assert.deepEqual(host.prepareAttachment(alias, 'src/App.tsx'), {
      absolutePath: path.join(root, 'src', 'App.tsx'),
      name: 'App.tsx',
    })
    assert.equal(host.isMacApplicationBundle('/Applications/Editor.app'), true)
    assert.equal(host.isMacApplicationBundle('/Applications/Editor.APP'), true)
    assert.equal(host.isMacApplicationBundle('/Applications/.app'), false)
    assert.equal(host.isMacApplicationBundle('/Applications/Editor.app/'), true)
    assert.equal(host.isMacApplicationBundle(null), false)
    assert.throws(() => host.resolveDirectory(workspace, 'outside'), /link simbolici/)
    assert.throws(() => host.resolveFile(workspace, 'src'), /File non trovato/)
    assert.throws(() => host.resolveDirectory(workspace, 'src/App.tsx'), /Cartella non trovata/)
  } finally {
    fs.rmSync(container, { recursive: true, force: true })
  }
})

test('listing e actions usano lo stesso traversal infrastructure senza duplicare il walker', () => {
  const root = path.join(__dirname, '..')
  const listingAdapter = fs.readFileSync(path.join(root, 'electron/infrastructure/filesystem/project-directory-listing-filesystem.adapter.cjs'), 'utf8')
  const actionsAdapter = fs.readFileSync(path.join(root, 'electron/infrastructure/filesystem/project-file-actions-filesystem.adapter.cjs'), 'utf8')
  const traversalService = fs.readFileSync(path.join(root, 'electron/infrastructure/filesystem/project-path-filesystem.service.cjs'), 'utf8')

  assert.match(listingAdapter, /require\('\.\/project-path-filesystem\.service\.cjs'\)/)
  assert.match(actionsAdapter, /require\('\.\/project-path-filesystem\.service\.cjs'\)/)
  assert.doesNotMatch(listingAdapter, /(?:realpath|lstat)Sync|path\.join|path\.relative/)
  assert.doesNotMatch(actionsAdapter, /lstatSync|path\.join|path\.relative/)
  assert.match(traversalService, /realpathSync/)
  assert.match(traversalService, /lstatSync/)
  assert.match(traversalService, /path\.join/)
  assert.match(traversalService, /path\.relative/)
})

test('facade e main compongono l adapter mantenendo i nomi consegnati a IPC e runtime', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal(projectFiles.createProjectFileActions, createProjectFileActions)
  assert.match(main, /createProjectFileActionsFilesystemAdapter/)
  assert.match(main, /\} = createProjectFileActions\(createProjectFileActionsFilesystemAdapter\(\)\)/)
  assert.match(main, /createContextCommandRuntime\(\{[\s\S]*?openProjectFileWith,/)
  assert.match(main, /registerFilesystemIpc\(\{[\s\S]*?prepareProjectFileAttachment,/)
})
