const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createRemoteEntryRegistry } = require('../electron/domains/remote-files/remote-entry-registry.cjs')

function entry(overrides = {}) {
  return {
    workspacePath: '/tmp/workspace-a',
    connectionId: 'connection-a',
    remotePath: '/srv/app/config.json',
    name: 'config.json',
    kind: 'file',
    ...overrides,
  }
}

test('riusa gli ID opachi soltanto per la stessa entry e mantiene l isolamento del workspace', () => {
  const registry = createRemoteEntryRegistry()
  const first = registry.cacheEntry(entry())
  const refreshed = registry.cacheEntry(entry({ size: 42 }))
  const otherWorkspace = registry.cacheEntry(entry({ workspacePath: '/tmp/workspace-b' }))
  const otherConnection = registry.cacheEntry(entry({ connectionId: 'connection-b' }))

  assert.equal(refreshed.id, first.id)
  assert.equal(refreshed.size, 42)
  assert.notEqual(otherWorkspace.id, first.id)
  assert.notEqual(otherConnection.id, first.id)
  assert.equal(registry.getSize(), 3)
  assert.equal(registry.requireEntry('/tmp/workspace-a', first.id, 'file'), refreshed)
  assert.throws(
    () => registry.requireEntry('/tmp/workspace-b', first.id),
    { message: 'Elemento remoto non trovato nel workspace.' },
  )
  assert.throws(
    () => registry.requireEntry('/tmp/workspace-a', first.id, 'directory'),
    { message: 'Tipo di elemento remoto non valido.' },
  )
})

test('aggiorna e rimuove path e indice senza cambiare l ID remoto', () => {
  const registry = createRemoteEntryRegistry()
  const original = registry.cacheEntry(entry())

  registry.updateEntryPath(original, '/srv/app/renamed.json')

  assert.equal(original.remotePath, '/srv/app/renamed.json')
  assert.equal(original.name, 'config.json')
  registry.updateEntryName(original, 'renamed.json')
  assert.equal(original.name, 'renamed.json')
  assert.equal(registry.cacheEntry(entry({ remotePath: '/srv/app/renamed.json', name: 'renamed.json' })).id, original.id)
  assert.notEqual(registry.cacheEntry(entry()).id, original.id)

  const renamed = registry.requireEntry('/tmp/workspace-a', original.id)
  registry.removeEntry(renamed)
  assert.throws(
    () => registry.requireEntry('/tmp/workspace-a', original.id),
    { message: 'Elemento remoto non trovato nel workspace.' },
  )
})

test('pulisce selettivamente un workspace e poi l intero registry', () => {
  const registry = createRemoteEntryRegistry()
  const workspaceA = registry.cacheEntry(entry())
  const workspaceB = registry.cacheEntry(entry({ workspacePath: '/tmp/workspace-b' }))

  registry.clearWorkspace('/tmp/workspace-a')

  assert.equal(registry.getSize(), 1)
  assert.throws(() => registry.requireEntry('/tmp/workspace-a', workspaceA.id), /Elemento remoto non trovato nel workspace\./)
  assert.equal(registry.requireEntry('/tmp/workspace-b', workspaceB.id), workspaceB)

  registry.clear()
  assert.equal(registry.getSize(), 0)
  assert.throws(() => registry.requireEntry('/tmp/workspace-b', workspaceB.id), /Elemento remoto non trovato nel workspace\./)
})

test('applica il limite LRU di diecimila entry considerando i lookup come accessi', () => {
  const registry = createRemoteEntryRegistry()
  const first = registry.cacheEntry(entry({ remotePath: '/srv/app/file-0.txt', name: 'file-0.txt' }))
  const second = registry.cacheEntry(entry({ remotePath: '/srv/app/file-1.txt', name: 'file-1.txt' }))
  for (let index = 2; index < 10_000; index += 1) {
    registry.cacheEntry(entry({ remotePath: `/srv/app/file-${index}.txt`, name: `file-${index}.txt` }))
  }

  registry.requireEntry('/tmp/workspace-a', first.id)
  registry.cacheEntry(entry({ remotePath: '/srv/app/file-10000.txt', name: 'file-10000.txt' }))

  assert.equal(registry.getSize(), 10_000)
  assert.equal(registry.requireEntry('/tmp/workspace-a', first.id).id, first.id)
  assert.throws(
    () => registry.requireEntry('/tmp/workspace-a', second.id),
    { message: 'Elemento remoto non trovato nel workspace.' },
  )
})

test('mantiene il registry come unico owner della cache entry nel dominio file remoti', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-file-service.cjs'), 'utf8')
  const registrySource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-entry-registry.cjs'), 'utf8')

  assert.match(serviceSource, /createRemoteEntryRegistry\(\)/)
  assert.doesNotMatch(serviceSource, /\bentryIdsByKey\b|\bconst entries = new Map\(\)/)
  assert.match(registrySource, /\bconst entries = new Map\(\)/)
  assert.match(registrySource, /\bconst entryIdsByKey = new Map\(\)/)
})
