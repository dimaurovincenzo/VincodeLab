import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const settingsEntry = 'src/theme/styles/settings.ts'
const expectedSettingsStylesDigest = '4cf3ac6d1ba185468bccb936b9a9b25d7c305f442314c98415e39478db4d471a'
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function parseSource(relativePath) {
  return ts.createSourceFile(relativePath, readSource(relativePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function objectInitializer(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== variableName) continue
      assert.ok(declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer), `${variableName} deve essere un object literal`)
      return declaration.initializer
    }
  }
  assert.fail(`${variableName} non trovato in ${sourceFile.fileName}`)
}

function importedModules(sourceFile) {
  const imports = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue
    for (const element of statement.importClause.namedBindings.elements) imports.set(element.name.text, statement.moduleSpecifier.text)
  }
  return imports
}

function resolveTypeScriptModule(importer, specifier) {
  assert.ok(specifier.startsWith('.'), `Lo spread ${specifier} deve restare un modulo locale`)
  const unresolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
  return unresolved.endsWith('.ts') ? unresolved : `${unresolved}.ts`
}

function styleEntries(relativePath, variableName, visited = new Set()) {
  const visitKey = `${relativePath}:${variableName}`
  assert.equal(visited.has(visitKey), false, `Ciclo negli stili Settings: ${visitKey}`)
  visited.add(visitKey)
  const sourceFile = parseSource(relativePath)
  const imports = importedModules(sourceFile)
  const entries = []

  for (const property of objectInitializer(sourceFile, variableName).properties) {
    if (ts.isPropertyAssignment(property)) {
      assert.ok(ts.isIdentifier(property.name), `Chiave Settings non statica in ${relativePath}`)
      entries.push({
        key: property.name.text,
        value: printer.printNode(ts.EmitHint.Unspecified, property.initializer, sourceFile),
      })
      continue
    }
    assert.ok(ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression), `Proprietà Settings non supportata in ${relativePath}`)
    const specifier = imports.get(property.expression.text)
    assert.ok(specifier, `Spread ${property.expression.text} non importato in ${relativePath}`)
    entries.push(...styleEntries(resolveTypeScriptModule(relativePath, specifier), property.expression.text, visited))
  }

  visited.delete(visitKey)
  return entries
}

function walkSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) return walkSourceFiles(candidate)
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [candidate] : []
  })
}

test('settingsStyles conserva integralmente chiavi ordine e valori Panda della baseline', () => {
  const entries = styleEntries(settingsEntry, 'settingsStyles')
  const canonical = entries.map(({ key, value }) => `${key}=${value}`).join('\n')

  assert.equal(entries.length, 93)
  assert.equal(new Set(entries.map(({ key }) => key)).size, 93)
  assert.equal(crypto.createHash('sha256').update(canonical).digest('hex'), expectedSettingsStylesDigest)
})

test('Settings compone capability e skill mantenendo settingsStyles come ingresso unico', () => {
  const entry = readSource(settingsEntry)
  const capabilities = readSource('src/theme/styles/settings-capabilities.ts')
  const skills = readSource('src/theme/styles/settings-skills.ts')

  assert.match(entry, /import \{ settingsCapabilityStyles \} from '\.\/settings-capabilities'/)
  assert.match(entry, /import \{ settingsSkillStyles \} from '\.\/settings-skills'/)
  assert.match(entry, /\.\.\.settingsCapabilityStyles/)
  assert.match(entry, /\.\.\.settingsSkillStyles/)
  assert.doesNotMatch(entry, /^  (?:capabilityGroups|form|skillEditor):\s*css\(/mu)
  assert.match(capabilities, /export const settingsCapabilityStyles = \{/)
  assert.match(skills, /export const settingsSkillStyles = \{/)

  const privateModuleImport = /(?:@\/theme\/styles|theme\/styles|\.\/styles)\/settings-(?:capabilities|skills)/u
  for (const absoluteFile of walkSourceFiles(path.join(projectRoot, 'src'))) {
    const relativeFile = path.relative(projectRoot, absoluteFile).split(path.sep).join('/')
    if (relativeFile === settingsEntry) continue
    assert.doesNotMatch(fs.readFileSync(absoluteFile, 'utf8'), privateModuleImport, `${relativeFile} importa un blocco Settings privato`)
  }

  assert.doesNotMatch([entry, capabilities, skills].join('\n'), /#[0-9a-f]{3,8}\b|rgb\(|linear-gradient|radial-gradient|!important/iu)
})
