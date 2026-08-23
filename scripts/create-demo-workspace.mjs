#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { appendFile, cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEMO_TEMPLATE_ROOT = path.join(PROJECT_ROOT, 'examples', 'demo-workspace')
export const DEMO_MARKER_FILENAME = '.vincodelab-demo-workspace.json'
export const DEMO_TEMPLATE_FILES = Object.freeze([
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'data/schema.sql',
  'docs/product-notes.md',
  'package-lock.json',
  'package.json',
  'src/dashboard.ts',
  'src/theme.ts',
  'tests/dashboard.test.ts',
  'tsconfig.json',
])
export const DEFAULT_DEMO_WORKSPACE = path.join(os.tmpdir(), 'VincodeLab-Demo')
const MARKER = Object.freeze({ kind: 'vincodelab-demo-workspace', version: 1 })

function usage() {
  return [
    'Uso: node scripts/create-demo-workspace.mjs [opzioni]',
    '',
    'Opzioni:',
    `  --output <cartella>  Destinazione (default: ${DEFAULT_DEMO_WORKSPACE})`,
    '  --force              Rigenera soltanto una precedente workspace demo riconosciuta',
    '  --no-git             Non inizializza la fixture Git locale',
    '  --json               Output JSON compatto',
    '  --help               Mostra questo messaggio',
    '',
    'Lo script usa esclusivamente file locali e non contatta servizi esterni.',
  ].join('\n')
}

export function parseArguments(argumentsList) {
  const options = { force: false, help: false, initializeGit: true, json: false, outputPath: DEFAULT_DEMO_WORKSPACE }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--output') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --output mancante.')
      options.outputPath = path.resolve(value)
    } else if (argument === '--force') options.force = true
    else if (argument === '--no-git') options.initializeGit = false
    else if (argument === '--json') options.json = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  return options
}

async function exists(candidate) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertSafeDestination(outputPath) {
  const resolved = path.resolve(outputPath)
  const filesystemRoot = path.parse(resolved).root
  const protectedPaths = new Set([
    filesystemRoot,
    path.resolve(os.homedir()),
    PROJECT_ROOT,
    DEMO_TEMPLATE_ROOT,
  ])
  if (protectedPaths.has(resolved) || resolved.length <= filesystemRoot.length) {
    throw new Error(`Destinazione demo non sicura: ${resolved}`)
  }
  return resolved
}

async function removePreviousDemo(outputPath) {
  const outputStats = await lstat(outputPath)
  if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) throw new Error('La destinazione esistente non e una workspace demo regolare.')
  let marker
  try {
    marker = JSON.parse(await readFile(path.join(outputPath, DEMO_MARKER_FILENAME), 'utf8'))
  } catch {
    throw new Error('La destinazione esistente non contiene il marker VincodeLab: rimozione rifiutata.')
  }
  if (marker?.kind !== MARKER.kind || marker?.version !== MARKER.version) {
    throw new Error('La destinazione esistente non e una workspace demo compatibile: rimozione rifiutata.')
  }
  await rm(outputPath, { recursive: true, force: false })
}

