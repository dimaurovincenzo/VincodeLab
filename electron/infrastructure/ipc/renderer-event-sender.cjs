function createRendererEventSender({
  getApplicationErrorLogMetadata,
  getWindow,
  log,
  toApplicationError,
}) {
  return function sendToRenderer(channel, payload) {
    const window = getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
    try {
      window.webContents.send(channel, payload)
      return true
    } catch (error) {
      const incident = toApplicationError(error, {
        channel: 'renderer:eventDelivery',
        code: 'RENDERER_EVENT_DELIVERY_FAILED',
        domain: 'internal',
        message: 'Un aggiornamento non è stato consegnato all’interfaccia.',
        operation: 'sendToRenderer',
        recoverable: true,
        severity: 'warning',
      })
      log('warning', 'renderer_event_delivery_failed', {
        ...getApplicationErrorLogMetadata(incident),
        eventChannel: channel,
      })
      return false
    }
  }
}

module.exports = { createRendererEventSender }
