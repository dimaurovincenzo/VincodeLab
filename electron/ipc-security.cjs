function isTrustedIpcEvent(event, webContents) {
  if (!event || !webContents || event.sender !== webContents) return false
  const senderFrame = event.senderFrame
  return Boolean(senderFrame && senderFrame === webContents.mainFrame)
}

function installNavigationGuards(webContents) {
  if (!webContents || typeof webContents.on !== 'function' || typeof webContents.setWindowOpenHandler !== 'function') {
    throw new Error('WebContents non valido.')
  }
  const prevent = (event) => event.preventDefault()
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', prevent)
  webContents.on('will-redirect', prevent)
  webContents.on('will-attach-webview', prevent)
}

module.exports = { installNavigationGuards, isTrustedIpcEvent }
