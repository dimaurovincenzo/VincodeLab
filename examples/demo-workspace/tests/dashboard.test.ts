import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardSummary, healthScore, metrics } from '../src/dashboard.ts'

test('calcola uno stato coerente per tutte le metriche demo', () => {
  assert.equal(metrics.every((metric) => healthScore(metric) >= 0), true)
  assert.deepEqual(dashboardSummary(), {
    accent: '#7069ff',
    healthy: 3,
    services: 3,
    status: 'operational',
  })
})
