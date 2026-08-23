import assert from 'node:assert/strict'
import test from 'node:test'

import { createAnimationFrameResizeScheduler } from '../src/lib/terminal-resize.js'
import { scheduleVisibleTerminalRefit } from '../src/lib/terminal-activation.js'

test('coalesces repeated resize notifications into one animation frame', () => {
  let callback
  let runs = 0
  const scheduler = createAnimationFrameResizeScheduler(
    () => { runs += 1 },
    (next) => { callback = next; return 7 },
    () => {},
  )

  scheduler.schedule()
  scheduler.schedule()

  assert.equal(runs, 0)
  callback()
  assert.equal(runs, 1)
})

test('cancels a pending resize when its terminal is disposed', () => {
  let cancelledFrame = null
  const scheduler = createAnimationFrameResizeScheduler(
    () => assert.fail('the cancelled frame must not run'),
    () => 12,
    (frame) => { cancelledFrame = frame },
  )

  scheduler.schedule()
  scheduler.cancel()

  assert.equal(cancelledFrame, 12)
})

test('rifà il fit dopo il paint stabilizzato della vista terminale riattivata', () => {
  const frames = []
  let refits = 0

  scheduleVisibleTerminalRefit(() => { refits += 1 }, (callback) => { frames.push(callback); return frames.length }, () => {})

  assert.equal(refits, 0)
  frames.shift()()
  assert.equal(refits, 0)
  frames.shift()()
  assert.equal(refits, 0)
  frames.shift()()
  assert.equal(refits, 1)
})
