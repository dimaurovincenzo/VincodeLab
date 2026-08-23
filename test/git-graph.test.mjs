import assert from 'node:assert/strict'
import test from 'node:test'

import { layoutGitGraph } from '../src/lib/git-graph.js'

test('draws a single lane for linear history', () => {
  const rows = layoutGitGraph([
    { sha: 'c3', parents: ['c2'], refs: [], subject: 'terzo' },
    { sha: 'c2', parents: ['c1'], refs: [], subject: 'secondo' },
    { sha: 'c1', parents: [], refs: [], subject: 'primo' },
  ])
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0])
  assert.deepEqual(rows[0].links, [{ from: 0, to: 0 }])
})

test('creates an additional lane for a merge parent', () => {
  const rows = layoutGitGraph([
    { sha: 'merge', parents: ['main', 'feature'], refs: [], subject: 'merge' },
    { sha: 'main', parents: ['base'], refs: [], subject: 'main' },
    { sha: 'feature', parents: ['base'], refs: [], subject: 'feature' },
  ])
  assert.equal(rows[0].laneCount, 2)
  assert.deepEqual(rows[0].links, [{ from: 0, to: 0 }, { from: 0, to: 1 }])
  assert.equal(rows[2].lane, 1)
  assert.deepEqual(rows[2].links, [{ from: 0, to: 0 }, { from: 1, to: 0 }])
})
