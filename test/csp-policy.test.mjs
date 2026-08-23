import assert from 'node:assert/strict'
import test from 'node:test'

import { contentSecurityPolicy } from '../scripts/csp-policy.mjs'

test('la CSP del pacchetto non abilita endpoint del server di sviluppo', () => {
  const policy = contentSecurityPolicy()

  assert.doesNotMatch(policy, /127\.0\.0\.1|localhost|ws:/u)
  assert.match(policy, /connect-src 'self'/u)
  assert.match(policy, /frame-src 'none'/u)
})

test('la CSP di sviluppo limita Vite al solo loopback previsto', () => {
  const policy = contentSecurityPolicy({ development: true })

  assert.match(policy, /http:\/\/127\.0\.0\.1:5173/u)
  assert.match(policy, /ws:\/\/127\.0\.0\.1:5173/u)
  assert.doesNotMatch(policy, /localhost|0\.0\.0\.0/u)
})
