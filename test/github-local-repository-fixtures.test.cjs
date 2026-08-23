const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-fixture-cache-'))
const isolatedGitEnvironment = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
}
const previousEnvironment = Object.fromEntries(
  ['VINCODELAB_DATA_DIR', ...Object.keys(isolatedGitEnvironment)].map((key) => [key, process.env[key]]),
)
process.env.VINCODELAB_DATA_DIR = dataDirectory
Object.assign(process.env, isolatedGitEnvironment)

const { closeDatabase } = require('../electron/workspace-store.cjs')
const {
  commit,
  createBranch,
  createCommandRunner,
  getFileDiff,
  getGitStatus,
  initializeGitRepository,
  push,
  stageFiles,
  switchBranch,
} = require('../electron/github-service.cjs')

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...isolatedGitEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function createRepository(t, files = { 'README.md': '# VincodeLab\n' }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-fixture-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  git(workspace, ['init'])
  git(workspace, ['config', 'user.email', 'vincodelab@example.test'])
  git(workspace, ['config', 'user.name', 'VincodeLab Test'])
  for (const [filePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(workspace, filePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, contents)
  }
  git(workspace, ['add', '--all'])
  git(workspace, ['commit', '-m', 'Commit iniziale'])
  return workspace
}

function createBareRemote(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-remote-'))
  const remote = path.join(root, 'origin.git')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '--bare', remote])
  return remote
}

function assertGitFailure(expectedCode, expectedMessage) {
  return (error) => {
    assert.equal(error?.code, expectedCode)
    assert.match(error.message, expectedMessage)
    assert.match(error.message, /\[ERR-[A-F0-9]{6}\]$/)
    return true
  }
}

test.after(() => {
  closeDatabase()
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(dataDirectory, { recursive: true, force: true })
})

test('isola il push fallito da detached HEAD e recupera su un nuovo branch locale', async (t) => {
  const workspace = createRepository(t)
  const remote = createBareRemote(t)
  git(workspace, ['remote', 'add', 'origin', remote])
  git(workspace, ['switch', '--detach', 'HEAD'])

  const detached = await getGitStatus(workspace)
  assert.equal(detached.isRepository, true)
  assert.equal(detached.branch, '(detached HEAD)')
  assert.equal(detached.commits.length, 1)

  await assert.rejects(
    () => push(workspace),
    assertGitFailure('GIT_DETACHED_HEAD', /Non puoi pubblicare da HEAD scollegato/),
  )

  const recoveredBranch = await createBranch(workspace, 'recovery/detached-head')
  assert.equal(recoveredBranch.branch, 'recovery/detached-head')

  const published = await push(workspace)
  assert.equal(published.upstream, 'origin/recovery/detached-head')
  assert.equal(published.ahead, 0)
  assert.equal(git(remote, ['show-ref', '--verify', 'refs/heads/recovery/detached-head']).length > 0, true)
})

test('isola un cambio branch fallito durante un merge conflict e consente la risoluzione', async (t) => {
  const workspace = createRepository(t, { 'conflict.txt': 'base\n' })
  const originalBranch = git(workspace, ['branch', '--show-current'])
  git(workspace, ['switch', '-c', 'conflict-side'])
  fs.writeFileSync(path.join(workspace, 'conflict.txt'), 'versione side\n')
  git(workspace, ['add', 'conflict.txt'])
  git(workspace, ['commit', '-m', 'Modifica side'])
  git(workspace, ['switch', originalBranch])
  fs.writeFileSync(path.join(workspace, 'conflict.txt'), 'versione principale\n')
  git(workspace, ['add', 'conflict.txt'])
  git(workspace, ['commit', '-m', 'Modifica principale'])

  assert.throws(() => git(workspace, ['merge', 'conflict-side']))

  const conflicted = await getGitStatus(workspace)
  assert.equal(conflicted.branch, originalBranch)
  assert.deepEqual(
    conflicted.files.find((file) => file.path === 'conflict.txt'),
    { path: 'conflict.txt', index: 'U', workingTree: 'U' },
  )

  await assert.rejects(
    () => switchBranch(workspace, 'conflict-side'),
    assertGitFailure('GIT_CONFLICT', /Risolvi i conflitti e riprova/),
  )

  const stillUsable = await getGitStatus(workspace)
  assert.equal(stillUsable.files.some((file) => file.index === 'U' || file.workingTree === 'U'), true)

  fs.writeFileSync(path.join(workspace, 'conflict.txt'), 'risoluzione condivisa\n')
  await stageFiles(workspace, ['conflict.txt'])
  const recovered = await commit(workspace, 'Risolvi conflitto')
  assert.equal(recovered.branch, originalBranch)
  assert.deepEqual(recovered.files, [])
  assert.equal(fs.readFileSync(path.join(workspace, 'conflict.txt'), 'utf8'), 'risoluzione condivisa\n')
})

