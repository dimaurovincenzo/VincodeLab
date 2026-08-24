const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createRemoteTransferRegistry } = require('../electron/domains/remote-files/remote-transfer-registry.cjs')

function createFixture() {
  const notifications = []
  const registry = createRemoteTransferRegistry({ notify: (transfer) => notifications.push(transfer) })
  return { notifications, registry }
}

function start(registry, overrides = {}) {
  return registry.startTransfer({
    workspacePath: '/tmp/workspace-a',
    direction: 'download',
    name: 'config.json',
    lifecycleSignal: new AbortController().signal,
    ...overrides,
  })
}

test('crea ID e controller, notifica DTO pubblici e rilascia il transfer al termine', () => {
  const { notifications, registry } = createFixture()
  const lifecycle = new AbortController()
  const handle = start(registry, { lifecycleSignal: lifecycle.signal })

  assert.match(handle.transfer.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  assert.equal(handle.transfer.controller.signal.aborted, false)
  assert.equal(registry.getSize(), 1)
  assert.equal(notifications.length, 1)
  assert.deepEqual(notifications[0], {
    id: handle.transfer.id,
    direction: 'download',
    name: 'config.json',
    state: 'running',
    bytes: null,
    total: null,
    error: undefined,
  })
  assert.equal('workspacePath' in notifications[0], false)
  assert.equal('controller' in notifications[0], false)

  handle.finish()
  lifecycle.abort()

  assert.equal(registry.getSize(), 0)
  assert.equal(handle.transfer.controller.signal.aborted, false)
})

test('propaga progress e stato con snapshot DTO separati dal record interno', () => {
  const { notifications, registry } = createFixture()
  const handle = start(registry, { direction: 'upload', name: 'archive.zip' })

  const progress = registry.updateTransfer(handle.transfer, { bytes: 32, total: 128 })
  const completed = registry.updateTransfer(handle.transfer, { state: 'completed' })

  assert.deepEqual(progress, {
    id: handle.transfer.id,
    direction: 'upload',
    name: 'archive.zip',
    state: 'running',
    bytes: 32,
    total: 128,
    error: undefined,
  })
  assert.equal(notifications[0].state, 'running')
  assert.equal(notifications[1], progress)
  assert.equal(notifications[2], completed)
  assert.equal(completed.state, 'completed')
  assert.equal(handle.transfer.state, 'completed')

  handle.finish()
})

test('cancella soltanto transfer running appartenenti allo stesso workspace', () => {
  const { registry } = createFixture()
  const running = start(registry)
  const completed = start(registry, { name: 'completed.txt' })
  registry.updateTransfer(completed.transfer, { state: 'completed' })

  assert.equal(registry.cancelTransfer('/tmp/workspace-b', running.transfer.id), false)
  assert.equal(running.transfer.controller.signal.aborted, false)
  assert.equal(registry.cancelTransfer('/tmp/workspace-a', completed.transfer.id), false)
  assert.equal(completed.transfer.controller.signal.aborted, false)
  assert.equal(registry.cancelTransfer('/tmp/workspace-a', running.transfer.id), true)
  assert.equal(running.transfer.controller.signal.aborted, true)

  running.finish()
  completed.finish()
  assert.equal(registry.cancelTransfer('/tmp/workspace-a', running.transfer.id), false)
})

test('aborta i running per workspace o globalmente senza cambiare gli altri stati', () => {
  const { registry } = createFixture()
  const workspaceA = start(registry)
  const workspaceACompleted = start(registry, { name: 'done.txt' })
  const workspaceB = start(registry, { workspacePath: '/tmp/workspace-b' })
  registry.updateTransfer(workspaceACompleted.transfer, { state: 'completed' })

  registry.abortRunningForWorkspace('/tmp/workspace-a')

  assert.equal(workspaceA.transfer.controller.signal.aborted, true)
  assert.equal(workspaceACompleted.transfer.controller.signal.aborted, false)
  assert.equal(workspaceB.transfer.controller.signal.aborted, false)

  registry.abortAllRunning()
  assert.equal(workspaceACompleted.transfer.controller.signal.aborted, false)
  assert.equal(workspaceB.transfer.controller.signal.aborted, true)

  workspaceA.finish()
  workspaceACompleted.finish()
  workspaceB.finish()
})

test('clearWorkspace e clear rimuovono ownership senza introdurre cancellazioni', () => {
  const { registry } = createFixture()
  const workspaceA = start(registry)
  const workspaceB = start(registry, { workspacePath: '/tmp/workspace-b' })

  registry.clearWorkspace('/tmp/workspace-a')

  assert.equal(registry.getSize(), 1)
  assert.equal(workspaceA.transfer.controller.signal.aborted, false)
  assert.equal(registry.cancelTransfer('/tmp/workspace-a', workspaceA.transfer.id), false)
  assert.equal(registry.cancelTransfer('/tmp/workspace-b', workspaceB.transfer.id), true)

  registry.clear()
  assert.equal(registry.getSize(), 0)
  workspaceA.finish()
  workspaceB.finish()
})

test('un lifecycle già annullato crea comunque il record running con controller abortito', () => {
  const { notifications, registry } = createFixture()
  const lifecycle = new AbortController()
  lifecycle.abort()

  const handle = start(registry, { lifecycleSignal: lifecycle.signal })

  assert.equal(handle.transfer.state, 'running')
  assert.equal(handle.transfer.controller.signal.aborted, true)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].state, 'running')
  handle.finish()
})

test('preserva l ordine add listener, insert, notify, detach e remove', () => {
  const events = []
  let registry
  const lifecycleSignal = {
    aborted: false,
    addEventListener: () => events.push('add-listener'),
    removeEventListener: () => events.push(`detach:${registry.getSize()}`),
  }
  registry = createRemoteTransferRegistry({
    notify: () => events.push(`notify:${registry.getSize()}`),
  })

  const handle = start(registry, { lifecycleSignal })
  assert.deepEqual(events, ['add-listener', 'notify:1'])

  handle.finish()
  assert.deepEqual(events, ['add-listener', 'notify:1', 'detach:1'])
  assert.equal(registry.getSize(), 0)
})

test('mantiene il registry come unico owner della mappa transfer nel dominio file remoti', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-file-service.cjs'), 'utf8')
  const registrySource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-transfer-registry.cjs'), 'utf8')

  assert.match(serviceSource, /createRemoteTransferRegistry\(\{ notify \}\)/)
  assert.doesNotMatch(serviceSource, /\bconst transfers = new Map\(\)|\bfunction transferDto\b|\bfunction updateTransfer\b/)
  assert.match(registrySource, /\bconst transfers = new Map\(\)/)
  assert.match(registrySource, /\bfunction transferDto\b/)
  assert.match(registrySource, /\bfunction updateTransfer\b/)
})
