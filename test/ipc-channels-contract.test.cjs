const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const registry = require('../electron/ipc/channels.cjs')
const baseline = require('./ipc-channels-v1.snapshot.json')

function sorted(values) {
  return [...values].sort()
}

function ownedChannels(owners, direction) {
  const ownership = new Map()
  for (const [owner, channels] of Object.entries(owners)) {
    assert.equal(Object.isFrozen(channels), true, `${direction} di ${owner} deve essere immutabile`)
    for (const channel of channels) {
      assert.equal(ownership.has(channel), false, `ownership ${direction} duplicata per ${channel}`)
      ownership.set(channel, owner)
    }
  }
  return ownership
}

test('il registro IPC v1 coincide con lo snapshot pubblico compatibile', () => {
  assert.equal(registry.IPC_CONTRACT_VERSION, baseline.version)
  assert.deepEqual(sorted(registry.IPC_INVOKE_CHANNELS), baseline.invoke)
  assert.deepEqual(sorted(registry.IPC_RENDERER_SEND_CHANNELS), baseline.rendererSend)
  assert.deepEqual(sorted(registry.IPC_MAIN_TO_RENDERER_CHANNELS), baseline.mainEvent)
  assert.ok(baseline.invoke.includes('database:disconnect'))
})

test('ogni stringa e ogni direzione del contratto hanno ownership univoca', () => {
  assert.equal(Object.isFrozen(registry.IPC_CHANNELS), true)
  const symbolicChannels = Object.values(registry.IPC_CHANNELS)
  assert.equal(new Set(symbolicChannels).size, symbolicChannels.length, 'le costanti non possono condividere una stringa')

  const invoke = ownedChannels(registry.IPC_INVOKE_OWNERS, 'invoke')
  const rendererSend = ownedChannels(registry.IPC_RENDERER_SEND_OWNERS, 'send renderer→main')
  const mainEvent = ownedChannels(registry.IPC_MAIN_EVENT_OWNERS, 'evento main→renderer')
  assert.deepEqual(sorted(invoke.keys()), sorted(registry.IPC_INVOKE_CHANNELS))
  assert.deepEqual(sorted(rendererSend.keys()), sorted(registry.IPC_RENDERER_SEND_CHANNELS))
  assert.deepEqual(sorted(mainEvent.keys()), sorted(registry.IPC_MAIN_TO_RENDERER_CHANNELS))

  const directionalChannels = [...invoke.keys(), ...rendererSend.keys(), ...mainEvent.keys()]
  assert.equal(new Set(directionalChannels).size, directionalChannels.length, 'un canale non può appartenere a più direzioni')
  assert.deepEqual(sorted(directionalChannels), sorted(registry.IPC_PUBLIC_CHANNELS))
})

test('i registrar riusano per identità i manifesti del registro centrale', () => {
  const domainsRoot = path.join(__dirname, '../electron/ipc/domains')
  const exportedManifests = new Map()
  for (const file of fs.readdirSync(domainsRoot).filter((name) => name.endsWith('.ipc.cjs'))) {
    for (const [name, value] of Object.entries(require(path.join(domainsRoot, file)))) {
      if (!name.endsWith('_CHANNELS')) continue
      assert.equal(exportedManifests.has(name), false, `manifesto duplicato: ${name}`)
      exportedManifests.set(name, value)
    }
  }

  const registryManifests = Object.entries(registry).filter(([name, value]) => name.endsWith('_CHANNELS') && !name.startsWith('IPC_') && Array.isArray(value))
  assert.equal(exportedManifests.size, registryManifests.length)
  for (const [name, value] of registryManifests) {
    assert.equal(exportedManifests.get(name), value, `${name} deve provenire da channels.cjs`)
  }
})
