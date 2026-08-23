const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('la vista AI usa il controller sequenziale senza scarto locale', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(app, /createXtermOutputController/)
  assert.match(app, /terminal\.resume\(/)
  assert.match(app, /terminal\.onOutput\(/)
  assert.match(app, /Rendering rallentato/)
  assert.match(app, /onStreamState\(updateTerminalStreamState\)/)
  assert.doesNotMatch(app, /MAX_PENDING_TERMINAL_OUTPUT|pendingOutputBytes|queueTerminalOutput/)
})
