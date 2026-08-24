import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const sourceRoots = ['src', 'electron']

// These files predate src/bridge. Keep the list explicit so that new direct
// renderer-to-preload dependencies cannot be introduced while each legacy
// area is migrated independently.
export const legacyDirectBridgeFiles = new Map([
  ['src/App.tsx', 40],
  ['src/components/benchmark-view-fault-probe.tsx', 1],
  ['src/components/database-workspace.tsx', 22],
  ['src/components/free-terminal.tsx', 27],
  ['src/components/github-workspace.tsx', 30],
  ['src/components/project-instructions.tsx', 7],
  ['src/components/project-skills.tsx', 7],
  ['src/components/redis-workspace.tsx', 1],
  ['src/components/remote-files.tsx', 17],
  ['src/components/settings.tsx', 33],
  ['src/components/terminal-attachments.tsx', 2],
  ['src/components/terminal-diagnostics.tsx', 2],
  ['src/components/terminal-workspace.tsx', 8],
  ['src/components/workspace-switcher.tsx', 1],
  ['src/lib/app-preferences.ts', 1],
  ['src/lib/volatile-draft-store.ts', 1],
  ['src/lib/workspace-session.ts', 2],
])

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(candidate)
    return sourceExtensions.includes(path.extname(entry.name)) ? [candidate] : []
  })
}

function sourceFileFor(file, source) {
  const extension = path.extname(file)
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : extension === '.js' || extension === '.mjs' || extension === '.cjs'
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
}

function moduleSpecifiers(sourceFile) {
  const specifiers = []
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) addLiteral(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const commonJsRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport || commonJsRequire) addLiteral(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...new Set(specifiers)]
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression
  return current
}

function directBridgeAccessCount(sourceFile) {
  let count = 0
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'vincodeLab') {
      const owner = unwrapExpression(node.expression)
      if (ts.isIdentifier(owner) && owner.text === 'window') count += 1
    } else if (ts.isElementAccessExpression(node)) {
      const owner = unwrapExpression(node.expression)
      const key = node.argumentExpression
      if (ts.isIdentifier(owner) && owner.text === 'window' && key && ts.isStringLiteralLike(key) && key.text === 'vincodeLab') count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

function resolveModule(root, importer, specifier) {
  let unresolved
  if (specifier.startsWith('@/')) unresolved = path.join(root, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) unresolved = path.resolve(path.dirname(importer), specifier)
  else return null

  const candidates = [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) => path.join(unresolved, `index${extension}`)),
  ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function featureName(file) {
  return /^src\/features\/([^/]+)\//u.exec(file)?.[1] ?? null
}

function isFeaturePublicEntry(file, feature) {
  return sourceExtensions.some((extension) => file === `src/features/${feature}/index${extension}`)
}

function importBoundaryProblems(importer, imported) {
  const problems = []
  const ownerFeature = featureName(importer)
  const targetFeature = featureName(imported)

  if (importer.startsWith('src/') && imported.startsWith('electron/')) {
    problems.push(`renderer dipende direttamente dal processo Electron (${imported})`)
  }

  if (ownerFeature && targetFeature && ownerFeature !== targetFeature && !isFeaturePublicEntry(imported, targetFeature)) {
    problems.push(`import profondo da feature "${ownerFeature}" verso "${targetFeature}" (${imported})`)
  }

  if (importer.startsWith('src/shared/') && /^(?:src\/(?:app|bridge|components|features)\/)/u.test(imported)) {
    problems.push(`shared dipende da un livello applicativo (${imported})`)
  }

  if (importer.startsWith('src/components/ui/') && /^(?:src\/(?:app|bridge|features)\/)/u.test(imported)) {
    problems.push(`components/ui dipende da un livello applicativo (${imported})`)
  }

  if (importer.startsWith('src/bridge/') && /^(?:src\/(?:app|components|features|theme)\/)/u.test(imported)) {
    problems.push(`bridge dipende da UI o feature (${imported})`)
  }

  if (importer.startsWith('electron/domains/') && /^(?:electron\/(?:app|infrastructure|ipc|preload)\/)/u.test(imported)) {
    problems.push(`dominio Electron dipende da un adapter esterno (${imported})`)
  }

  if (importer.startsWith('electron/ipc/') && /^(?:electron\/(?:app|infrastructure|preload)\/)/u.test(imported)) {
    problems.push(`IPC dipende da un adapter esterno (${imported})`)
  }

  if (importer.startsWith('electron/preload/') && /^(?:electron\/(?:app|domains|infrastructure)\/)/u.test(imported)) {
    problems.push(`preload dipende da implementazioni applicative (${imported})`)
  }

  return problems
}

function findCycles(graph) {
  const cycles = []
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  const cycleKeys = new Set()

  const visit = (node) => {
    if (visited.has(node)) return
    visiting.add(node)
    stack.push(node)
    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) continue
      if (visiting.has(dependency)) {
        const start = stack.indexOf(dependency)
        const cycle = [...stack.slice(start), dependency]
        const members = [...new Set(cycle)].sort()
        const key = members.join('|')
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key)
          cycles.push(cycle)
        }
      } else visit(dependency)
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }

  for (const node of graph.keys()) visit(node)
  return cycles
}

export function inspectArchitecture({ root }) {
  const absoluteRoot = path.resolve(root)
  const files = sourceRoots.flatMap((sourceRoot) => walk(path.join(absoluteRoot, sourceRoot)))
  const graph = new Map()
  const problems = []

  for (const absoluteFile of files) {
    const file = normalize(path.relative(absoluteRoot, absoluteFile))
    const source = readFileSync(absoluteFile, 'utf8')
    const sourceFile = sourceFileFor(file, source)
    const dependencies = []

    if (file.startsWith('src/') && !file.startsWith('src/bridge/')) {
      const directAccesses = directBridgeAccessCount(sourceFile)
      const legacyMaximum = legacyDirectBridgeFiles.get(file)
      if (directAccesses > 0 && legacyMaximum === undefined) {
        problems.push(`${file}: ${directAccesses} accessi diretti a window.vincodeLab fuori da src/bridge`)
      } else if (legacyMaximum !== undefined && directAccesses !== legacyMaximum) {
        problems.push(`${file}: accessi diretti al bridge ${directAccesses}, soglia legacy attesa ${legacyMaximum}; aggiorna intenzionalmente il ratchet`)
      }
    }

    for (const specifier of moduleSpecifiers(sourceFile)) {
      const resolved = resolveModule(absoluteRoot, absoluteFile, specifier)
      if (!resolved) continue
      const imported = normalize(path.relative(absoluteRoot, resolved))
      dependencies.push(imported)
      for (const problem of importBoundaryProblems(file, imported)) problems.push(`${file}: ${problem}`)
    }
    graph.set(file, [...new Set(dependencies)])
  }

  for (const cycle of findCycles(graph)) problems.push(`ciclo di dipendenze: ${cycle.join(' → ')}`)
  return problems.sort()
}

export function formatArchitectureCheck(problems) {
  if (problems.length === 0) return 'Architettura verificata: confini, bridge e dipendenze sono coerenti.'
  return ['Controllo architetturale non superato:', ...problems.map((problem) => `- ${problem}`)].join('\n')
}
