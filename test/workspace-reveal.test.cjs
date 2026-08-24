const assert = require('node:assert/strict')
const test = require('node:test')

const { revealWorkspace } = require('../electron/domains/workspace/workspace-reveal.cjs')

test('mostra il workspace nel Finder e conferma soltanto un openPath riuscito', async () => {
  const opened = []

  assert.deepEqual(await revealWorkspace('/tmp/workspace-a', {
    openPath: async (workspacePath) => {
      opened.push(workspacePath)
      return ''
    },
  }), { revealed: true })
  assert.deepEqual(opened, ['/tmp/workspace-a'])
})

test('trasforma il messaggio di fallimento di openPath in una rejection osservabile', async () => {
  await assert.rejects(
    revealWorkspace('/tmp/workspace-a', { openPath: async () => 'EACCES: cartella non accessibile' }),
    (error) => error?.code === 'WORKSPACE_REVEAL_FAILED' && error.message === 'EACCES: cartella non accessibile',
  )
})

test('non sostituisce una rejection originale di openPath', async () => {
  const original = Object.assign(new Error('I/O failure'), { code: 'EIO' })

  await assert.rejects(
    revealWorkspace('/tmp/workspace-a', { openPath: async () => { throw original } }),
    (error) => error === original,
  )
})
