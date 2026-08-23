import assert from 'node:assert/strict'
import test from 'node:test'

import { specialFileIconKey } from '../src/lib/editor-icon-resolution.ts'

test('classifica ogni variante dotenv come configurazione ambiente e non come Node.js', () => {
  for (const fileName of ['.env', '.env.local', '.env.production', '.env.example']) {
    assert.equal(specialFileIconKey(fileName), 'dotenv')
  }
})

test('riconosce gli artefatti operativi più comuni prima del fallback per estensione', () => {
  const fixtures = {
    '.editorconfig': 'editorconfig',
    'Dockerfile.production': 'docker',
    'LICENSE.md': 'license',
    '.bashrc': 'shell',
    'server.pem': 'certificate',
    'events.proto': 'protobuf',
    'cache.sqlite': 'sqlite',
    'worker.log': 'log',
    'Cargo.toml': 'cargo',
    'pyproject.toml': 'python-config',
    'composer.json': 'composer',
    'biome.json': 'biome',
  }

  for (const [fileName, iconKey] of Object.entries(fixtures)) {
    assert.equal(specialFileIconKey(fileName), iconKey, fileName)
  }
})

test('lascia al resolver per estensione i file senza un nome speciale', () => {
  assert.equal(specialFileIconKey('component.tsx'), null)
  assert.equal(specialFileIconKey('notes.md'), null)
})
