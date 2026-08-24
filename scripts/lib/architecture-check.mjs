import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { IPC_PUBLIC_CHANNELS } = require('../../electron/ipc/channels.cjs')

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const sourceRoots = ['src', 'electron']
const ipcChannelRegistryFile = 'electron/ipc/channels.cjs'
const ipcPublicChannelSet = new Set(IPC_PUBLIC_CHANNELS)
const ipcChannelPattern = /^[a-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9]*$/u
const databaseDriverSpecifiers = Object.freeze(['better-sqlite3', 'mysql2', 'pg', 'tedious'])
const databaseVendorExecutionFactories = new Set([
  'addMssqlParameter',
  'createMssqlRequest',
  'createPostgresQuery',
])
const databaseVendorSessionFactories = new Set([
  'createMssqlConnection',
  'createMysqlClient',
  'createPostgresClient',
  'openMssqlConnection',
  'openMssqlConnectionFromFactory',
])
const databaseVendorTransactionMethods = new Set([
  'beginTransaction',
  'commitTransaction',
  'rollbackTransaction',
])
const databaseVendorLifecycleProperties = new Set([
  'client',
  'connection',
  'destroy',
  'end',
  'socket',
  'stream',
])
const shellOperationalSpecifiers = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'node-pty'])
const aiProcessSpecifiers = new Set(['child_process', 'node:child_process'])
const aiFilesystemHostSpecifiers = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'path', 'node:path'])
const aiFilesystemIsolatedDomains = new Map([
  ['electron/domains/ai/project-instructions-storage.port.cjs', 'Porta Istruzioni progetto'],
  ['electron/domains/ai/project-instructions.cjs', 'Istruzioni progetto'],
  ['electron/domains/ai/project-skills-storage.port.cjs', 'Porta Skill progetto'],
  ['electron/domains/ai/project-skills.cjs', 'Skill progetto'],
])
const menuHostSpecifiers = new Set(['child_process', 'electron', 'node:child_process'])

// These files predate src/bridge. Keep the list explicit so that new direct
// renderer-to-preload dependencies cannot be introduced while each legacy
// area is migrated independently.
export const legacyDirectBridgeFiles = new Map([
])

