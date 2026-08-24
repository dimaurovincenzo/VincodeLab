import { chmod, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const MEMORY_CPU_PROFILE_OFFLINE_FLAGS = Object.freeze([
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
])

const PRIVATE_ENVIRONMENT_KEYS = Object.freeze([
  'AWS_ACCESS_KEY_ID',
  'AWS_PROFILE',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'DATABASE_URL',
  'GH_ENTERPRISE_TOKEN',
  'GH_HOST',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
  'VITE_DEV_SERVER_URL',
])

export function isolatedMemoryCpuProfileEnvironment(baseEnvironment, fixture) {
  const environment = {
    ...baseEnvironment,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    HOME: fixture.homeDirectory,
    USERPROFILE: fixture.homeDirectory,
    VINCODELAB_DATA_DIR: fixture.dataDirectory,
    VINCODELAB_PI_PATH: fixture.fakePi,
    XDG_CACHE_HOME: fixture.cacheDirectory,
    XDG_CONFIG_HOME: fixture.configDirectory,
  }
  for (const key of PRIVATE_ENVIRONMENT_KEYS) delete environment[key]
  return environment
}

export async function cleanupMemoryCpuProfileFixture(root) {
  const resolvedRoot = path.resolve(root)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (!resolvedRoot.startsWith(`${temporaryRoot}${path.sep}`)
    || !path.basename(resolvedRoot).startsWith('vincodelab-memory-cpu-')) {
    throw new Error('Directory temporanea del profilo non valida.')
  }
  await rm(resolvedRoot, { recursive: true, force: true })
}

export async function prepareFixture(root, dataDirectory) {
  const workspaceDirectory = path.join(root, 'workspace')
  const sqlitePath = path.join(root, 'fixture.sqlite')
  const fakePi = path.join(root, 'pi-fixture')
  await mkdir(path.join(workspaceDirectory, 'src'), { recursive: true })
  await mkdir(path.join(workspaceDirectory, 'docs'), { recursive: true })
  const workspace = await realpath(workspaceDirectory)
  const files = [
    writeFile(path.join(workspace, 'README.md'), '# Profilo memoria e CPU\n'),
    writeFile(path.join(workspace, 'src', 'index.ts'), 'export const fixture = true\n'),
    ...Array.from({ length: 32 }, (_, index) => writeFile(
      path.join(workspace, 'docs', `fixture-${String(index).padStart(2, '0')}.md`),
      `# Fixture ${index}\n\nContenuto locale deterministico.\n`,
    )),
  ]
  await Promise.all(files)
  await writeFile(fakePi, '#!/bin/sh\nexit 0\n')
  await chmod(fakePi, 0o700)

  const previousDataDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  const { createConnection } = require('../../../electron/infrastructure/persistence/database.repository.cjs')
  const { closeDatabase } = require('../../../electron/infrastructure/persistence/workspace.repository.cjs')
  try {
    createConnection(workspace, { name: 'Profilo SQLite locale', driver: 'sqlite', sqlitePath })
  } finally {
    closeDatabase()
    if (previousDataDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDataDirectory
  }
  return { fakePi, workspace }
}
