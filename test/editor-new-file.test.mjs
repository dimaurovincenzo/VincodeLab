import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const modulePath = path.join(import.meta.dirname, '../src/lib/editor-new-file.ts')
const draftModule = fs.existsSync(modulePath) ? await import(pathToFileURL(modulePath)) : {}

test('conferma una bozza con nome e annulla una bozza vuota', () => {
  assert.equal(typeof draftModule.resolveNewFileDraft, 'function')
  assert.deepEqual(draftModule.resolveNewFileDraft('  nuovo-file.ts  '), { action: 'create', fileName: 'nuovo-file.ts' })
  assert.deepEqual(draftModule.resolveNewFileDraft('   '), { action: 'cancel' })
})
