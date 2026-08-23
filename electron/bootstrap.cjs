const { app, clipboard, dialog } = require('electron')

const FATAL_EXPERIENCE = Symbol.for('vincodelab.fatal-error-experience')

function safeProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try { return value[key] } catch { return undefined }
}

function emergencyFailure(error) {
  const publicCode = safeProperty(error, 'publicCode')
  const code = safeProperty(error, 'code')
  const message = safeProperty(error, 'message')
  const signal = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`
  const incompatible = publicCode === 'APP_RUNTIME_INCOMPATIBLE'
    || code === 'APP_RUNTIME_INCOMPATIBLE'
    || /ERR_DLOPEN_FAILED|incompatible architecture|mach-o|node_module_version|was compiled against|symbol not found/iu.test(signal)
  if (incompatible) return {
    code: 'APP_RUNTIME_INCOMPATIBLE',
    message: 'Questa copia di VincodeLab non è compatibile con questo Mac. Installa il pacchetto adatto all’architettura e alla versione di macOS in uso.',
  }
  const incomplete = publicCode === 'APP_INSTALLATION_INCOMPLETE'
    || code === 'APP_INSTALLATION_INCOMPLETE'
    || code === 'MODULE_NOT_FOUND'
    || code === 'ERR_MODULE_NOT_FOUND'
    || /cannot find module|module did not self-register/iu.test(signal)
  if (incomplete) return {
    code: 'APP_INSTALLATION_INCOMPLETE',
    message: 'Questa installazione di VincodeLab è incompleta. Scarica nuovamente il pacchetto e sostituisci questa copia dell’app.',
  }
  return null
}

function emergencyCorrelationId() {
  const value = (Date.now() ^ Math.floor(Math.random() * 0xFF_FFFF)) >>> 0
  return `ERR-${value.toString(16).toUpperCase().padStart(6, '0').slice(-6)}`
}

function createEmergencyFatalExperience() {
  let activePresentation = null

  function present(error) {
    if (activePresentation) return activePresentation
    const failure = emergencyFailure(error) ?? {
      code: 'APP_STARTUP_FAILED',
      message: 'VincodeLab non è riuscito ad avviarsi. Reinstalla l’applicazione e riprova.',
    }
    const correlationId = emergencyCorrelationId()
    const diagnostic = [
      `Riferimento: ${correlationId}`,
      `Codice: ${failure.code}`,
      'Componente: bootstrap',
      `Data: ${new Date().toISOString()}`,
    ].join('\n')

    activePresentation = app.whenReady().then(async () => {
      let copyStatus = ''
      for (;;) {
        const result = await dialog.showMessageBox({
          type: 'error',
          buttons: ['Esci e reinstalla', 'Copia diagnostica'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          title: 'Installazione da riparare',
          message: failure.message,
          detail: `Nessun file del workspace è stato modificato. Node, npm e i client database di sistema non possono riparare i componenti inclusi nell’app.\n\nRiferimento ${correlationId}.${copyStatus}`,
        })
        if (result.response !== 1) {
          app.exit(1)
          return 'exit'
        }
        try {
          clipboard.writeText(diagnostic)
          copyStatus = '\nLa diagnostica è stata copiata.'
        } catch {
          copyStatus = '\nGli appunti non sono disponibili; usa il riferimento mostrato.'
        }
      }
    }).catch(() => {
      app.exit(1)
      return 'exit'
    }).finally(() => { activePresentation = null })
    return activePresentation
  }

  return {
    handleInstallationFailure: present,
    handleStartup: present,
    handleUncaughtException: present,
    handleUnhandledRejection: present,
  }
}

let fatalErrorExperience = createEmergencyFatalExperience()
globalThis[FATAL_EXPERIENCE] = fatalErrorExperience

// Questi handler esistono prima di caricare qualunque modulo applicativo:
// anche un bundle incompleto produce una schermata sanitizzata e recuperabile.
process.on('uncaughtException', (error) => {
  void fatalErrorExperience.handleUncaughtException(error)
})
process.on('unhandledRejection', (reason) => {
  void fatalErrorExperience.handleUnhandledRejection(reason)
})

let classifyStartupLoadFailure = emergencyFailure
try {
  const { createFatalErrorExperience } = require('./fatal-error-experience.cjs')
  const { flushLogs, log } = require('./logger.cjs')
  ;({ classifyStartupLoadFailure } = require('./startup-bootstrap-guard.cjs'))
  fatalErrorExperience = createFatalErrorExperience({ app, clipboard, dialog, flushLogs, log })
  globalThis[FATAL_EXPERIENCE] = fatalErrorExperience
  require('./main.cjs')
} catch (error) {
  const installationFailure = classifyStartupLoadFailure(error) ?? emergencyFailure(error)
  void app.whenReady().then(() => installationFailure
    ? fatalErrorExperience.handleInstallationFailure(installationFailure)
    : fatalErrorExperience.handleStartup(error))
    .catch(() => app.exit(1))
}