function run(command, args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} e terminato con codice ${code}: ${stderr.trim() || stdout.trim()}`))
    })
  })
}

async function createDemoDatabase(outputPath) {
  const databasePath = path.join(outputPath, 'data', 'orbit-metrics.sqlite')
  const schema = await readFile(path.join(outputPath, 'data', 'schema.sql'), 'utf8')
  const database = new Database(databasePath)
  try {
    database.pragma('journal_mode = DELETE')
    database.exec(schema)
    const insertService = database.prepare('INSERT INTO services (id, name, environment, availability, latency_ms, status) VALUES (?, ?, ?, ?, ?, ?)')
    const insertRelease = database.prepare('INSERT INTO releases (id, version, released_at, owner) VALUES (?, ?, ?, ?)')
    database.transaction(() => {
      insertService.run(1, 'API Gateway', 'Production', 99.98, 82, 'Operational')
      insertService.run(2, 'Background Jobs', 'Production', 99.91, 146, 'Operational')
      insertService.run(3, 'Search Index', 'Staging', 99.96, 64, 'Monitoring')
      insertRelease.run(1, '1.8.0', '2026-08-18', 'Platform')
      insertRelease.run(2, '1.9.0-rc.1', '2026-08-22', 'Experience')
    })()
    database.pragma('user_version = 1')
  } finally {
    database.close()
  }
  return databasePath
}

async function initializeDemoRepository(outputPath) {
  const isolatedGitEnvironment = {
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: outputPath,
    XDG_CONFIG_HOME: path.join(outputPath, '.vincodelab-git-config'),
  }
  const git = (args, options = {}) => {
    const { env = {}, ...runOptions } = options
    return run('git', [
      '-c', 'core.autocrlf=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'user.name=VincodeLab Demo',
      '-c', 'user.email=demo@vincodelab.local',
      '-c', 'commit.gpgsign=false',
      ...args,
    ], {
      cwd: outputPath,
      ...runOptions,
      env: { ...isolatedGitEnvironment, ...env },
    })
  }
  await git(['init', '--initial-branch=main'])
  await git(['add', '--all'])
  const fixedDate = '2026-08-20T10:00:00+02:00'
  await git(['commit', '-m', 'feat: create Orbit Metrics dashboard'], {
    env: {
      GIT_AUTHOR_DATE: fixedDate,
      GIT_COMMITTER_DATE: fixedDate,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  })

  await appendFile(path.join(outputPath, 'src', 'dashboard.ts'), [
    '',
    'export const dashboardFilters = [\'Production\', \'Staging\'] as const',
    '',
  ].join('\n'))
  await mkdir(path.join(outputPath, 'notes'), { recursive: true })
  await writeFile(path.join(outputPath, 'notes', 'release-checklist.md'), [
    '# Release checklist',
    '',
    '- [x] Verify local metrics',
    '- [x] Review keyboard navigation',
    '- [ ] Publish the release candidate',
    '',
  ].join('\n'))
}

async function copyDemoTemplate(outputPath) {
  await mkdir(outputPath, { mode: 0o700 })
  for (const relativePath of DEMO_TEMPLATE_FILES) {
    const sourcePath = path.join(DEMO_TEMPLATE_ROOT, relativePath)
    const sourceStats = await lstat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      throw new Error(`File template demo non valido: ${relativePath}`)
    }
    const destinationPath = path.join(outputPath, relativePath)
    await mkdir(path.dirname(destinationPath), { recursive: true })
    await cp(sourcePath, destinationPath, { errorOnExist: true, force: false })
  }
}

export async function createDemoWorkspace({
  force = false,
  initializeGit = true,
  outputPath = DEFAULT_DEMO_WORKSPACE,
} = {}) {
  outputPath = assertSafeDestination(outputPath)
  const templateStats = await stat(DEMO_TEMPLATE_ROOT)
  if (!templateStats.isDirectory()) throw new Error(`Template demo non disponibile: ${DEMO_TEMPLATE_ROOT}`)

  if (await exists(outputPath)) {
    if (!force) throw new Error(`La destinazione esiste gia: ${outputPath}. Usa --force soltanto per rigenerare una demo riconosciuta.`)
    await removePreviousDemo(outputPath)
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await copyDemoTemplate(outputPath)
  await writeFile(path.join(outputPath, DEMO_MARKER_FILENAME), `${JSON.stringify(MARKER, null, 2)}\n`)
  const databasePath = await createDemoDatabase(outputPath)
  if (initializeGit) await initializeDemoRepository(outputPath)

  return {
    databasePath: await realpath(databasePath),
    git: initializeGit,
    workspacePath: await realpath(outputPath),
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const result = await createDemoWorkspace(options)
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[create-demo-workspace] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
