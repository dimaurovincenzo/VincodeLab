import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { formatRepositoryCheck, inspectRepository } from '../scripts/check-repository.mjs'

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vincodelab-repository-check-'))
  try {
    await run(root)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

test('accetta documentazione portabile con collegamenti locali validi', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'README.md'), '# Demo\n\n[Documentazione](docs/README.md)\n')
    await writeFile(path.join(root, 'docs/README.md'), '# Documentazione\n')

    assert.deepEqual(inspectRepository({ root, files: ['README.md', 'docs/README.md'] }), [])
  })
})

test('rileva artefatti, percorsi personali, token e link interrotti', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'dist'), { recursive: true })
    await writeFile(path.join(root, 'dist/app.js'), 'console.log("build")\n')
    await writeFile(
      path.join(root, 'README.md'),
      '# Demo\n\nApri /Users/alice/private e usa gh' + 'p_12345678901234567890.\n[Assente](docs/missing.md)\n',
    )

    const problems = inspectRepository({ root, files: ['README.md', 'dist/app.js'] })
    assert.ok(problems.some((problem) => problem.includes('artefatto generato')))
    assert.ok(problems.some((problem) => problem.includes('percorso home locale')))
    assert.ok(problems.some((problem) => problem.includes('possibile token cloud')))
    assert.ok(problems.some((problem) => problem.includes('collegamento locale inesistente')))
    assert.match(formatRepositoryCheck(problems), /Controllo repository non superato/u)
  })
})
