import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

import * as profile from '../scripts/profile-memory-cpu.mjs'
import * as fixture from '../scripts/lib/memory-cpu-profile/fixture.mjs'
import * as measurementReport from '../scripts/lib/memory-cpu-profile/measurement-report.mjs'
import * as rendererHarness from '../scripts/lib/memory-cpu-profile/renderer-harness.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const profileEntry = 'scripts/profile-memory-cpu.mjs'
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
const moduleDeclarations = Object.freeze({
  'scripts/lib/memory-cpu-profile/fixture.mjs': {
    digest: '214e86d28517a1d0b530c910e5773e3f58a12c8206c623679daa7cc36cfa0972',
    names: [
      'MEMORY_CPU_PROFILE_OFFLINE_FLAGS',
      'PRIVATE_ENVIRONMENT_KEYS',
      'isolatedMemoryCpuProfileEnvironment',
      'cleanupMemoryCpuProfileFixture',
      'prepareFixture',
    ],
  },
  'scripts/lib/memory-cpu-profile/renderer-harness.mjs': {
    digest: '42fa4000b1ea50edb4d8b30f0dd0f7263fc7dd95583753e69efae68492d62b05',
    names: ['HARNESS_NAME', 'rendererHarnessSource'],
  },
  'scripts/lib/memory-cpu-profile/measurement-report.mjs': {
    digest: 'f91d677b60abd5a9b521ec2694924b5748797fdc6adcf9fcd77ac01591c342e5',
    names: [
      'round',
      'performanceMetric',
      'readProcessTable',
      'summarizeProcesses',
      'processTreeMetrics',
      'knownProcessMetrics',
      'eventListenerInventory',
      'collectEventListenerInventory',
      'collectCheckpoint',
      'checkpointTrend',
      'blockGrowthComparison',
      'summarizeRun',
      'median',
      'summarizeReport',
      'expectedOperationCounts',
      'evaluateMemoryCpuProfileRunContract',
      'serializeMemoryCpuProfileReport',
      'summarizeSubsystemDiagnostics',
      'benchmarkTraces',
    ],
  },
})
const rootLifecycleDeclarations = Object.freeze({
  digest: '0d39320818514d067d31160e0ab34b7bf4e216121f47cd6fa55539939f2fd165',
  names: [
    'parseMemoryCpuProfileArguments',
    'withTimeout',
    'reservePort',
    'waitForDebugger',
    'createCdpClient',
    'terminateChild',
    'runOnce',
    'candidateMetadata',
    'runMemoryCpuProfile',
    'main',
  ],
})

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function declarationsByName(relativePath) {
  const sourceFile = ts.createSourceFile(relativePath, readSource(relativePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = new Map()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, { kind: 'function', node: statement, sourceFile })
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, { kind: 'variable', node: declaration, sourceFile })
    }
  }
  return declarations
}

function declarationDigest(relativePath, names) {
  const declarations = declarationsByName(relativePath)
  const canonical = names.map((name) => {
    const declaration = declarations.get(name)
    assert.ok(declaration, `${name} non trovato in ${relativePath}`)
    let printed = printer.printNode(ts.EmitHint.Unspecified, declaration.node, declaration.sourceFile)
    if (declaration.kind === 'function') printed = printed.replace(/^export\s+/u, '')
    // La fixture si trova due directory più in profondità dell'entrypoint: il
    // digest normalizza solo questo adattamento necessario dei require CJS.
    printed = printed.replaceAll('../../../electron/', '../electron/')
    return `${name}=${printed}`
  }).join('\n')
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function walkModuleFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) return walkModuleFiles(candidate)
    return entry.isFile() && entry.name.endsWith('.mjs') ? [candidate] : []
  })
}

test('i moduli del profiler conservano le dichiarazioni caratterizzate', () => {
  for (const [relativePath, { digest, names }] of Object.entries(moduleDeclarations)) {
    assert.equal(declarationDigest(relativePath, names), digest, relativePath)
  }
})

