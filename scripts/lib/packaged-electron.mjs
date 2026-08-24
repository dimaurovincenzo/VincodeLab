import { spawn } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PRODUCT_NAME = 'VincodeLab'

export const OFFLINE_CHROMIUM_FLAGS = Object.freeze([
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-pings',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=localhost;127.0.0.1',
])

async function regularFile(filePath, { executable = false, nonempty = false } = {}) {
  const stats = await lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`File bundle non sicuro: ${filePath}`)
  if (nonempty && stats.size === 0) throw new Error(`File bundle vuoto: ${filePath}`)
  if (executable && (stats.mode & 0o111) === 0) throw new Error(`File bundle non eseguibile: ${filePath}`)
  return filePath
}

function architectureName(architecture) {
  if (architecture === 'arm64') return 'arm64'
  if (architecture === 'x64') return 'x86_64'
  throw new Error(`Architettura macOS non supportata dallo smoke: ${architecture}`)
}

async function inspectArchitecturesWithFile(filePath) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/file', ['-b', filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `/usr/bin/file è terminato con codice ${code}.`)))
  })
  const architectures = new Set()
  if (/\barm64\b/u.test(output)) architectures.add('arm64')
  if (/\bx86_64\b/u.test(output)) architectures.add('x86_64')
  return architectures
}

async function firstRegularFile(candidates, options) {
  for (const candidate of candidates) {
    try {
      return await regularFile(candidate, options)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`File nativo mancante; percorsi controllati: ${candidates.join(', ')}`)
}

export async function validatePackagedApp(appPath, {
  architecture = process.arch,
  inspectArchitectures = inspectArchitecturesWithFile,
} = {}) {
  const resolvedApp = path.resolve(appPath)
  if (path.extname(resolvedApp) !== '.app') throw new Error('Il percorso deve indicare un bundle .app macOS.')
  const appStats = await lstat(resolvedApp)
  if (!appStats.isDirectory() || appStats.isSymbolicLink()) throw new Error('Il bundle .app non è una directory regolare.')

  const expectedArchitecture = architectureName(architecture)
  const contents = path.join(resolvedApp, 'Contents')
  const executable = await regularFile(path.join(contents, 'MacOS', path.basename(resolvedApp, '.app')), { executable: true, nonempty: true })
  const resources = path.join(contents, 'Resources')
  await regularFile(path.join(resources, 'app.asar'), { nonempty: true })
  const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const nodePtyRoot = path.join(unpackedModules, 'node-pty')
  const ptyNative = await firstRegularFile([
    path.join(nodePtyRoot, 'build', 'Release', 'pty.node'),
    path.join(nodePtyRoot, 'prebuilds', `darwin-${architecture}`, 'pty.node'),
  ], { nonempty: true })
  const spawnHelper = await firstRegularFile([
    path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
    path.join(nodePtyRoot, 'prebuilds', `darwin-${architecture}`, 'spawn-helper'),
  ], { executable: true, nonempty: true })
  const betterSqlite3Native = await regularFile(
    path.join(unpackedModules, 'better-sqlite3', 'prebuilds', `darwin-${architecture}.node`),
    { nonempty: true },
  )

  for (const nativeFile of [executable, ptyNative, spawnHelper, betterSqlite3Native]) {
    const architectures = await inspectArchitectures(nativeFile)
    if (!architectures.has(expectedArchitecture)) {
      throw new Error(`Architettura ${expectedArchitecture} assente da ${nativeFile}.`)
    }
  }

  return {
    appPath: resolvedApp,
    executable,
    nativeModules: {
      betterSqlite3: betterSqlite3Native,
      nodePty: ptyNative,
      spawnHelper,
    },
  }
}

async function pathExists(candidate) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function resolvePackagedApp({ appPath = null, architecture = process.arch, projectRoot = PROJECT_ROOT } = {}) {
  if (appPath) return path.resolve(appPath)
  architectureName(architecture)
  const releaseRoot = path.join(projectRoot, 'release')
  const preferredDirectory = architecture === 'arm64' ? 'mac-arm64' : 'mac'
  const preferred = path.join(releaseRoot, preferredDirectory, `${PRODUCT_NAME}.app`)
  if (await pathExists(preferred)) return preferred

  let entries
  try {
    entries = await readdir(releaseRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Nessun artefatto macOS: crea il pacchetto separatamente prima dello smoke.')
    throw error
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue
    const candidate = path.join(releaseRoot, entry.name, `${PRODUCT_NAME}.app`)
    if (await pathExists(candidate)) candidates.push(candidate)
  }
  if (candidates.length === 0) throw new Error('Nessun bundle VincodeLab.app presente sotto release/mac*.')
  if (candidates.length > 1) throw new Error(`Più bundle disponibili; scegli esplicitamente con --app: ${candidates.join(', ')}`)
  return candidates[0]
}
