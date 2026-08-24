const { execFile } = require('node:child_process')
const path = require('node:path')

const MACOS_OPEN_EXECUTABLE = '/usr/bin/open'
const DEFAULT_OPEN_TIMEOUT_MS = 15_000

function assertText(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`${label} non valido.`)
  return value
}

function assertAbsolutePath(value, label) {
  const candidate = assertText(value, label)
  if (!path.isAbsolute(candidate)) throw new TypeError(`${label} non valido.`)
  return candidate
}

function createContextCommandHostAdapter({
  clipboard,
  dialog,
  execFileImpl = execFile,
  getWindow,
  openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
  platform = process.platform,
  shell,
}) {
  if (typeof clipboard?.writeText !== 'function'
    || typeof dialog?.showErrorBox !== 'function'
    || typeof dialog?.showOpenDialog !== 'function'
    || typeof execFileImpl !== 'function'
    || typeof getWindow !== 'function'
    || typeof shell?.openPath !== 'function'
    || typeof shell?.showItemInFolder !== 'function') {
    throw new TypeError('Adapter host dei comandi contestuali non valido.')
  }
  if (!Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1 || openTimeoutMs > 60_000) {
    throw new TypeError('Timeout apertura applicazione non valido.')
  }

  async function chooseApplication() {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Apri con',
      buttonLabel: 'Apri',
      defaultPath: '/Applications',
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  function copyText(value) {
    clipboard.writeText(assertText(value, 'Testo da copiare'))
  }

  function openPath(targetPath) {
    return shell.openPath(assertAbsolutePath(targetPath, 'Percorso da aprire'))
  }

  function openWithApplication(applicationPath, filePath) {
    if (platform !== 'darwin') return Promise.reject(new Error('Apri con è disponibile soltanto su macOS.'))
    const application = assertAbsolutePath(applicationPath, 'Percorso applicazione')
    const target = assertAbsolutePath(filePath, 'Percorso file')
    if (path.extname(application).toLowerCase() !== '.app') {
      return Promise.reject(new TypeError('Seleziona un’applicazione macOS valida.'))
    }
    return new Promise((resolve, reject) => {
      execFileImpl(MACOS_OPEN_EXECUTABLE, ['-a', application, target], {
        timeout: openTimeoutMs,
        windowsHide: true,
      }, (error) => error ? reject(error) : resolve())
    })
  }

  function revealItem(targetPath) {
    shell.showItemInFolder(assertAbsolutePath(targetPath, 'Percorso da mostrare'))
  }

  function showError(title, message) {
    dialog.showErrorBox(assertText(title, 'Titolo errore'), assertText(message, 'Messaggio errore'))
  }

  return Object.freeze({
    chooseApplication,
    copyText,
    openPath,
    openWithApplication,
    revealItem,
    showError,
  })
}

module.exports = {
  createContextCommandHostAdapter,
}
