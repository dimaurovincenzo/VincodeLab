const { IPC_CHANNELS } = require('../../ipc/channels.cjs')
const { toApplicationError } = require('../../domains/errors/application-error.cjs')
const { wrapIpcListener } = require('./ipc-one-way-error.cjs')
const { isTrustedIpcEvent } = require('../security/ipc-security.adapter.cjs')

function createApplicationIpcBoundary({ getWindow, log, sendToRenderer }) {
  function assertTrustedSender(event) {
    const window = getWindow()
    if (!window || !isTrustedIpcEvent(event, window.webContents)) {
      log('warn', 'ipc_sender_rejected')
      throw new Error('Origine IPC non autorizzata.')
    }
  }

  function publicApplicationErrorPayload(error, options) {
    const incident = toApplicationError(error, options)
    return Object.freeze({
      category: incident.category,
      code: incident.publicCode,
      correlationId: incident.correlationId,
      message: incident.message,
      recoverable: incident.recoverable,
      severity: incident.severity,
    })
  }

  function workspaceFailure(error, options) {
    const errorIncident = publicApplicationErrorPayload(error, { channel: IPC_CHANNELS.WORKSPACE_OPEN, ...options })
    return Object.freeze({ error: errorIncident.message, errorIncident })
  }

  function confineIpcOneWay(channel, listener) {
    return wrapIpcListener(channel, listener, {
      log,
      onFailure: (failure, args) => {
        if (!failure.eventChannel || !failure.payload) return
        const event = args[0]
        const window = getWindow()
        if (!event || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
        if (!isTrustedIpcEvent(event, window.webContents)) return
        sendToRenderer(failure.eventChannel, failure.payload)
      },
    })
  }

  function rejectOneWay(code, message) {
    const error = new Error(message)
    error.code = code
    throw error
  }

  return Object.freeze({
    assertTrustedSender,
    confineIpcOneWay,
    publicApplicationErrorPayload,
    rejectOneWay,
    workspaceFailure,
  })
}

module.exports = { createApplicationIpcBoundary }
