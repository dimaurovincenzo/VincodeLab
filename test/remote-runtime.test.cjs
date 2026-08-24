const assert = require('node:assert/strict')
const test = require('node:test')

const { createRemoteRuntime } = require('../electron/domains/remote/remote-runtime.cjs')

function fixture() {
  const calls = []
  const ssh = {
    closeAll: async () => calls.push('ssh:closeAll'),
    closeWorkspace: async (workspacePath) => calls.push(`ssh:close:${workspacePath}`),
    get: (id) => id === 'owned' ? { id, workspacePath: '/workspace' } : null,
  }
  const sftp = {
    closeAll: async () => calls.push('sftp:closeAll'),
    closeWorkspace: async (workspacePath) => calls.push(`sftp:close:${workspacePath}`),
  }
  const service = {
    closeAll: async () => calls.push('remote:closeAll'),
    closeWorkspace: async (workspacePath) => calls.push(`remote:close:${workspacePath}`),
    openWorkspace: (workspacePath) => calls.push(`remote:open:${workspacePath}`),
  }
  const runtime = createRemoteRuntime({
    chooseDestination: async () => null,
    chooseFiles: async () => [],
    createManagedSshService: (options) => { calls.push(['ssh:create', options]); return ssh },
    createRemoteFileService: (options) => { calls.push(['remote:create', options]); return service },
    createRemoteFileStore: (options) => { calls.push(['store:create', options]); return {} },
    createSftpService: () => { calls.push('sftp:create'); return sftp },
    getActiveWorkspacePath: () => '/workspace',
    getDataDirectory: () => '/data',
    getDatabase: () => 'database',
    getTempRoot: () => '/temp',
    log() {},
    notifyTransfer() {},
    sendManagedSshStatus() {},
    showItemInFolder() {},
  })
  const withDeadline = async (promise, timeout, operation) => {
    calls.push(['deadline', timeout, operation])
    return promise
  }
  return { calls, runtime, withDeadline }
}

test('crea lazy SSH, SFTP, store e servizio remoto una sola volta', () => {
  const { calls, runtime } = fixture()
  assert.equal(runtime.getManagedSsh(), runtime.getManagedSsh())
  assert.equal(runtime.getRemoteFileService(), runtime.getRemoteFileService())
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'ssh:create').length, 1)
  assert.equal(calls.filter((entry) => entry === 'sftp:create').length, 1)
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'remote:create').length, 1)
})

test('confina una connessione al workspace attivo', () => {
  const { runtime } = fixture()
  assert.equal(runtime.requireManagedConnection('owned').workspacePath, '/workspace')
  assert.throws(() => runtime.requireManagedConnection('missing'), /non disponibile per questo workspace/)
})

test('cleanup rispetta ordine remoto prima di SSH e deadline bounded', async () => {
  const { calls, runtime, withDeadline } = fixture()
  runtime.getRemoteFileService()
  runtime.openWorkspace('/workspace')
  await runtime.closeWorkspace('/workspace', withDeadline)
  await runtime.closeAll(withDeadline)

  assert.ok(calls.indexOf('remote:close:/workspace') < calls.indexOf('ssh:close:/workspace'))
  assert.ok(calls.indexOf('remote:closeAll') < calls.indexOf('ssh:closeAll'))
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[2] === 'remote-files'), true)
})
