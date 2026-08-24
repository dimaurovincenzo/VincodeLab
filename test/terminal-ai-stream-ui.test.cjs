const assert = require('node:assert/strict')
const test = require('node:test')
const { readAppSource } = require('./helpers/app-source.cjs')

test('la vista AI usa il controller sequenziale senza scarto locale', () => {
  const app = readAppSource()
  assert.match(app, /createXtermOutputController/)
  assert.match(app, /terminal\.resume\(/)
  assert.match(app, /terminal\.onOutput\(/)
  assert.match(app, /Rendering rallentato/)
  assert.match(app, /onStreamState\(updateTerminalStreamState\)/)
  assert.doesNotMatch(app, /MAX_PENDING_TERMINAL_OUTPUT|pendingOutputBytes|queueTerminalOutput/)
})
