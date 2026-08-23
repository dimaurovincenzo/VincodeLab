const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')

test('command palette integration keeps registry execution and modal shortcuts coherent', () => {
  assert.match(app, /commandRegistry\.execute\(commandId,\s*\{\s*source:\s*['"]palette['"]\s*\}\)/)
  assert.match(app, /commandRegistry\.execute\(command,\s*\{\s*source:\s*['"]menu['"]\s*\}\)/)
  assert.match(app, /paletteOpen\s*&&\s*command\s*!==\s*['"]workbench\.commandPalette['"]\s*&&\s*command\s*!==\s*['"]workbench\.quickOpen['"]\)\s*return/)
  assert.match(app, /commandRegistry\.list\(\)\.filter\(\(\{\s*command\s*\}\)\s*=>\s*command\.id\s*!==\s*['"]workbench\.commandPalette['"]\)/)
})

test('Quick Open changes mode in place and does not close its active dialog', () => {
  assert.match(app, /setPaletteMode\(workspace\s*\?\s*['"]files['"]\s*:\s*['"]workspaces['"]\)/)
  assert.match(app, /commandId\s*===\s*['"]workbench\.quickOpen['"][\s\S]{0,100}return false/)
  assert.match(app, /<CommandPalette[\s\S]{0,400}mode=\{paletteMode\}[\s\S]{0,400}onSelect=\{selectPaletteItem\}/)
})

test('ranking reacts to history changes and workspace changes invalidate stale file indexes', () => {
  assert.match(app, /useEffect\(\(\)\s*=>\s*usageHistory\.subscribe\(/)
  assert.match(app, /usageHistoryRevision/)

  const clearIndex = app.indexOf('setIndexedFiles([])')
  const invalidateRequest = app.indexOf('fileIndexRequest.current += 1', clearIndex)
  const closePalette = app.indexOf('setPaletteOpen(false)', clearIndex)
  assert.ok(clearIndex >= 0, 'workspace changes must clear the Quick Open file index')
  assert.ok(invalidateRequest > clearIndex, 'workspace changes must advance the file-index generation')
  assert.ok(closePalette > invalidateRequest, 'stale index requests must be invalidated before the palette closes')
})
