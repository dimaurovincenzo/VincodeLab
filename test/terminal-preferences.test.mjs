import assert from 'node:assert/strict'
import test from 'node:test'

import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '../src/lib/terminal-preferences.js'

test('isola le preferenze terminale per workspace e limita il font', () => {
  const previousStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }

  try {
    assert.equal(nextTerminalFontSize(11, -1), 11)
    assert.equal(nextTerminalFontSize(20, 1), 20)
    writeTerminalPreferences('/workspace/a', { fontSize: 14, followOutput: false })
    assert.deepEqual(readTerminalPreferences('/workspace/a'), { fontSize: 14, followOutput: false })
    assert.deepEqual(readTerminalPreferences('/workspace/b'), { fontSize: 11, followOutput: true })
  } finally {
    globalThis.localStorage = previousStorage
  }
})

test('mantiene i valori in memoria e segnala storage corrotto o non scrivibile', () => {
  const previousStorage = globalThis.localStorage
  const readErrors = []
  const writeErrors = []
  globalThis.localStorage = {
    getItem: () => '{non-json',
    setItem: () => { throw new Error('QuotaExceededError') },
  }

  try {
    assert.deepEqual(readTerminalPreferences('/workspace/a', { onError: (error) => readErrors.push(error) }), { fontSize: 11, followOutput: true })
    assert.equal(readErrors.length, 1)
    assert.equal(writeTerminalPreferences('/workspace/a', { fontSize: 16, followOutput: true }, { onError: (error) => writeErrors.push(error) }), false)
    assert.equal(writeErrors.length, 1)
  } finally {
    globalThis.localStorage = previousStorage
  }
})
