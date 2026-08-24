import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

export async function createRuntimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vincodelab-screenshot-runtime-'))
  const directories = {
    cache: path.join(root, 'cache'),
    data: path.join(root, 'data'),
    gh: path.join(root, 'gh'),
    home: path.join(root, 'home'),
    profile: path.join(root, 'profile'),
    temp: path.join(root, 'tmp'),
  }
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
  await mkdir(path.join(directories.home, 'Library', 'Logs'), { recursive: true, mode: 0o700 })
  const fakePi = path.join(root, 'pi-demo-offline')
  await writeFile(fakePi, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' 'Pi Agent demo offline 1.0' ; exit 0 ;;
  list) exit 0 ;;
esac
printf '\\033[38;5;99m  PI AGENT · SESSIONE DEMO OFFLINE\\033[0m\\r\\n\\r\\n'
printf '  Analisi di \\033[1mOrbit Metrics\\033[0m completata.\\r\\n'
printf '  \\033[38;5;42m✓\\033[0m 3 servizi verificati\\r\\n'
printf '  \\033[38;5;42m✓\\033[0m test locali superati\\r\\n'
printf '  \\033[38;5;75m→\\033[0m Prossimo passo: prepara la release candidate\\r\\n\\r\\n'
printf '  Il workspace e pronto. Cosa vuoi fare?\\r\\n'
trap 'exit 0' TERM INT HUP
while :; do sleep 60; done
`, { mode: 0o700 })
  await chmod(fakePi, 0o700)
  const fakeShell = path.join(root, 'vincodelab-demo-shell')
  await writeFile(fakeShell, `#!/bin/sh
printf '\\033[38;5;75mvincodelab-demo\\033[0m \\033[38;5;99mOrbit-Metrics\\033[0m $ '
while IFS= read -r command; do
  case "$command" in
    *"npm run check"*)
      printf '\\r\\n  \\033[1mVINCODELAB DEMO WORKSPACE\\033[0m\\r\\n'
      printf '  \\033[38;5;42m✓\\033[0m TypeScript check passed\\r\\n'
      printf '  \\033[38;5;42m✓\\033[0m 1 test passed\\r\\n\\r\\n'
      ;;
    *) printf '\\r\\n  Comando demo completato.\\r\\n\\r\\n' ;;
  esac
  printf '\\033[38;5;75mvincodelab-demo\\033[0m \\033[38;5;99mOrbit-Metrics\\033[0m $ '
done
`, { mode: 0o700 })
  await chmod(fakeShell, 0o700)

  const applicationDatabase = new Database(path.join(directories.data, 'vincodelab.sqlite'))
  try {
    applicationDatabase.exec(`
      CREATE TABLE recent_workspaces (path TEXT PRIMARY KEY NOT NULL, last_opened_at INTEGER NOT NULL);
      CREATE TABLE app_preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `)
    applicationDatabase.prepare('INSERT INTO app_preferences (key, value) VALUES (?, ?)').run('appearance', 'dark')
  } finally {
    applicationDatabase.close()
  }
  return { root, ...directories, fakePi, fakeShell }
}

export function isolatedEnvironment(fixture) {
  return {
    GH_CONFIG_DIR: fixture.gh,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: fixture.home,
    HTTPS_PROXY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    LANG: 'it_IT.UTF-8',
    LOGNAME: 'vincodelab-demo',
    NO_PROXY: '127.0.0.1,localhost',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    SHELL: fixture.fakeShell,
    TMPDIR: fixture.temp,
    USER: 'vincodelab-demo',
    VINCODELAB_DATA_DIR: fixture.data,
    VINCODELAB_LOGS_DIR: path.join(fixture.root, 'logs'),
    VINCODELAB_PI_PATH: fixture.fakePi,
    XDG_CACHE_HOME: fixture.cache,
    XDG_CONFIG_HOME: path.join(fixture.profile, 'config'),
    XDG_DATA_HOME: path.join(fixture.profile, 'share'),
  }
}

export async function cleanupWorkspace(workspacePath) {
  const marker = path.join(workspacePath, '.vincodelab-demo-workspace.json')
  const markerStats = await lstat(marker)
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) throw new Error('Cleanup workspace demo rifiutato: marker non valido.')
  const parsed = JSON.parse(await readFile(marker, 'utf8'))
  if (parsed?.kind !== 'vincodelab-demo-workspace' || parsed?.version !== 1) throw new Error('Cleanup workspace demo rifiutato: marker non riconosciuto.')
  await rm(workspacePath, { recursive: true, force: false })
}
