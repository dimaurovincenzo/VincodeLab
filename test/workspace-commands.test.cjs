const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const {
  assertRemoteRoot,
  assertSshDestination,
  createCommandCategory,
  createWorkspaceCommand,
  deleteCommandCategory,
  getWorkspaceCommand,
  listWorkspaceCommands,
  moveWorkspaceCommand,
  updateWorkspaceCommand,
} = require('../electron/infrastructure/persistence/workspace-commands.repository.cjs')

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-commands-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('isola categorie e comandi per workspace senza filtrare il testo', (t) => {
  withTemporaryDatabase(t)
  const server = createCommandCategory('/tmp/workspace-a', 'Server')
  const build = createCommandCategory('/tmp/workspace-a', 'Build')
  const command = createWorkspaceCommand('/tmp/workspace-a', {
    categoryId: server.id,
    title: 'Produzione',
    command: 'ssh api-prod && export PASSWORD=sviluppo',
    note: 'Accesso diagnostico',
  })
  createCommandCategory('/tmp/workspace-b', 'Build')

  moveWorkspaceCommand('/tmp/workspace-a', command.id, build.id)

  assert.equal(listWorkspaceCommands('/tmp/workspace-a').categories[1].commands[0].command, 'ssh api-prod && export PASSWORD=sviluppo')
  assert.deepEqual(listWorkspaceCommands('/tmp/workspace-b').categories.map((category) => ({ name: category.name, commands: category.commands })), [{ name: 'Build', commands: [] }])
  assert.equal(getWorkspaceCommand('/tmp/workspace-b', command.id), null)
  assert.throws(() => updateWorkspaceCommand('/tmp/workspace-b', command.id, { categoryId: server.id, title: command.title, command: command.command, note: command.note }), /Comando del workspace non trovato/)

  deleteCommandCategory('/tmp/workspace-a', build.id)
  assert.equal(getWorkspaceCommand('/tmp/workspace-a', command.id), null)
})

test('rifiuta lo spostamento in una categoria di un altro workspace', (t) => {
  withTemporaryDatabase(t)
  const categoryA = createCommandCategory('/tmp/workspace-a', 'Server')
  const categoryB = createCommandCategory('/tmp/workspace-b', 'Server')
  const command = createWorkspaceCommand('/tmp/workspace-a', { categoryId: categoryA.id, title: 'Build', command: 'npm run build', note: '' })

  assert.throws(() => moveWorkspaceCommand('/tmp/workspace-a', command.id, categoryB.id), /Categoria del workspace non trovata/)
})

test("rifiuta l'aggiornamento verso una categoria di un altro workspace", (t) => {
  withTemporaryDatabase(t)
  const categoryA = createCommandCategory('/tmp/workspace-a', 'Server')
  const categoryB = createCommandCategory('/tmp/workspace-b', 'Server')
  const command = createWorkspaceCommand('/tmp/workspace-a', { categoryId: categoryA.id, title: 'Build', command: 'npm run build', note: '' })

  assert.throws(() => updateWorkspaceCommand('/tmp/workspace-a', command.id, { categoryId: categoryB.id, title: 'Build', command: 'npm run build', note: '' }), /Categoria del workspace non trovata/)
})

test('mantiene shell i comandi esistenti e salva un profilo SSH separato', (t) => {
  withTemporaryDatabase(t)
  const category = createCommandCategory('/tmp/workspace-a', 'Server')
  const shell = createWorkspaceCommand('/tmp/workspace-a', {
    categoryId: category.id,
    title: 'Build',
    command: 'npm run build',
    note: '',
  })
  const ssh = createWorkspaceCommand('/tmp/workspace-a', {
    categoryId: category.id,
    title: 'Produzione',
    kind: 'ssh',
    command: '',
    note: '',
    sshDestination: 'api-prod',
    remoteRoot: '/srv/api',
  })

  assert.equal(shell.kind, 'shell')
  assert.deepEqual(
    { kind: ssh.kind, sshDestination: ssh.sshDestination, remoteRoot: ssh.remoteRoot },
    { kind: 'ssh', sshDestination: 'api-prod', remoteRoot: '/srv/api' },
  )
  assert.deepEqual(
    listWorkspaceCommands('/tmp/workspace-a').categories[0].commands.map((command) => command.kind),
    ['shell', 'ssh'],
  )
  assert.throws(() => assertSshDestination('-oProxyCommand=evil'), /Destinazione SSH non valida/)
  assert.throws(() => assertRemoteRoot('/srv/api\nput x'), /Percorso remoto non valido/)
})

test('valida i campi richiesti in base al tipo di comando', (t) => {
  withTemporaryDatabase(t)
  const category = createCommandCategory('/tmp/workspace-a', 'Server')

  assert.throws(() => createWorkspaceCommand('/tmp/workspace-a', {
    categoryId: category.id,
    title: 'SSH incompleto',
    kind: 'ssh',
    command: '',
    note: '',
    sshDestination: '',
    remoteRoot: '~',
  }), /Destinazione SSH non valida/)
  assert.throws(() => createWorkspaceCommand('/tmp/workspace-a', {
    categoryId: category.id,
    title: 'Shell vuota',
    kind: 'shell',
    command: '',
    note: '',
    sshDestination: '',
    remoteRoot: '',
  }), /Testo comando non valido/)
})
