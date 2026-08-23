const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { installNavigationGuards, isTrustedIpcEvent } = require('../electron/ipc-security.cjs')
const { safeKillPty } = require('../electron/pty-lifecycle.cjs')

test('accetta IPC soltanto dal main frame della finestra applicativa', () => {
  const mainFrame = {}
  const webContents = { mainFrame }

  assert.equal(isTrustedIpcEvent({ sender: webContents, senderFrame: mainFrame }, webContents), true)
  assert.equal(isTrustedIpcEvent({ sender: webContents, senderFrame: {} }, webContents), false)
  assert.equal(isTrustedIpcEvent({ sender: {}, senderFrame: mainFrame }, webContents), false)
  assert.equal(isTrustedIpcEvent({ sender: webContents, senderFrame: null }, webContents), false)
})

test('installa i blocchi di navigazione prima del caricamento del renderer', () => {
  const webContents = new EventEmitter()
  let openHandler
  webContents.setWindowOpenHandler = (handler) => { openHandler = handler }
  installNavigationGuards(webContents)

  assert.deepEqual(openHandler(), { action: 'deny' })
  for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false
    webContents.emit(eventName, { preventDefault: () => { prevented = true } })
    assert.equal(prevented, true, `${eventName} deve essere bloccato`)
  }
})

test('un kill PTY già terminato non interrompe il coordinatore di cleanup', () => {
  assert.equal(safeKillPty(null), false)
  assert.equal(safeKillPty({ kill: () => { throw new Error('processo già chiuso') } }), false)
  let kills = 0
  assert.equal(safeKillPty({ kill: () => { kills += 1 } }), true)
  assert.equal(kills, 1)
})

test('i DTO workspace redigono gli errori interni prima di raggiungere il renderer', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const openWorkspace = source.slice(source.indexOf('function openWorkspace('), source.indexOf('async function chooseAndOpenWorkspace'))
  const launchWorkspace = source.slice(source.indexOf("ipcMain.handle('workspace:openInNewInstance'"), source.indexOf("ipcMain.on('appMenu:setContext'"))

  assert.match(source, /require\('\.\/public-error\.cjs'\)/)
  assert.match(openWorkspace, /PI_START_FAILED/)
  assert.match(openWorkspace, /WORKSPACE_OPEN_FAILED/)
  assert.match(openWorkspace, /errorIncident/)
  assert.match(launchWorkspace, /WORKSPACE_INSTANCE_LAUNCH_FAILED/)
  assert.doesNotMatch(openWorkspace, /error instanceof Error \? error\.message/)
  assert.doesNotMatch(launchWorkspace, /error instanceof Error \? error\.message/)
})
