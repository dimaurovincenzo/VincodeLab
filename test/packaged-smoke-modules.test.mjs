import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

import * as smoke from '../scripts/smoke-packaged-macos.mjs'
import * as baselineScenarios from '../scripts/lib/packaged-smoke/baseline-scenarios.mjs'
import * as faultEvidence from '../scripts/lib/packaged-smoke/fault-evidence.mjs'
import * as faultScenarios from '../scripts/lib/packaged-smoke/fault-scenarios.mjs'
import * as fixture from '../scripts/lib/packaged-smoke/fixture.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const smokeEntry = 'scripts/smoke-packaged-macos.mjs'
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
const moduleDeclarations = Object.freeze({
  'scripts/lib/packaged-smoke/fixture.mjs': {
    digest: '347440fefb0b85498a487555ba58eecb6bd6ef597f2f02b280cb2ebed502b25c',
    names: [
      'FAULT_RECOVERY_FILE_ID',
      'FAULT_RECOVERY_BASELINE',
      'createSmokeFixture',
      'cleanupSmokeFixture',
      'isolatedEnvironment',
      'packagedElectronArguments',
    ],
  },
  'scripts/lib/packaged-smoke/baseline-scenarios.mjs': {
    digest: '14b0efd2ecb2f600be27bf57b23e8ede22c36ae85cf056677732de14c173a8ee',
    names: [
      'rendererSmokeScenario',
      'verifyRedisSelectScenario',
      'verifyCleanMachineScenario',
    ],
  },
  'scripts/lib/packaged-smoke/fault-scenarios.mjs': {
    digest: '774e90bc2b6fa2f3d5f818b886b9e6ed9bbf5b460160a30d013cafc2ee974475',
    names: [
      'PACKAGED_DOMAIN_FAULTS',
      'exerciseIpcRejectionScenario',
      'exerciseDomainFailureScenarios',
      'armPersistenceCorruptionScenario',
      'verifyPersistenceRecoveryScenario',
      'prepareFaultRecoveryScenario',
      'visibleCodeMirrorTextMarker',
      'confirmFaultRecoveryDraftScenario',
      'exerciseReactViewCrashScenario',
      'verifyFaultRecoveryScenario',
    ],
  },
  'scripts/lib/packaged-smoke/fault-evidence.mjs': {
    digest: 'a2ce656160e4ee4213e585a7ccd0b48e656b4a981defe64ce927817b268822a8',
    names: [
      'MAX_FAULT_LOG_BYTES',
      'readFixtureAppLogs',
      'verifyFaultLogEvidence',
    ],
  },
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

test('i moduli smoke conservano integralmente le dichiarazioni caratterizzate', () => {
  for (const [relativePath, { digest, names }] of Object.entries(moduleDeclarations)) {
    assert.equal(declarationDigest(relativePath, names), digest, relativePath)
  }
})

test('lo smoke root resta owner di orchestrazione e lifecycle, non degli scenari', () => {
  const rootDeclarations = declarationsByName(smokeEntry)
  for (const name of ['runPackagedSmoke', 'createCdpClient', 'reconnectAfterRendererCrash', 'shutdownChild']) {
    assert.ok(rootDeclarations.has(name), `${name} deve restare nello smoke root`)
  }
  for (const { names } of Object.values(moduleDeclarations)) {
    for (const name of names) assert.equal(rootDeclarations.has(name), false, `${name} non deve tornare nello smoke root`)
  }

  const rootSource = readSource(smokeEntry)
  for (const moduleName of ['baseline-scenarios', 'fault-evidence', 'fault-scenarios', 'fixture']) {
    assert.match(rootSource, new RegExp(`from './lib/packaged-smoke/${moduleName}\\.mjs'`, 'u'))
  }
})

test('lo smoke preserva la API pubblica tramite gli owner coesi', () => {
  const publicBindings = [
    ['PACKAGED_DOMAIN_FAULTS', smoke.PACKAGED_DOMAIN_FAULTS, faultScenarios.PACKAGED_DOMAIN_FAULTS],
    ['armPersistenceCorruptionScenario', smoke.armPersistenceCorruptionScenario, faultScenarios.armPersistenceCorruptionScenario],
    ['cleanupSmokeFixture', smoke.cleanupSmokeFixture, fixture.cleanupSmokeFixture],
    ['confirmFaultRecoveryDraftScenario', smoke.confirmFaultRecoveryDraftScenario, faultScenarios.confirmFaultRecoveryDraftScenario],
    ['createSmokeFixture', smoke.createSmokeFixture, fixture.createSmokeFixture],
    ['exerciseDomainFailureScenarios', smoke.exerciseDomainFailureScenarios, faultScenarios.exerciseDomainFailureScenarios],
    ['exerciseIpcRejectionScenario', smoke.exerciseIpcRejectionScenario, faultScenarios.exerciseIpcRejectionScenario],
    ['exerciseReactViewCrashScenario', smoke.exerciseReactViewCrashScenario, faultScenarios.exerciseReactViewCrashScenario],
    ['isolatedEnvironment', smoke.isolatedEnvironment, fixture.isolatedEnvironment],
    ['packagedElectronArguments', smoke.packagedElectronArguments, fixture.packagedElectronArguments],
    ['prepareFaultRecoveryScenario', smoke.prepareFaultRecoveryScenario, faultScenarios.prepareFaultRecoveryScenario],
    ['verifyCleanMachineScenario', smoke.verifyCleanMachineScenario, baselineScenarios.verifyCleanMachineScenario],
    ['verifyFaultLogEvidence', smoke.verifyFaultLogEvidence, faultEvidence.verifyFaultLogEvidence],
    ['verifyFaultRecoveryScenario', smoke.verifyFaultRecoveryScenario, faultScenarios.verifyFaultRecoveryScenario],
    ['verifyPersistenceRecoveryScenario', smoke.verifyPersistenceRecoveryScenario, faultScenarios.verifyPersistenceRecoveryScenario],
    ['verifyRedisSelectScenario', smoke.verifyRedisSelectScenario, baselineScenarios.verifyRedisSelectScenario],
    ['visibleCodeMirrorTextMarker', smoke.visibleCodeMirrorTextMarker, faultScenarios.visibleCodeMirrorTextMarker],
  ]
  for (const [name, reexportedBinding, ownerBinding] of publicBindings) assert.equal(reexportedBinding, ownerBinding, name)
  assert.equal('rendererSmokeScenario' in smoke, false)
  assert.equal('readFixtureAppLogs' in smoke, false)
  assert.equal('FAULT_RECOVERY_FILE_ID' in smoke, false)
})

test('i moduli interni packaged-smoke non diventano ingressi alternativi degli script', () => {
  const scriptsRoot = path.join(projectRoot, 'scripts')
  const internalRoot = path.join(scriptsRoot, 'lib', 'packaged-smoke')
  for (const absoluteFile of walkModuleFiles(scriptsRoot)) {
    if (absoluteFile === path.join(projectRoot, smokeEntry) || absoluteFile.startsWith(`${internalRoot}${path.sep}`)) continue
    assert.doesNotMatch(fs.readFileSync(absoluteFile, 'utf8'), /(?:\/|\.)packaged-smoke\//u, path.relative(projectRoot, absoluteFile))
  }
})
