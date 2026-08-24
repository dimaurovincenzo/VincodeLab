import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OFFLINE_CHROMIUM_FLAGS } from '../packaged-electron.mjs'

export const FAULT_RECOVERY_FILE_ID = 'README.md'

export const FAULT_RECOVERY_BASELINE = '# VincodeLab packaged smoke\n'

export async function createSmokeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vincodelab-packaged-smoke-'))
  try {
    const directories = {
      cache: path.join(root, 'cache'),
      data: path.join(root, 'data'),
      gh: path.join(root, 'gh'),
      home: path.join(root, 'home'),
      profile: path.join(root, 'profile'),
      systemBin: path.join(root, 'system-bin'),
      temp: path.join(root, 'tmp'),
      workspaceDirectory: path.join(root, 'workspace'),
    }
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
    await mkdir(path.join(directories.home, 'Library', 'Logs'), { recursive: true, mode: 0o700 })
    await writeFile(path.join(directories.workspaceDirectory, 'README.md'), '# VincodeLab packaged smoke\n', { mode: 0o600 })
    const fakePi = path.join(root, 'pi-offline-fixture')
    await writeFile(fakePi, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' 'pi-offline-smoke 1.0' ;;
  list) exit 0 ;;
  *) exit 64 ;;
esac
`, { mode: 0o700 })
    await chmod(fakePi, 0o700)
    return {
      root,
      ...directories,
      fakePi,
      workspace: await realpath(directories.workspaceDirectory),
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export async function cleanupSmokeFixture(fixture) {
  const resolvedRoot = path.resolve(fixture?.root ?? '')
  const temporaryRoot = path.resolve(os.tmpdir())
  const relative = path.relative(temporaryRoot, resolvedRoot)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(resolvedRoot).startsWith('vincodelab-packaged-smoke-')) {
    throw new Error('Cleanup smoke rifiutato: directory temporanea non riconosciuta.')
  }
  await rm(resolvedRoot, { recursive: true, force: true })
}

export function isolatedEnvironment(fixture, { withoutPi = false } = {}) {
  return {
    GH_CONFIG_DIR: fixture.gh,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: fixture.home,
    HTTPS_PROXY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    LANG: 'en_US.UTF-8',
    LOGNAME: 'vincodelab-smoke',
    NO_PROXY: '127.0.0.1,localhost',
    PATH: fixture.systemBin,
    SHELL: '/bin/sh',
    TMPDIR: fixture.temp,
    USER: 'vincodelab-smoke',
    VINCODELAB_DATA_DIR: fixture.data,
    VINCODELAB_LOGS_DIR: path.join(fixture.root, 'logs'),
    VINCODELAB_PI_PATH: withoutPi ? path.join(fixture.root, 'pi-not-installed') : fixture.fakePi,
    XDG_CACHE_HOME: fixture.cache,
    XDG_CONFIG_HOME: path.join(fixture.profile, 'config'),
    XDG_DATA_HOME: path.join(fixture.profile, 'share'),
  }
}

export function packagedElectronArguments({ faultRecovery = false, port, profile, withoutPi = false, workspace }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Porta DevTools non valida.')
  return [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--reliability-benchmark',
    ...(faultRecovery ? ['--reliability-fault-injection'] : []),
    ...(withoutPi ? ['--clean-machine-smoke'] : []),
    ...OFFLINE_CHROMIUM_FLAGS,
    '--workspace',
    workspace,
  ]
}
