import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import {
  aiFilesystemHostSpecifiers,
  aiFilesystemIsolatedDomains,
  aiProcessSpecifiers,
  databaseDriverSpecifiers,
  databaseVendorExecutionFactories,
  databaseVendorLifecycleProperties,
  databaseVendorSessionFactories,
  databaseVendorTransactionMethods,
  filesystemHostSpecifiers,
  menuHostSpecifiers,
  projectFileIndexIsolatedDomains,
  projectFilesystemIsolatedDomains,
  removedLegacyModules,
  rendererBridgeGlobalContractNames,
  shellOperationalSpecifiers,
} from './architecture-policy.mjs'

const require = createRequire(import.meta.url)
const { IPC_PUBLIC_CHANNELS } = require('../../electron/ipc/channels.cjs')

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const sourceRoots = ['src', 'electron']
const ipcChannelRegistryFile = 'electron/ipc/channels.cjs'
const ipcPublicChannelSet = new Set(IPC_PUBLIC_CHANNELS)
const ipcChannelPattern = /^[a-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9]*$/u
const electronCompositionRootFile = 'electron/main.cjs'
const electronProtectedEntrypointFile = 'electron/app/bootstrap.cjs'
const protectedEntrypointAllowedBareSpecifiers = new Set(['electron'])
const protectedEntrypointAllowedInternalModules = new Set([
  'electron/app/fatal-error-experience',
  'electron/app/startup-bootstrap-guard',
  'electron/infrastructure/logging/logger.adapter',
  'electron/main',
])
const protectedEntrypointAllowedFactories = new Set([
  'createEmergencyFatalExperience',
  'createFatalErrorExperience',
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

function statementPublishesExport(statement) {
  if (ts.isExportAssignment(statement)) return true
  if (ts.isExportDeclaration(statement)) {
    if (!statement.exportClause) return Boolean(statement.moduleSpecifier)
    if (ts.isNamespaceExport(statement.exportClause)) return true
    return statement.exportClause.elements.length > 0
  }
  return Boolean(ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function featurePublicEntryProblems(root) {
  const featuresRoot = path.join(root, 'src/features')
  if (!existsSync(featuresRoot) || !statSync(featuresRoot).isDirectory()) return []

  const problems = []
  for (const entry of readdirSync(featuresRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const feature = `src/features/${entry.name}`
    const publicEntry = path.join(featuresRoot, entry.name, 'index.ts')
    if (!existsSync(publicEntry) || !statSync(publicEntry).isFile()) {
      problems.push(`${feature}: manca l'ingresso pubblico index.ts`)
      continue
    }
    const sourceFile = sourceFileFor(`${feature}/index.ts`, readFileSync(publicEntry, 'utf8'))
    if (!sourceFile.statements.some(statementPublishesExport)) {
      problems.push(`${feature}/index.ts: l'ingresso pubblico non espone alcun export`)
    }
  }
  return problems
}

function moduleSpecifiers(sourceFile) {
  const specifiers = []
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) addLiteral(node.moduleSpecifier)
    if (ts.isImportTypeNode(node)) {
      addLiteral(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument)
    }
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

function isDatabaseDriverSpecifier(specifier) {
  return databaseDriverSpecifiers.some((driver) => specifier === driver || specifier.startsWith(`${driver}/`))
}

function databaseIdentifierReferences(sourceFile, forbiddenNames) {
  const references = new Set()
  const visit = (node) => {
    const name = ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null
    if (name && forbiddenNames.has(name)) references.add(name)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...references]
}

function databaseVendorTransactionReferences(sourceFile) {
  const references = new Set()
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && databaseVendorTransactionMethods.has(node.name.text)) {
      references.add(node.name.text)
    } else if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression
      if (key && ts.isStringLiteralLike(key) && databaseVendorTransactionMethods.has(key.text)) references.add(key.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...references]
}

function databaseVendorLifecycleReferences(sourceFile) {
  const references = new Set()
  const memberName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text
    }
    return null
  }
  const allowedCloseReceiver = (node) => {
    const receiver = unwrapExpression(node.expression)
    return (ts.isIdentifier(receiver) && receiver.text === 'remoteSessions') || memberName(receiver) === 'sqlite'
  }
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)
      if (name && databaseVendorLifecycleProperties.has(name)) references.add(name)
      if (name === 'close' && !allowedCloseReceiver(node)) references.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...references]
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

function windowBridgeIndexedTypeReferenceCount(sourceFile) {
  let count = 0
  const visit = (node) => {
    if (ts.isIndexedAccessTypeNode(node)) {
      const objectType = node.objectType
      const indexType = node.indexType
      const windowType = ts.isTypeReferenceNode(objectType)
        && ts.isIdentifier(objectType.typeName)
        && objectType.typeName.text === 'Window'
      const vincodeLabKey = ts.isLiteralTypeNode(indexType)
        && ts.isStringLiteralLike(indexType.literal)
        && indexType.literal.text === 'vincodeLab'
      if (windowType && vincodeLabKey) count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

function globalBridgeContractDeclarations(sourceFile) {
  const declarations = new Set()
  const collect = (statements) => {
    for (const statement of statements) {
      const name = statement.name && ts.isIdentifier(statement.name) ? statement.name.text : null
      if (name && rendererBridgeGlobalContractNames.has(name)) declarations.add(name)
    }
  }

  if (!ts.isExternalModule(sourceFile)) collect(sourceFile.statements)
  const visit = (node) => {
    if (ts.isModuleDeclaration(node) && node.name.text === 'global') {
      let body = node.body
      while (body && ts.isModuleDeclaration(body)) body = body.body
      if (body && ts.isModuleBlock(body)) collect(body.statements)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...declarations]
}

function bridgeTypeContractProblems(file, sourceFile) {
  const problems = []
  const indexedReferences = windowBridgeIndexedTypeReferenceCount(sourceFile)
  if (indexedReferences > 0) {
    problems.push(`${file}: ${indexedReferences} riferimenti type-level a Window['vincodeLab']; importa VincodeLabBridge da @/bridge`)
  }
  for (const declaration of globalBridgeContractDeclarations(sourceFile)) {
    problems.push(`${file}: contratto bridge globale "${declaration}"; dichiaralo ed esportalo da src/bridge`)
  }
  return problems
}

function isRequireSpecifier(node) {
  return ts.isCallExpression(node.parent)
    && ts.isIdentifier(node.parent.expression)
    && node.parent.expression.text === 'require'
    && node.parent.arguments[0] === node
}

function isIpcTransportLiteral(file, node) {
  if (!ipcChannelPattern.test(node.text) || isRequireSpecifier(node)) return false
  if (file.startsWith('electron/preload/')) return true
  const call = node.parent
  if (ts.isCallExpression(call) && call.arguments[0] === node) {
    if (ts.isIdentifier(call.expression) && call.expression.text === 'sendToRenderer') return true
    if (ts.isPropertyAccessExpression(call.expression) && ['handle', 'invoke', 'on', 'send'].includes(call.expression.name.text)) return true
  }
  if (!file.startsWith('electron/ipc/')) return false
  const tuple = node.parent
  return ts.isArrayLiteralExpression(tuple) && tuple.elements[0] === node
}

function ipcChannelLiteralProblems(file, sourceFile) {
  if (file === ipcChannelRegistryFile || file === 'electron/preload.cjs' || !file.startsWith('electron/')) return []
  const problems = []
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && (ipcPublicChannelSet.has(node.text) || isIpcTransportLiteral(file, node))) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      problems.push(`riga ${line + 1}: stringa canale IPC "${node.text}" fuori dal registro centrale`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return problems
}

function resolveModule(root, importer, specifier) {
  const unresolved = unresolvedModule(root, importer, specifier)
  if (!unresolved) return null

  const candidates = [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) => path.join(unresolved, `index${extension}`)),
  ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function unresolvedModule(root, importer, specifier) {
  if (specifier.startsWith('@/')) return path.join(root, 'src', specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), specifier)
  return null
}

function withoutSourceExtension(file) {
  if (file.endsWith('.d.ts')) return file.slice(0, -'.d.ts'.length)
  const extension = sourceExtensions.find((candidate) => file.endsWith(candidate))
  return extension ? file.slice(0, -extension.length) : file
}

function extensionlessModule(root, importer, specifier) {
  const unresolved = unresolvedModule(root, importer, specifier)
  if (!unresolved) return null
  const relative = normalize(path.relative(root, unresolved))
  return withoutSourceExtension(relative)
}

function extensionlessFile(file) {
  return withoutSourceExtension(file)
}

function featureName(file) {
  return /^src\/features\/([^/]+)\//u.exec(file)?.[1] ?? null
}

function isFeaturePublicEntry(file, feature) {
  return sourceExtensions.some((extension) => file === `src/features/${feature}/index${extension}`)
}

function isPublicEntry(file, directory) {
  return sourceExtensions.some((extension) => file === `${directory}/index${extension}`)
}

function isElectronCompositionRoot(file) {
  return file === electronCompositionRootFile
}

function isElectronProtectedEntrypoint(file) {
  return file === electronProtectedEntrypointFile
}

function isElectronEntrypoint(file) {
  return isElectronCompositionRoot(file) || isElectronProtectedEntrypoint(file)
}

function isProtectedEntrypointAllowedInternalModule(file) {
  return protectedEntrypointAllowedInternalModules.has(extensionlessFile(file))
}

function protectedEntrypointImportProblem(root, importer, specifier) {
  if (!isElectronProtectedEntrypoint(normalize(path.relative(root, importer)))) return null
  if (protectedEntrypointAllowedBareSpecifiers.has(specifier)) return null
  const requested = extensionlessModule(root, importer, specifier)
  if (requested && protectedEntrypointAllowedInternalModules.has(requested)) return null
  return `bootstrap protetto: dipendenza "${specifier}" non consentita; limita l'entrypoint alla guardia fatal e collega servizi o adapter in electron/main.cjs`
}

function protectedEntrypointCompositionReferences(sourceFile) {
  const references = new Set()
  const targetName = (expression) => {
    const target = unwrapExpression(expression)
    if (ts.isIdentifier(target)) return target.text
    if (ts.isPropertyAccessExpression(target)) return target.name.text
    if (ts.isElementAccessExpression(target) && target.argumentExpression && ts.isStringLiteralLike(target.argumentExpression)) {
      return target.argumentExpression.text
    }
    return null
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = targetName(node.expression)
      if (name && /^create[A-Z]/u.test(name) && !protectedEntrypointAllowedFactories.has(name)) references.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...references]
}

function protectedEntrypointLoaderProblems(sourceFile) {
  const problems = new Set()
  const memberName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text
    }
    return null
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const directRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport) {
        problems.add('bootstrap protetto usa import(); il caricamento deve restare sincrono tramite require(<letterale>) incluso nell\'allowlist fatal')
      } else if (directRequire && (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]))) {
        problems.add('bootstrap protetto usa require con un argomento dinamico o non letterale; sono ammesse soltanto dipendenze statiche incluse nell\'allowlist fatal')
      } else if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && memberName(node.expression) === 'require') {
        problems.add('bootstrap protetto usa require in forma indiretta o aliasata; invoca direttamente require(<letterale>)')
      }
    }
    if (ts.isIdentifier(node) && node.text === 'require') {
      const directCallee = ts.isCallExpression(node.parent) && node.parent.expression === node
      if (!directCallee) problems.add('bootstrap protetto usa require in forma indiretta o aliasata; invoca direttamente require(<letterale>)')
    } else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node) === 'require') {
      problems.add('bootstrap protetto usa require in forma indiretta o aliasata; invoca direttamente require(<letterale>)')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...problems]
}

