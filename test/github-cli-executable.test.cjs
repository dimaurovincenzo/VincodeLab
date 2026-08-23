const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { environmentForGitHubCli, resolveGitHubCliExecutable } = require('../electron/github-cli-executable.cjs')

test('trova GitHub CLI fuori dal PATH minimale delle applicazioni macOS', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-gh-'))
  const binDirectory = path.join(root, 'bin')
  const executable = path.join(binDirectory, 'gh')
  fs.mkdirSync(binDirectory)
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const resolved = resolveGitHubCliExecutable({
    environment: { PATH: '/usr/bin:/bin' },
    fallbackDirectories: [binDirectory],
  })

  assert.equal(resolved, executable)
})

test('prepara un ambiente eseguibile per gh senza perdere il profilo utente', () => {
  const environment = environmentForGitHubCli('/opt/homebrew/bin/gh', {
    HOME: '/Users/example',
    PATH: '/usr/bin:/bin',
  })

  assert.equal(environment.HOME, '/Users/example')
  assert.equal(environment.PATH, '/opt/homebrew/bin:/usr/bin:/bin')
})
