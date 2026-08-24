const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { environmentForGitHubCli, resolveGitHubCliExecutable } = require('../electron/infrastructure/github/github-cli-executable.adapter.cjs')
const { commandConfiguration, deterministicCommandEnvironment } = require('../electron/infrastructure/github/command-runner.adapter.cjs')

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

test('rende deterministica la locale dei subprocess Git senza mutare l ambiente applicativo', () => {
  const applicationEnvironment = Object.freeze({
    HOME: '/Users/example',
    LANG: 'it_IT.UTF-8',
    LC_ALL: 'it_IT.UTF-8',
    PATH: '/usr/bin:/bin',
  })

  const commandEnvironment = deterministicCommandEnvironment(applicationEnvironment)
  const git = commandConfiguration('git', { environment: applicationEnvironment })
  const gh = commandConfiguration('gh', {
    environment: applicationEnvironment,
    resolveGitHubCliExecutableImpl: () => '/opt/homebrew/bin/gh',
  })

  assert.deepEqual(applicationEnvironment, {
    HOME: '/Users/example',
    LANG: 'it_IT.UTF-8',
    LC_ALL: 'it_IT.UTF-8',
    PATH: '/usr/bin:/bin',
  })
  assert.deepEqual(commandEnvironment, {
    HOME: '/Users/example',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
  })
  assert.equal(git.executable, 'git')
  assert.equal(git.env.LANG, 'C')
  assert.equal(git.env.LC_ALL, 'C')
  assert.equal(gh.executable, '/opt/homebrew/bin/gh')
  assert.equal(gh.env.LANG, 'C')
  assert.equal(gh.env.LC_ALL, 'C')
  assert.equal(gh.env.PATH, '/opt/homebrew/bin:/usr/bin:/bin')
})
