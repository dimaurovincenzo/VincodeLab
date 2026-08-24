const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createProjectFileContentSearch,
  lineMatch,
} = require('../electron/domains/filesystem/project-file-content-search.cjs')

function entry(id, size = 40) {
  const segments = id.split('/')
  const name = segments.at(-1)
  return { id, name, directory: segments.slice(0, -1).join('/'), extension: name.split('.').at(-1), size, modifiedAt: 1 }
}

test('trova riga, colonna e anteprima senza distinzione tra maiuscole e minuscole', () => {
  assert.deepEqual(lineMatch('prima\n  const Risultato = 42  \nultima', 'risultato'), {
    line: 2,
    column: 9,
    preview: 'const Risultato = 42',
  })
  assert.equal(lineMatch('nessuna corrispondenza', 'needle'), null)
})

test('cerca sui file indicizzati ed esclude binari e file troppo grandi', async () => {
  const reads = []
  const files = [entry('src/app.ts'), entry('docs/guide.md'), entry('assets/logo.png'), entry('large.txt', 1_000_001)]
  const search = createProjectFileContentSearch({
    projectFileIndex: { build: async () => ({ files }) },
    readProjectFile: async (_workspace, fileId) => {
      reads.push(fileId)
      return { content: fileId === 'src/app.ts' ? 'export const answer = 42' : 'La risposta è altrove' }
    },
  })

  const result = await search.searchProjectFileContents('/workspace', 'ANSWER')

  assert.deepEqual(reads, ['src/app.ts', 'docs/guide.md'])
  assert.equal(result.cancelled, false)
  assert.equal(result.filesSearched, 2)
  assert.equal(result.skippedFiles, 2)
  assert.deepEqual(result.matches, [{
    column: 14,
    directory: 'src',
    fileId: 'src/app.ts',
    fileName: 'app.ts',
    line: 1,
    preview: 'export const answer = 42',
  }])
})

test('limita i risultati e una ricerca nuova rende obsoleta quella precedente', async () => {
  let releaseFirst
  const firstRead = new Promise((resolve) => { releaseFirst = resolve })
  const files = [entry('a.txt'), entry('b.txt'), entry('c.txt')]
  const search = createProjectFileContentSearch({
    projectFileIndex: { build: async () => ({ files }) },
    readProjectFile: async (_workspace, fileId) => {
      if (fileId === 'a.txt') await firstRead
      return { content: 'needle' }
    },
  })

  const obsolete = search.searchProjectFileContents('/workspace', 'needle')
  const current = search.searchProjectFileContents('/workspace', 'needle', { maxResults: 1 })
  releaseFirst()

  assert.equal((await obsolete).cancelled, true)
  const result = await current
  assert.equal(result.matches.length, 1)
  assert.equal(result.truncated, true)
})

test('una query vuota annulla il lavoro e le opzioni sono bounded', async () => {
  const search = createProjectFileContentSearch({
    projectFileIndex: { build: async () => ({ files: [] }) },
    readProjectFile: async () => ({ content: '' }),
  })
  assert.equal((await search.searchProjectFileContents('/workspace', '')).cancelled, true)
  await assert.rejects(search.searchProjectFileContents('/workspace', 'x'), /almeno 2 caratteri/u)
  await assert.rejects(search.searchProjectFileContents('/workspace', 'ok', { maxResults: 501 }), /Limite risultati/u)
})
