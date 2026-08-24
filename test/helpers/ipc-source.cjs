const fs = require('node:fs')

const { IPC_CHANNELS } = require('../../electron/ipc/channels.cjs')

function expandIpcChannelConstants(source) {
  return source.replace(/\bIPC_CHANNELS\.([A-Z][A-Z0-9_]*)\b/gu, (_match, name) => {
    const channel = IPC_CHANNELS[name]
    if (!channel) throw new Error(`Canale IPC sconosciuto nel test sorgente: ${name}`)
    return `'${channel}'`
  })
}

function readIpcSource(filePath) {
  return expandIpcChannelConstants(fs.readFileSync(filePath, 'utf8'))
}

module.exports = { expandIpcChannelConstants, readIpcSource }
