const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')

const { checkManagedUpdate } = require('../electron/update-checker.cjs')

const NOW = 1_725_000_000_000
const githubSkill = {
  id: 'skill:review',
  kind: 'skill',
  name: 'Review',
  sourceType: 'github',
  owner: 'openai',
  repository: 'skills',
  ref: 'main',
  channel: 'stable',
  activeVersion: 'abcdef1',
}

test('non segnala disponibilita quando commit e ref coincidono', async () => {
  const result = await checkManagedUpdate(githubSkill, { now: () => NOW, readGitHubRef: async () => ({ owner: 'openai', repository: 'skills', ref: 'main', commit: 'abcdef1', changelog: null }) })

  assert.deepEqual(result, { available: false, availableVersion: null, changelog: null, checkedAt: NOW })
})

test('rifiuta una risposta GitHub che cambia proprietario o repository', async () => {
  await assert.rejects(
    () => checkManagedUpdate(githubSkill, { now: () => NOW, readGitHubRef: async () => ({ owner: 'altro', repository: 'skills', ref: 'main', commit: 'abcdef2', changelog: null }) }),
    /Sorgente remota non autorizzata/,
  )
})

test('segnala un commit approvato piu recente senza attivarlo', async () => {
  const result = await checkManagedUpdate(githubSkill, { now: () => NOW, readGitHubRef: async () => ({ owner: 'openai', repository: 'skills', ref: 'main', commit: 'abcdef2', changelog: 'Correzione controllo' }) })

  assert.deepEqual(result, { available: true, availableVersion: 'abcdef2', changelog: 'Correzione controllo', checkedAt: NOW })
})

test('controlla GitHub anche con il PATH minimale del bundle macOS', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-update-checker-'))
  const fakeGh = path.join(root, 'gh')
  fs.writeFileSync(fakeGh, '#!/bin/sh\nprintf "abcdef2\\n"\n', { mode: 0o755 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const script = `
    const { readGitHubRef } = require(${JSON.stringify(path.join(__dirname, '..', 'electron', 'update-checker.cjs'))})
    readGitHubRef(${JSON.stringify(githubSkill)})
      .then((result) => process.stdout.write(JSON.stringify(result)))
      .catch((error) => { console.error(error.message); process.exitCode = 1 })
  `
  const output = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      VINCODELAB_GH_PATH: fakeGh,
    },
  })

  assert.deepEqual(JSON.parse(output), {
    owner: githubSkill.owner,
    repository: githubSkill.repository,
    ref: githubSkill.ref,
    commit: 'abcdef2',
    changelog: null,
  })
})
