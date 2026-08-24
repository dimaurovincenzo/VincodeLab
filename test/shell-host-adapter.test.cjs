const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  canonicalizeWorkspaceDirectory,
  createShellHostAdapter,
  isSystemProcessAlive,
  resolveSystemShell,
} = require('../electron/infrastructure/processes/shell-host.adapter.cjs')

test('risolve una shell eseguibile e usa i fallback di sistema', () => {
  const executable = resolveSystemShell({ SHELL: '/shell/inesistente' })
  assert.ok(['/bin/zsh', '/bin/bash', '/bin/sh'].includes(executable))
})

test('espone l ambiente iniettato e un workspace canonico verificato', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-shell-host-'))
  const alias = `${workspace}-alias`
  fs.symlinkSync(workspace, alias, 'dir')
  t.after(() => {
    fs.rmSync(alias, { force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  })
  const environment = { LANG: 'it_IT.UTF-8', PATH: '/usr/bin:/bin', SHELL: '/bin/sh' }
  const adapter = createShellHostAdapter({ environment })

  assert.equal(adapter.getEnvironment(), environment)
  assert.equal(adapter.getExecutable(), '/bin/sh')
  assert.equal(adapter.canonicalizeWorkspace(alias), fs.realpathSync(workspace))
  assert.equal(canonicalizeWorkspaceDirectory(workspace), fs.realpathSync(workspace))
})

test('verifica la liveness senza esporre process al dominio', () => {
  assert.equal(isSystemProcessAlive(process.pid), true)
  assert.equal(isSystemProcessAlive(0), null)
})
