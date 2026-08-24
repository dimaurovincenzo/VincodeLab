const { restorePublicInvokeError } = require('./public-error-restorer.cjs')

// L'Error serializzato da Electron conserva soltanto il messaggio. Il preload è
// il confine fidato che ricostruisce il contratto pubblico classificato dal main;
// qualsiasi rejection non conforme resta un errore non attendibile nel renderer.
function createSafeIpcRenderer(electronIpcRenderer) {
  return Object.freeze({
    invoke: (channel, ...args) => electronIpcRenderer.invoke(channel, ...args).catch((error) => {
      throw restorePublicInvokeError(error, channel)
    }),
    on: (...args) => electronIpcRenderer.on(...args),
    removeListener: (...args) => electronIpcRenderer.removeListener(...args),
    send: (...args) => electronIpcRenderer.send(...args),
  })
}

module.exports = { createSafeIpcRenderer }
