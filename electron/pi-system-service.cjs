const { execFile } = require('node:child_process')
const { listPiPackageSkills: discoverPiPackageSkills, parsePiPackageList } = require('./pi-package-skills.cjs')
const { environmentForPi } = require('./pi-executable.cjs')

const MAX_SOURCE_LENGTH = 2048

function assertPackageSource(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE_LENGTH || [...source].some((character) => character.charCodeAt(0) < 32)) throw new Error('Sorgente estensione non valida.')
  return source.trim()
}

function defaultRun(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { env: environmentForPi(executable), timeout: 30000, maxBuffer: 1048576, windowsHide: true }, (error, stdout, stderr) => {
      if (error) { reject(new Error('Il comando Pi non è riuscito.')); return }
      resolve({ stdout, stderr })
    })
  })
}

function resolveOrThrow(resolveExecutable) { const executable = resolveExecutable(); if (!executable) throw new Error('Pi non è stato trovato.'); return executable }
function normalizeResult(result) { return { output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() } }
async function getPiSystemStatus(resolveExecutable, run = defaultRun) { const executable = resolveOrThrow(resolveExecutable); const result = await run(executable, ['--version']); return { executable, version: result.stdout.trim() } }
async function listPiPackageRecords(resolveExecutable, run = defaultRun) { const result = await run(resolveOrThrow(resolveExecutable), ['list']); return parsePiPackageList(result.stdout) }
async function listPiPackages(resolveExecutable, run = defaultRun) { return (await listPiPackageRecords(resolveExecutable, run)).map((item) => item.source) }
async function listPiPackageSkills(resolveExecutable, run = defaultRun) { return discoverPiPackageSkills(await listPiPackageRecords(resolveExecutable, run)) }
async function runPackageCommand(command, source, resolveExecutable, run = defaultRun) { const value = assertPackageSource(source); return normalizeResult(await run(resolveOrThrow(resolveExecutable), [command, value])) }
function installPiPackage(source, resolveExecutable, run) { return runPackageCommand('install', source, resolveExecutable, run) }
function updatePiPackage(source, resolveExecutable, run) { return runPackageCommand('update', source, resolveExecutable, run) }
function removePiPackage(source, resolveExecutable, run) { return runPackageCommand('remove', source, resolveExecutable, run) }

module.exports = { getPiSystemStatus, installPiPackage, listPiPackageRecords, listPiPackageSkills, listPiPackages, removePiPackage, updatePiPackage }
