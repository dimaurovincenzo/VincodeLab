const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_CONTENT_BYTES, createVolatileDraftRegistry } = require('../electron/domains/workspace/volatile-draft-registry.cjs')

function draft(resource, content = 'modifica', baseline = 'base') {
  return { scope: 'project-editor', workspace: '/workspace/a', resource, content, baseline }
}

test('conserva in memoria una bozza attraverso la ricreazione del renderer e la elimina al commit', () => {
  const registry = createVolatileDraftRegistry()
  registry.write(draft('src/app.ts'))

  assert.deepEqual(registry.list(), [draft('src/app.ts')])
  assert.deepEqual(registry.write(draft('src/app.ts', 'salvato', 'salvato')), { stored: false })
  assert.deepEqual(registry.list(), [])
})

test('isola workspace e risorse, limita la cardinalità e scarta la più vecchia', () => {
  const registry = createVolatileDraftRegistry({ maxDrafts: 2 })
  registry.write(draft('a'))
  registry.write({ ...draft('b'), workspace: '/workspace/b' })
  registry.write(draft('c'))

  assert.deepEqual(registry.list().map(({ workspace, resource }) => ({ workspace, resource })), [
    { workspace: '/workspace/b', resource: 'b' },
    { workspace: '/workspace/a', resource: 'c' },
  ])
  assert.deepEqual(registry.discard(draft('c')), { discarded: true })
})

test('rifiuta scope, identità e contenuti oltre budget senza esporli', () => {
  const registry = createVolatileDraftRegistry()
  assert.throws(() => registry.write({ ...draft('a'), scope: 'segreto' }), /Ambito/u)
  assert.throws(() => registry.write({ ...draft('a'), workspace: 'x'.repeat(4_097) }), /Workspace/u)
  assert.throws(() => registry.write(draft('a', 'x'.repeat(MAX_CONTENT_BYTES + 1))), /Contenuto/u)
  assert.deepEqual(registry.list(), [])
})

test('accetta le bozze Database solo nel registro volatile e non le serializza su disco', () => {
  const registry = createVolatileDraftRegistry()
  registry.write({ scope: 'database-sql', workspace: '/workspace/a', resource: 'connection-a', content: 'SELECT 2', baseline: 'SELECT 1' })
  registry.write({ scope: 'database-connection', workspace: '/workspace/a', resource: 'new', content: '{"password":"temporary"}', baseline: '{}' })

  assert.equal(registry.list().length, 2)
  assert.equal(Object.keys(registry).some((key) => /path|file|database/iu.test(key)), false)
})
