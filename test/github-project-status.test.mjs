import assert from 'node:assert/strict'
import test from 'node:test'

import { githubProjectStatusTone } from '../src/lib/github-project-status.js'

test('assegna toni distinti agli stati operativi standard dei Project', () => {
  assert.equal(githubProjectStatusTone('Completato'), 'success')
  assert.equal(githubProjectStatusTone('In lavorazione'), 'info')
  assert.equal(githubProjectStatusTone('Da pianificare'), 'planned')
  assert.equal(githubProjectStatusTone('In attesa'), 'warning')
  assert.equal(githubProjectStatusTone('Pronto'), 'ready')
  assert.equal(githubProjectStatusTone('Bloccato'), 'error')
})

test('normalizza accenti e mantiene neutri gli stati non riconosciuti', () => {
  assert.equal(githubProjectStatusTone('  DA PIANIFICÀRE  '), 'planned')
  assert.equal(githubProjectStatusTone('Stato personalizzato'), 'inactive')
  assert.equal(githubProjectStatusTone(''), 'inactive')
})
