import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldFollowTerminalOutput, terminalStatusLabel } from '../src/lib/terminal-viewport.js'

test('segue output solo quando il viewport è in fondo', () => {
  assert.equal(shouldFollowTerminalOutput({ viewportY: 45, baseY: 45 }), true)
  assert.equal(shouldFollowTerminalOutput({ viewportY: 44, baseY: 45 }), false)
})

test('produce etichette concise per gli stati del terminale', () => {
  assert.equal(terminalStatusLabel('running', 'Pi pronto'), 'Pi pronto')
  assert.equal(terminalStatusLabel('starting', 'Pi pronto'), 'Avvio…')
  assert.equal(terminalStatusLabel('ended', 'Pi pronto'), 'Sessione terminata')
  assert.equal(terminalStatusLabel('error', 'Pi pronto'), 'Errore sessione')
})