test('tratta un gitdir non valido come repository corrotto e recupera dopo la riparazione', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-invalid-gitdir-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'contenuto locale\n')
  fs.writeFileSync(path.join(workspace, '.git'), `gitdir: ${path.join(workspace, 'gitdir-inesistente')}\n`)

  await assert.rejects(
    () => getGitStatus(workspace),
    assertGitFailure('GIT_REPOSITORY_INVALID', /Ripara o ricollega il repository e riprova/),
  )

  await assert.rejects(
    () => initializeGitRepository(workspace),
    assertGitFailure('GIT_REPOSITORY_INVALID', /Ripara o ricollega il repository e riprova/),
  )

  fs.rmSync(path.join(workspace, '.git'))
  const initialized = await initializeGitRepository(workspace)
  assert.equal(initialized.isRepository, true)

  const recovered = await stageFiles(workspace, ['notes.txt'])
  assert.deepEqual(
    recovered.files.find((file) => file.path === 'notes.txt'),
    { path: 'notes.txt', index: 'A', workingTree: ' ' },
  )
})

test('rilegge file modificati o eliminati esternamente dopo un errore di staging', async (t) => {
  const workspace = createRepository(t, {
    'modified.txt': 'contenuto iniziale\n',
    'deleted.txt': 'da eliminare\n',
  })
  fs.appendFileSync(path.join(workspace, 'modified.txt'), 'modifica esterna\n')
  fs.rmSync(path.join(workspace, 'deleted.txt'))

  const externalChanges = await getGitStatus(workspace)
  assert.deepEqual(
    externalChanges.files.find((file) => file.path === 'modified.txt'),
    { path: 'modified.txt', index: ' ', workingTree: 'M' },
  )
  assert.deepEqual(
    externalChanges.files.find((file) => file.path === 'deleted.txt'),
    { path: 'deleted.txt', index: ' ', workingTree: 'D' },
  )
  assert.match(await getFileDiff(workspace, 'modified.txt'), /\+modifica esterna/)
  assert.match(await getFileDiff(workspace, 'deleted.txt'), /-da eliminare/)

  await assert.rejects(
    () => stageFiles(workspace, ['file-inesistente.txt']),
    assertGitFailure('GIT_PATH_UNTRACKED', /Aggiorna lo stato e riprova/),
  )

  const staged = await stageFiles(workspace, ['modified.txt', 'deleted.txt'])
  assert.equal(staged.files.every((file) => file.workingTree === ' '), true)
  const recovered = await commit(workspace, 'Registra modifiche esterne')
  assert.deepEqual(recovered.files, [])
  assert.equal(fs.readFileSync(path.join(workspace, 'modified.txt'), 'utf8'), 'contenuto iniziale\nmodifica esterna\n')
  assert.equal(fs.existsSync(path.join(workspace, 'deleted.txt')), false)
})

test('un executable Git assente non avvelena il command runner iniettato', async (t) => {
  const workspace = createRepository(t)
  const missingExecutable = path.join(workspace, 'git-inesistente')
  let executableAvailable = false
  const runner = createCommandRunner({
    commandConfigurationImpl(command) {
      assert.equal(command, 'git')
      return {
        executable: executableAvailable ? 'git' : missingExecutable,
        env: { ...process.env, ...isolatedGitEnvironment },
      }
    },
  })

  await assert.rejects(
    () => runner.run('git', ['rev-parse', '--is-inside-work-tree'], workspace),
    (error) => {
      assertGitFailure('GIT_NOT_INSTALLED', /Git non è disponibile\. Installalo e riprova/)(error)
      assert.doesNotMatch(error.message, /git-inesistente/)
      return true
    },
  )

  executableAvailable = true
  assert.equal(await runner.run('git', ['rev-parse', '--is-inside-work-tree'], workspace), 'true')
  assert.equal(await runner.run('git', ['status', '--short'], workspace), '')
})
