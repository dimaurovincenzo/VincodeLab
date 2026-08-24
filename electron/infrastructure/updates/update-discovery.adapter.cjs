const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { listPiPackageRecords } = require('../../domains/ai/pi-system-service.cjs')
const { upsertManagedUpdate } = require('../persistence/update.repository.cjs')

const execFileAsync = promisify(execFile)
const GITHUB_SOURCE = /^git:github\.com\/([A-Za-z0-9_.-]{1,128})\/([A-Za-z0-9_.-]{1,128}?)(?:\.git)?(?:@([^\s]{1,256}))?$/
const COMMIT = /^[0-9a-f]{7,64}$/i

function parseGitHubPackageSource(source) {
  if (typeof source !== 'string') return null
  const match = source.match(GITHUB_SOURCE)
  return match ? { owner: match[1], repository: match[2], ref: match[3] ?? null } : null
}

async function defaultReadGit(root, args) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { timeout: 10_000, maxBuffer: 16 * 1024, windowsHide: true })
  return stdout.trim()
}

function defaultReadPackage(root) {
  const manifest = path.join(root, 'package.json')
  const stats = fs.lstatSync(manifest)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Manifesto pacchetto Pi non valido.')
  return JSON.parse(fs.readFileSync(manifest, 'utf8'))
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

async function discoverManagedPiPackages(records, allowedRoot, dependencies = {}) {
  const realpath = dependencies.realpath ?? fs.realpathSync
  const readPackage = dependencies.readPackage ?? defaultReadPackage
  const readGit = dependencies.readGit ?? defaultReadGit
  const trustedRoot = realpath(allowedRoot)
  const discovered = []
  for (const record of records) {
    const source = parseGitHubPackageSource(record?.source)
    if (!source) continue
    try {
      const targetPath = realpath(record.root)
      if (!isInside(trustedRoot, targetPath)) continue
      const metadata = readPackage(targetPath)
      if (!metadata || typeof metadata.name !== 'string' || !metadata.name.trim()) continue
      const activeVersion = await readGit(targetPath, ['rev-parse', 'HEAD'])
      if (!COMMIT.test(activeVersion)) continue
      const ref = source.ref ?? await readGit(targetPath, ['symbolic-ref', '--short', 'HEAD'])
      if (!ref || [...ref].some((character) => character.charCodeAt(0) <= 32) || ref.length > 256) continue
      discovered.push({
        id: `pi-extension:${source.owner}/${source.repository}`,
        kind: 'pi-extension',
        name: metadata.name.trim(),
        sourceType: 'github',
        sourceUrl: record.source,
        owner: source.owner,
        repository: source.repository,
        ref,
        channel: 'stable',
        activeVersion,
        targetPath,
      })
    } catch {
      // Un pacchetto non verificabile resta gestibile dal canale nativo Pi, senza bloccare gli altri.
    }
  }
  return discovered
}

async function reconcileManagedPiPackages(resolveExecutable, allowedRoot, dependencies = {}) {
  const records = await (dependencies.listRecords ?? listPiPackageRecords)(resolveExecutable, dependencies.run)
  const discovered = await discoverManagedPiPackages(records, allowedRoot, dependencies)
  return discovered.map((record) => (dependencies.upsert ?? upsertManagedUpdate)(record))
}

module.exports = { discoverManagedPiPackages, parseGitHubPackageSource, reconcileManagedPiPackages }
