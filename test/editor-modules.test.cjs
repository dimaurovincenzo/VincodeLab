const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectFiles = require('../electron/domains/filesystem/project-files.cjs')

const root = path.join(__dirname, '..')

function lines(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').split('\n').length
}

test('Editor separa orchestrazione Explorer e mutazioni contestuali', () => {
  assert.ok(lines('src/features/editor/components/project-editor.tsx') < 500)
  assert.ok(lines('src/features/editor/hooks/use-project-explorer.ts') < 500)
  assert.ok(lines('src/features/editor/hooks/use-project-entry-actions.ts') < 500)
})

test('filesystem Editor espone una facciata stabile sopra owner coesi', () => {
  assert.ok(lines('electron/domains/filesystem/project-files.cjs') < 100)
  for (const operation of [
    'collectDirectoryEntries',
    'createProjectDirectoryListing',
    'createProjectEntryMutations',
    'createProjectFileActions',
    'createProjectFileReader',
    'createProjectFileSaver',
  ]) assert.equal(typeof projectFiles[operation], 'function', `${operation} deve restare nell'API pubblica`)
})
