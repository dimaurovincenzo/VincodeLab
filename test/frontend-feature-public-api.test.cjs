const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.join(__dirname, '..', 'src', 'features')

function publicSurface(feature) {
  const filename = path.join(root, feature, 'index.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const exports = []

  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
      assert.equal(exported, false, `${feature} deve riesportare soltanto owner esistenti`)
      continue
    }
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause), `${feature} deve usare export nominati espliciti`)
    const modulePath = statement.moduleSpecifier?.text
    assert.equal(typeof modulePath, 'string', `${feature} non deve riesportare dichiarazioni locali`)
    for (const element of statement.exportClause.elements) {
      exports.push(`${statement.isTypeOnly || element.isTypeOnly ? 'type' : 'value'}:${element.name.text}@${modulePath}`)
    }
  }

  return exports.sort()
}

test('le feature frontend espongono solo i contratti usati dalla composition root', () => {
  assert.deepEqual(publicSurface('database'), [
    'type:DatabaseWorkbenchContext@./model/database.types',
    'value:DatabaseWorkspace@./components/database-workspace',
  ])
  assert.deepEqual(publicSurface('editor'), [
    'type:EditorWorkbenchContext@./model/editor.types',
    'type:EditorWorkbenchRequest@./model/editor.types',
    'type:RemoteOpenRequest@./model/editor.types',
    'value:ProjectEditor@./components/project-editor',
  ])
  assert.deepEqual(publicSurface('settings'), [
    'value:Settings@./components/settings',
  ])
  assert.deepEqual(publicSurface('workspace'), [
    'value:WorkspaceSwitcher@./components/workspace-switcher',
    'value:createWorkspaceSessionClient@./model/workspace-session',
  ])
})

test('i barrel pubblici non espongono bridge o hook di implementazione', () => {
  for (const feature of ['database', 'editor', 'settings', 'workspace']) {
    const surface = publicSurface(feature)
    assert.equal(surface.some((entry) => /Bridge|\/api\/|\/hooks\//u.test(entry)), false, feature)
  }
})
