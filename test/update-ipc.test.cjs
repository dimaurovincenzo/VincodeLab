const { expandIpcChannelConstants } = require('./helpers/ipc-source.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createWorkspaceOperationBoundary } = require('../electron/domains/workspace/workspace-operation-boundary.cjs')

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
const updatesIpc = expandIpcChannelConstants(fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/updates.ipc.cjs'), 'utf8'))

function ipcHandlerSource(channel) {
  const start = updatesIpc.indexOf(`['${channel}'`)
  assert.notEqual(start, -1, `Handler IPC mancante: ${channel}`)
  const nextHandler = updatesIpc.indexOf('\n    [', start + 1)
  return updatesIpc.slice(start, nextHandler === -1 ? updatesIpc.length : nextHandler)
}

test('preload espone solo operazioni update per id e policy', () => {
  assert.match(preload, /updates:\s*\{[\s\S]*download:\s*\(id\)/)
  assert.match(preload, /setPolicy:\s*\(id, policy\)/)
  assert.doesNotMatch(preload, /updates:[\s\S]{0,800}node:fs/)
})

test('ogni canale aggiornamenti verifica il sender prima del servizio', () => {
  assert.match(main, /registerUpdatesIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('updates:/)
  const directChannels = new Map([
    ['updates:list', 'listManagedUpdates'],
    ['updates:check', 'checkUpdates'],
    ['updates:setPolicy', 'setManagedUpdatePolicy'],
  ])
  for (const [channel, service] of directChannels) {
    const handler = ipcHandlerSource(channel)
    const guardIndex = handler.indexOf('assertTrustedSender(event)')
    const serviceIndex = handler.indexOf(`${service}(`)
    assert.ok(guardIndex >= 0, `Guard sender mancante: ${channel}`)
    assert.ok(serviceIndex > guardIndex, `Il servizio ${service} precede il guard sender`)
  }

  const wrappedChannels = new Map([
    ['updates:download', 'stageManagedUpdate'],
    ['updates:downloadAll', 'downloadAllUpdates'],
    ['updates:rollback', 'rollbackManagedUpdate'],
    ['updates:activatePending', 'activatePendingUpdates'],
  ])
  for (const [channel, service] of wrappedChannels) {
    const handler = ipcHandlerSource(channel)
    assert.match(handler, new RegExp(`runExternalMutation\\(\\s*event,[\\s\\S]*?\\(\\) => ${service}\\(`))
  }

  const calls = []
  const rejection = new Error('sender rifiutato')
  const { runExternalMutation } = createWorkspaceOperationBoundary({
    assertTrustedSender() {
      calls.push('sender')
      throw rejection
    },
    externalMutations: {
      run(_context, operation) {
        calls.push('registry')
        return operation()
      },
    },
    getActiveWorkspacePath: () => '/workspace',
    githubOperations: {},
  })

  assert.throws(
    () => runExternalMutation({ sender: { id: 7 } }, 'updates:download', null, () => calls.push('service')),
    (error) => error === rejection,
  )
  assert.deepEqual(calls, ['sender'])
})
