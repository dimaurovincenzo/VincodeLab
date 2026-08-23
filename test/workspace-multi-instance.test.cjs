const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')

test('il preload espone solo stato e avvio confinato della nuova istanza', () => {
  assert.match(preload, /instanceStatus: \(workspacePath\) => ipcRenderer\.invoke\('workspace:instanceStatus', workspacePath\)/)
  assert.match(preload, /openInNewInstance: \(workspacePath\) => ipcRenderer\.invoke\('workspace:openInNewInstance', workspacePath\)/)
  assert.doesNotMatch(preload, /execPath|spawn|child_process/)
})

test('il main mantiene SQLite aperto finché tutte le finestre sono chiuse', () => {
  assert.match(main, /createInstanceRegistry\(\{ database: getDatabase\(\)/)
  assert.match(main, /instanceRegistry\.register\(\{ instanceId, pid: process\.pid \}\)/)
  assert.match(main, /setInterval\([^]*instanceRegistry\.heartbeat\(instanceId\)/)
  assert.match(main, /before-quit[^]*instanceRegistry\?\.unregister\(instanceId\)/)
  assert.doesNotMatch(main, /before-quit[^]*closeDatabase\(\)/)
  assert.match(main, /app\.on\('will-quit', closeDatabase\)/)
})

test('apertura in nuova istanza valida directory, limite e duplicati prima dello spawn', () => {
  const launchHandler = main.slice(
    main.indexOf("ipcMain.handle('workspace:openInNewInstance'"),
    main.indexOf("ipcMain.on('appMenu:setContext'"),
  )

  assert.match(main, /ipcMain\.handle\('workspace:instanceStatus'[^]*assertTrustedSender/)
  assert.match(launchHandler, /ipcMain\.handle\('workspace:openInNewInstance', async/)
  assert.match(launchHandler, /assertTrustedSender/)
  assert.match(launchHandler, /isDirectory\(workspacePath\)/)
  assert.match(launchHandler, /instanceRegistry\.status\(workspacePath\)/)
  assert.match(launchHandler, /return await launchWorkspaceInstance/)
  assert.match(launchHandler, /onPostLaunchError/)
  assert.match(launchHandler, /reason: 'launch-failed'/)
})

test('un workspace passato da riga di comando viene aperto nel processo dedicato', () => {
  assert.match(main, /readWorkspaceArgument\(process\.argv\)/)
  assert.match(main, /startupWorkspacePath[^]*openWorkspace\(startupWorkspacePath\)/)
})