function importBoundaryProblems(importer, imported) {
  const problems = []
  const ownerFeature = featureName(importer)
  const targetFeature = featureName(imported)
  const aiFilesystemIsolatedDomain = aiFilesystemIsolatedDomains.get(importer)

  if (importer.startsWith('src/') && imported.startsWith('electron/')) {
    problems.push(`renderer dipende direttamente dal processo Electron (${imported})`)
  }

  if (aiFilesystemIsolatedDomain && imported.startsWith('electron/domains/filesystem/')) {
    problems.push(`dominio ${aiFilesystemIsolatedDomain} dipende da un'implementazione filesystem concreta (${imported}); usa la porta storage`)
  }

  if (targetFeature && ownerFeature !== targetFeature && !isFeaturePublicEntry(imported, targetFeature)) {
    const owner = ownerFeature ? `feature "${ownerFeature}"` : `modulo "${importer}"`
    problems.push(`import profondo da ${owner} verso feature "${targetFeature}" (${imported})`)
  }

  if (ownerFeature && imported.startsWith('src/app/')) {
    problems.push(`feature "${ownerFeature}" dipende dalla composition root renderer (${imported})`)
  }

  if (importer.startsWith('src/components/') && !importer.startsWith('src/components/ui/') && /^(?:src\/(?:app|features)\/)/u.test(imported)) {
    problems.push(`componente condiviso dipende da app o feature (${imported})`)
  }

  if (importer.startsWith('src/theme/') && /^(?:src\/(?:app|bridge|components|features)\/)/u.test(imported)) {
    problems.push(`tema dipende da UI o logica applicativa (${imported})`)
  }

  if (!importer.startsWith('src/components/ui/') && imported.startsWith('src/components/ui/') && !isPublicEntry(imported, 'src/components/ui')) {
    problems.push(`import profondo nel design system (${imported}); usa @/components/ui`)
  }

  if (!importer.startsWith('src/bridge/') && imported.startsWith('src/bridge/') && !isPublicEntry(imported, 'src/bridge')) {
    problems.push(`import profondo nel bridge renderer (${imported}); usa @/bridge`)
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

  const protectedEntrypointImport = isElectronProtectedEntrypoint(importer)
    && isProtectedEntrypointAllowedInternalModule(imported)
  if (importer.startsWith('electron/app/') && !protectedEntrypointImport && /^(?:electron\/(?:infrastructure|ipc|preload)\/)/u.test(imported) && imported !== ipcChannelRegistryFile) {
    problems.push(`application layer Electron dipende da un adapter esterno (${imported})`)
  }

  if (importer.startsWith('electron/domains/') && /^(?:electron\/(?:app|infrastructure|ipc|preload)\/)/u.test(imported) && imported !== ipcChannelRegistryFile) {
    problems.push(`dominio Electron dipende da un adapter esterno (${imported})`)
  }

  if (importer.startsWith('electron/infrastructure/') && /^(?:electron\/(?:app|ipc|preload)\/)/u.test(imported) && imported !== ipcChannelRegistryFile) {
    problems.push(`infrastruttura Electron dipende da application, IPC o preload (${imported})`)
  }

  if (importer.startsWith('electron/ipc/') && /^(?:electron\/(?:app|infrastructure|preload)\/)/u.test(imported)) {
    problems.push(`IPC dipende da un adapter esterno (${imported})`)
  }

  if (importer.startsWith('electron/preload/') && imported.startsWith('electron/') && !imported.startsWith('electron/preload/') && imported !== ipcChannelRegistryFile) {
    problems.push(`preload esce dal proprio confine isolato (${imported})`)
  }

  if (!isElectronEntrypoint(importer) && isElectronCompositionRoot(imported)) {
    problems.push(`modulo interno dipende dalla composition root Electron (${imported})`)
  }

  if (!isElectronEntrypoint(importer) && isElectronProtectedEntrypoint(imported)) {
    problems.push(`modulo interno dipende dall'entrypoint protetto Electron (${imported})`)
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
  const problems = featurePublicEntryProblems(absoluteRoot)

  for (const absoluteFile of files) {
    const file = normalize(path.relative(absoluteRoot, absoluteFile))
    const removedOwner = removedLegacyModules.get(extensionlessFile(file))
    if (removedOwner) problems.push(`${file}: path legacy rimosso ricreato; usa "${removedOwner}"`)
    const source = readFileSync(absoluteFile, 'utf8')
    const sourceFile = sourceFileFor(file, source)
    const dependencies = []

    if (isElectronProtectedEntrypoint(file)) {
      for (const factory of protectedEntrypointCompositionReferences(sourceFile)) {
        problems.push(`${file}: bootstrap protetto compone la factory "${factory}"; la composizione applicativa appartiene a electron/main.cjs`)
      }
      for (const problem of protectedEntrypointLoaderProblems(sourceFile)) problems.push(`${file}: ${problem}`)
    }

    for (const problem of ipcChannelLiteralProblems(file, sourceFile)) problems.push(`${file}: ${problem}`)
    for (const problem of bridgeTypeContractProblems(file, sourceFile)) problems.push(problem)

    if (file.startsWith('electron/domains/database/')) {
      for (const factory of databaseIdentifierReferences(sourceFile, databaseVendorExecutionFactories)) {
        problems.push(`${file}: factory driver "${factory}" non consentita nel dominio Database; usa executeRemote della porta driver`)
      }
      for (const factory of databaseIdentifierReferences(sourceFile, databaseVendorSessionFactories)) {
        problems.push(`${file}: factory apertura driver "${factory}" non consentita nel dominio Database; usa openRemoteSession della porta driver`)
      }
      for (const method of databaseVendorTransactionReferences(sourceFile)) {
        problems.push(`${file}: metodo transazionale vendor "${method}" non consentito nel dominio Database; usa executeTransaction della porta driver`)
      }
      for (const property of databaseVendorLifecycleReferences(sourceFile)) {
        problems.push(`${file}: proprietà lifecycle vendor "${property}" non consentita nel dominio Database; usa l'handle opaco e le operazioni semantiche della porta driver`)
      }
    }

    if (file.startsWith('src/') && !file.startsWith('src/bridge/')) {
      const directAccesses = directBridgeAccessCount(sourceFile)
      if (directAccesses > 0) {
        problems.push(`${file}: ${directAccesses} accessi diretti a window.vincodeLab fuori da src/bridge`)
      }
    }

    for (const specifier of moduleSpecifiers(sourceFile)) {
      const protectedEntrypointProblem = protectedEntrypointImportProblem(absoluteRoot, absoluteFile, specifier)
      if (protectedEntrypointProblem) {
        problems.push(`${file}: ${protectedEntrypointProblem}`)
        continue
      }
      if (file.startsWith('electron/domains/database/') && isDatabaseDriverSpecifier(specifier)) {
        problems.push(`${file}: dominio Database dipende direttamente dal driver esterno "${specifier}"; usa la porta driver`)
        continue
      }
      if (file.startsWith('electron/domains/shell/') && shellOperationalSpecifiers.has(specifier)) {
        problems.push(`${file}: dominio Shell dipende direttamente dall'host operativo "${specifier}"; usa i collaboratori iniettati`)
        continue
      }
      const aiFilesystemIsolatedDomain = aiFilesystemIsolatedDomains.get(file)
      if (aiFilesystemIsolatedDomain && aiFilesystemHostSpecifiers.has(specifier)) {
        problems.push(`${file}: dominio ${aiFilesystemIsolatedDomain} dipende direttamente dal filesystem host "${specifier}"; usa la porta storage iniettata`)
        continue
      }
      const projectFilesystemDomain = projectFilesystemIsolatedDomains.get(file)
        ?? projectFileIndexIsolatedDomains.get(file)
        ?? (file.startsWith('electron/domains/filesystem/') ? 'Filesystem progetto' : null)
      if (projectFilesystemDomain && filesystemHostSpecifiers.has(specifier)) {
        problems.push(`${file}: dominio ${projectFilesystemDomain} dipende direttamente dal filesystem host "${specifier}"; usa la porta host iniettata`)
        continue
      }
      if (file.startsWith('electron/domains/ai/') && aiProcessSpecifiers.has(specifier)) {
        problems.push(`${file}: dominio AI dipende direttamente dai processi host "${specifier}"; usa un adapter iniettato`)
        continue
      }
      if (file.startsWith('electron/domains/menu/') && menuHostSpecifiers.has(specifier)) {
        problems.push(`${file}: dominio Menu dipende direttamente dall'host operativo "${specifier}"; sposta l'orchestrazione in app e usa un adapter iniettato`)
        continue
      }
      const requested = extensionlessModule(absoluteRoot, absoluteFile, specifier)
      const canonicalOwner = requested ? removedLegacyModules.get(requested) : null
      if (canonicalOwner) {
        problems.push(`${file}: path legacy "${requested}" rimosso; usa "${canonicalOwner}"`)
        continue
      }
      const resolved = resolveModule(absoluteRoot, absoluteFile, specifier)
      if (!resolved) continue
      const imported = normalize(path.relative(absoluteRoot, resolved))
      dependencies.push(imported)
      for (const problem of importBoundaryProblems(file, imported)) problems.push(`${file}: ${problem}`)
    }
    graph.set(file, [...new Set(dependencies)])
  }

  for (const absoluteFile of walk(path.join(absoluteRoot, 'test/components'))) {
    const file = normalize(path.relative(absoluteRoot, absoluteFile))
    const sourceFile = sourceFileFor(file, readFileSync(absoluteFile, 'utf8'))
    for (const problem of bridgeTypeContractProblems(file, sourceFile)) problems.push(problem)
  }

  for (const cycle of findCycles(graph)) problems.push(`ciclo di dipendenze: ${cycle.join(' → ')}`)
  return problems.sort()
}

export function formatArchitectureCheck(problems) {
  if (problems.length === 0) return 'Architettura verificata: confini, bridge e dipendenze sono coerenti.'
  return ['Controllo architetturale non superato:', ...problems.map((problem) => `- ${problem}`)].join('\n')
}