test('il root conserva invariati CLI, CDP e lifecycle ordinato di runOnce', () => {
  assert.equal(declarationDigest(profileEntry, rootLifecycleDeclarations.names), rootLifecycleDeclarations.digest)
  const rootDeclarations = declarationsByName(profileEntry)
  for (const { names } of Object.values(moduleDeclarations)) {
    for (const name of names) assert.equal(rootDeclarations.has(name), false, `${name} non deve tornare nel root`)
  }

  const rootSource = readSource(profileEntry)
  for (const moduleName of ['fixture', 'measurement-report', 'renderer-harness']) {
    assert.match(rootSource, new RegExp(`from './lib/memory-cpu-profile/${moduleName}\\.mjs'`, 'u'))
  }
  assert.match(
    rootSource,
    /import\s*\{[\s\S]*?\bround\b[\s\S]*?\}\s*from '\.\/lib\/memory-cpu-profile\/measurement-report\.mjs'/u,
    'runOnce deve importare il formatter numerico usato per le metriche CPU',
  )
})

test('l entrypoint preserva la API pubblica tramite gli owner coesi', () => {
  const publicBindings = [
    ['MEMORY_CPU_PROFILE_OFFLINE_FLAGS', profile.MEMORY_CPU_PROFILE_OFFLINE_FLAGS, fixture.MEMORY_CPU_PROFILE_OFFLINE_FLAGS],
    ['cleanupMemoryCpuProfileFixture', profile.cleanupMemoryCpuProfileFixture, fixture.cleanupMemoryCpuProfileFixture],
    ['evaluateMemoryCpuProfileRunContract', profile.evaluateMemoryCpuProfileRunContract, measurementReport.evaluateMemoryCpuProfileRunContract],
    ['isolatedMemoryCpuProfileEnvironment', profile.isolatedMemoryCpuProfileEnvironment, fixture.isolatedMemoryCpuProfileEnvironment],
    ['rendererHarnessSource', profile.rendererHarnessSource, rendererHarness.rendererHarnessSource],
    ['serializeMemoryCpuProfileReport', profile.serializeMemoryCpuProfileReport, measurementReport.serializeMemoryCpuProfileReport],
  ]
  for (const [name, entryBinding, ownerBinding] of publicBindings) assert.equal(entryBinding, ownerBinding, name)
  assert.equal('HARNESS_NAME' in profile, false)
  assert.equal('prepareFixture' in profile, false)
  assert.equal('collectCheckpoint' in profile, false)
  assert.equal('summarizeRun' in profile, false)
  assert.throws(
    () => profile.serializeMemoryCpuProfileReport({ localPath: projectRoot }),
    /percorso locale non consentito/u,
  )
})

test('i moduli memory-cpu-profile restano privati all entrypoint operativo', () => {
  const scriptsRoot = path.join(projectRoot, 'scripts')
  const internalRoot = path.join(scriptsRoot, 'lib', 'memory-cpu-profile')
  for (const absoluteFile of walkModuleFiles(scriptsRoot)) {
    if (absoluteFile === path.join(projectRoot, profileEntry) || absoluteFile.startsWith(`${internalRoot}${path.sep}`)) continue
    assert.doesNotMatch(fs.readFileSync(absoluteFile, 'utf8'), /(?:\/|\.)memory-cpu-profile\//u, path.relative(projectRoot, absoluteFile))
  }
})

test('la fixture relocata prepara SQLite e workspace esclusivamente nella directory temporanea', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-memory-cpu-module-'))
  const dataDirectory = path.join(root, 'data')
  fs.mkdirSync(dataDirectory)
  try {
    const prepared = await fixture.prepareFixture(root, dataDirectory)
    assert.ok(prepared.workspace.startsWith(`${fs.realpathSync(root)}${path.sep}`))
    assert.equal(fs.readFileSync(path.join(prepared.workspace, 'README.md'), 'utf8'), '# Profilo memoria e CPU\n')
    assert.ok((fs.statSync(prepared.fakePi).mode & 0o111) !== 0)
  } finally {
    await fixture.cleanupMemoryCpuProfileFixture(root)
  }
  assert.equal(fs.existsSync(root), false)
})
