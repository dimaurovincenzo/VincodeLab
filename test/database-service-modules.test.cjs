const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const mainPath = require.resolve('../electron/main.cjs')
const runtimePath = require.resolve('../electron/domains/database/database-session-runtime.cjs')
const servicePath = require.resolve('../electron/domains/database/database-service.cjs')

test('Database espone una factory e il main compone una sola istanza', () => {
  const databaseModule = require(servicePath)
  const mainSource = readFileSync(mainPath, 'utf8')
  const serviceSource = readFileSync(servicePath, 'utf8')

  assert.equal(typeof databaseModule.createDatabaseService, 'function')
  for (const forbiddenExport of [
    'beginTransaction',
    'closeConnectionSession',
    'closeWorkspaceSessions',
    'configureDatabasePersistence',
    'configureDatabaseRuntime',
    'defaultService',
    'executeQuery',
    'inspectSchema',
    'openConnection',
  ]) {
    assert.equal(forbiddenExport in databaseModule, false, `${forbiddenExport} non deve essere un singleton esportato`)
  }

  assert.equal((mainSource.match(/\bcreateDatabaseService\(\{/gu) ?? []).length, 1)
  assert.match(mainSource, /createDatabaseService\(\{[\s\S]*?createSqliteWorkerSession:[\s\S]*?driverPort: nodeDatabaseDriverAdapter,[\s\S]*?getConnectionWithSecrets,[\s\S]*?recordHistory,[\s\S]*?sqliteWorkerDiagnostics,[\s\S]*?\}\)/u)
  assert.doesNotMatch(mainSource, /\b(?:configureDatabasePersistence|configureDatabaseRuntime)\b/u)
  assert.doesNotMatch(serviceSource, /\b(?:databasePersistence|defaultService|configureDatabasePersistence|configureDatabaseRuntime)\b/u)
  assert.doesNotMatch(serviceSource, /^const schemaCache\s*=\s*new Map\(\)/mu)
})

test('il runtime Database è constructor-only e possiede i registri per istanza', () => {
  const runtimeSource = readFileSync(runtimePath, 'utf8')
  const runtimeModule = require(runtimePath)

  assert.deepEqual(Object.keys(runtimeModule), ['createDatabaseSessionRuntime'])
  assert.doesNotMatch(runtimeSource, /\bconfigureRuntime\b/u)
  assert.doesNotMatch(runtimeSource, /^const (?:remoteSessions|sqliteSessions)\s*=\s*/mu)
  assert.match(runtimeSource, /function createDatabaseSessionRuntime\(\{[\s\S]*?createSqliteWorkerSession,[\s\S]*?driverPort,[\s\S]*?getConnectionWithSecrets,[\s\S]*?sqliteWorkerDiagnostics,/u)
})