// Removed compatibility paths are kept here as a one-way ratchet. Importers
// must move to the canonical owner instead of recreating a facade in the old
// location.
export const removedLegacyModules = new Map([
  ['src/App', 'src/app'],
  ['src/app/components/ai-session-error-notice', 'src/features/ai'],
  ['src/app/components/ai-workbench', 'src/features/ai'],
  ['src/app/hooks/use-ai-failure', 'src/features/ai'],
  ['src/app/hooks/use-ai-terminal-instance', 'src/features/ai'],
  ['src/app/hooks/use-ai-terminal-paste', 'src/features/ai'],
  ['src/app/hooks/use-ai-terminal-runtime', 'src/features/ai'],
  ['src/components/terminal-paste-status', 'src/features/ai'],
  ['src/components/database-workspace', 'src/features/database'],
  ['src/components/free-terminal', 'src/features/terminal'],
  ['src/components/github-workspace', 'src/features/github'],
  ['src/components/project-editor', 'src/features/editor'],
  ['src/components/remote-diff-dialog', 'src/features/editor'],
  ['src/components/redis-workspace', 'src/features/redis'],
  ['src/components/remote-files', 'src/features/remote-files'],
  ['src/components/settings', 'src/features/settings'],
  ['src/components/terminal-workspace', 'src/features/terminal'],
  ['src/components/workspace-switcher', 'src/features/workspace'],
  // These models have a single feature owner; keeping their former generic
  // lib paths forbidden prevents compatibility facades from blurring it again.
  ['src/lib/database-query', 'src/features/database'],
  ['src/lib/editor-icon-resolution', 'src/features/editor'],
  ['src/lib/editor-new-file', 'src/features/editor'],
  ['src/lib/git-graph', 'src/features/github'],
  ['src/lib/github-project-status', 'src/features/github'],
  ['src/lib/remote-transfer-retry', 'src/features/remote-files'],
  ['src/lib/shell-xterm-output-controller', 'src/features/terminal'],
  ['src/lib/sql-format', 'src/features/database'],
  ['src/lib/sql-highlight', 'src/features/database'],
  ['src/lib/sql-lint', 'src/features/database'],
  ['src/lib/workspace-command-library', 'src/features/terminal'],
  ['src/lib/terminal-paste-controller', 'src/features/ai'],
  ['src/lib/workspace-session', 'src/features/workspace'],
  ['electron/github-service', 'electron/infrastructure/github/github-service.adapter.cjs'],
  ['electron/github-operation-registry', 'electron/domains/github/github-operation-registry.cjs'],
  ['electron/github-projects', 'electron/domains/github/github-projects.cjs'],
  ['electron/github-cli-executable', 'electron/infrastructure/github/github-cli-executable.adapter.cjs'],
  ['electron/fatal-error-experience', 'electron/app/fatal-error-experience.cjs'],
  ['electron/application-menu', 'electron/domains/menu/application-menu.cjs'],
  ['electron/context-menu', 'electron/domains/menu/context-menu.cjs'],
  ['electron/domains/menu/context-command-dispatcher', 'electron/app/context-command-runtime.cjs'],
  ['electron/logger', 'electron/infrastructure/logging/logger.adapter.cjs'],
  ['electron/lifecycle-close-controller', 'electron/app/lifecycle-close-controller.cjs'],
  ['electron/ipc-one-way-error', 'electron/infrastructure/ipc/ipc-one-way-error.cjs'],
  ['electron/ipc-security', 'electron/infrastructure/security/ipc-security.adapter.cjs'],
  ['electron/instance-launcher', 'electron/infrastructure/processes/instance-launcher.adapter.cjs'],
  ['electron/instance-registry', 'electron/infrastructure/persistence/instance-registry.adapter.cjs'],
  ['electron/app-preferences', 'electron/infrastructure/persistence/app-preferences.repository.cjs'],
  ['electron/bootstrap', 'electron/app/bootstrap.cjs'],
  ['electron/database-store', 'electron/infrastructure/persistence/database.repository.cjs'],
  ['electron/redis-store', 'electron/infrastructure/persistence/redis.repository.cjs'],
  ['electron/update-activation', 'electron/infrastructure/updates/update-activation.adapter.cjs'],
  ['electron/update-checker', 'electron/infrastructure/updates/update-checker.adapter.cjs'],
  ['electron/update-discovery', 'electron/infrastructure/updates/update-discovery.adapter.cjs'],
  ['electron/update-downloader', 'electron/infrastructure/updates/update-downloader.adapter.cjs'],
  ['electron/update-service', 'electron/domains/updates/update-service.cjs'],
  ['electron/update-store', 'electron/infrastructure/persistence/update.repository.cjs'],
  ['electron/workspace-cache', 'electron/infrastructure/persistence/workspace-cache.repository.cjs'],
  ['electron/workspace-commands', 'electron/infrastructure/persistence/workspace-commands.repository.cjs'],
  ['electron/workspace-session-store', 'electron/infrastructure/persistence/workspace-session.repository.cjs'],
  ['electron/workspace-store', 'electron/infrastructure/persistence/workspace.repository.cjs'],
  ['electron/managed-ssh-service', 'electron/infrastructure/remote/managed-ssh-service.adapter.cjs'],
  ['electron/external-mutation-registry', 'electron/domains/workspace/external-mutation-registry.cjs'],
  ['electron/file-utils', 'electron/domains/filesystem/file-utils.cjs'],
  ['electron/database-service', 'electron/domains/database/database-service.cjs'],
  ['electron/database-operation-registry', 'electron/domains/database/database-operation-registry.cjs'],
  ['electron/database-result-budget', 'electron/domains/database/database-result-budget.cjs'],
  ['electron/database-session-registry', 'electron/domains/database/database-session-registry.cjs'],
  ['electron/application-error', 'electron/domains/errors/application-error.cjs'],
  ['electron/project-files', 'electron/domains/filesystem/project-files.cjs'],
  ['electron/project-file-index', 'electron/domains/filesystem/project-file-index.cjs'],
  ['electron/project-instructions', 'electron/domains/ai/project-instructions.cjs'],
  ['electron/project-skills', 'electron/domains/ai/project-skills.cjs'],
  ['electron/preload-error-experience', 'electron/app/preload-error-experience.cjs'],
  ['electron/public-error', 'electron/domains/errors/public-error.cjs'],
  ['electron/redis-service', 'electron/domains/redis/redis-service.cjs'],
  ['electron/redis-connection-input', 'electron/domains/redis/redis-connection-input.cjs'],
  ['electron/redis-operation-registry', 'electron/domains/redis/redis-operation-registry.cjs'],
  ['electron/redis-result-budget', 'electron/domains/redis/redis-result-budget.cjs'],
  ['electron/redis-session-registry', 'electron/domains/redis/redis-session-registry.cjs'],
  ['electron/remote-file-service', 'electron/domains/remote-files/remote-file-service.cjs'],
  ['electron/remote-file-store', 'electron/infrastructure/remote/remote-file-store.adapter.cjs'],
  ['electron/renderer-recovery-controller', 'electron/app/renderer-recovery-controller.cjs'],
  ['electron/shell-session-manager', 'electron/domains/shell/shell-session-manager.cjs'],
  ['electron/shell-session-error-event', 'electron/domains/shell/shell-session-error-event.cjs'],
  ['electron/sftp-service', 'electron/infrastructure/remote/sftp-service.adapter.cjs'],
  ['electron/sqlite-database-worker', 'electron/infrastructure/database/sqlite-database-worker.cjs'],
  ['electron/sqlite-worker-session', 'electron/infrastructure/database/sqlite-worker-session.adapter.cjs'],
  ['electron/system-skills', 'electron/domains/ai/system-skills.cjs'],
  ['electron/skill-validation', 'electron/domains/ai/skill-validation.cjs'],
  ['electron/pi-package-skills', 'electron/domains/ai/pi-package-skills.cjs'],
  ['electron/pi-executable', 'electron/infrastructure/processes/pi-executable.adapter.cjs'],
  ['electron/domains/ai/pi-executable', 'electron/infrastructure/processes/pi-executable.adapter.cjs'],
  ['electron/pi-session-controller', 'electron/domains/ai/pi-session-controller.cjs'],
  ['electron/pi-system-service', 'electron/domains/ai/pi-system-service.cjs'],
  ['electron/pty-lifecycle', 'electron/domains/terminal/pty-lifecycle.cjs'],
  ['electron/pty-runtime', 'electron/infrastructure/processes/pty-runtime.adapter.cjs'],
  ['electron/reliability-fault-injection', 'electron/app/reliability-fault-injection.cjs'],
  ['electron/runtime-capabilities', 'electron/infrastructure/system/runtime-capabilities.adapter.cjs'],
  ['electron/startup-bootstrap-guard', 'electron/app/startup-bootstrap-guard.cjs'],
  ['electron/terminal-attachments', 'electron/infrastructure/filesystem/terminal-attachment.adapter.cjs'],
  ['electron/domains/ai/terminal-attachments', 'electron/infrastructure/filesystem/terminal-attachment.adapter.cjs'],
  ['electron/terminal-diagnostics', 'electron/domains/terminal/terminal-diagnostics.cjs'],
  ['electron/terminal-history-buffer', 'electron/domains/terminal/terminal-history-buffer.cjs'],
  ['electron/terminal-input', 'electron/domains/terminal/terminal-input.cjs'],
  ['electron/terminal-stream-controller', 'electron/domains/terminal/terminal-stream-controller.cjs'],
  ['electron/window-close-coordinator', 'electron/app/window-close-coordinator.cjs'],
  ['electron/workspace-reveal', 'electron/domains/workspace/workspace-reveal.cjs'],
  ['electron/volatile-draft-registry', 'electron/domains/workspace/volatile-draft-registry.cjs'],
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
  return file === 'electron/main.cjs' || file === 'electron/app/bootstrap.cjs'
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

  if (importer.startsWith('electron/app/') && !isElectronCompositionRoot(importer) && /^(?:electron\/(?:infrastructure|ipc|preload)\/)/u.test(imported) && imported !== ipcChannelRegistryFile) {
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

  if (!isElectronCompositionRoot(importer) && isElectronCompositionRoot(imported)) {
    problems.push(`modulo interno dipende dalla composition root Electron (${imported})`)
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
    const removedOwner = removedLegacyModules.get(extensionlessFile(file))
    if (removedOwner) problems.push(`${file}: path legacy rimosso ricreato; usa "${removedOwner}"`)
    const source = readFileSync(absoluteFile, 'utf8')
    const sourceFile = sourceFileFor(file, source)
    const dependencies = []

    for (const problem of ipcChannelLiteralProblems(file, sourceFile)) problems.push(`${file}: ${problem}`)

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
      const legacyMaximum = legacyDirectBridgeFiles.get(file)
      if (directAccesses > 0 && legacyMaximum === undefined) {
        problems.push(`${file}: ${directAccesses} accessi diretti a window.vincodeLab fuori da src/bridge`)
      } else if (legacyMaximum !== undefined && directAccesses !== legacyMaximum) {
        problems.push(`${file}: accessi diretti al bridge ${directAccesses}, soglia legacy attesa ${legacyMaximum}; aggiorna intenzionalmente il ratchet`)
      }
    }

    for (const specifier of moduleSpecifiers(sourceFile)) {
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

  for (const cycle of findCycles(graph)) problems.push(`ciclo di dipendenze: ${cycle.join(' → ')}`)
  return problems.sort()
}

export function formatArchitectureCheck(problems) {
  if (problems.length === 0) return 'Architettura verificata: confini, bridge e dipendenze sono coerenti.'
  return ['Controllo architetturale non superato:', ...problems.map((problem) => `- ${problem}`)].join('\n')
}
