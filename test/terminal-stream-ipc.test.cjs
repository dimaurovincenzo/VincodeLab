const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')

test('main e preload espongono un flusso sequenziale con resume e ACK', () => {
  const main = read('electron/main.cjs')
  const preload = read('electron/preload.cjs')

  assert.match(main, /createTerminalStreamController/)
  assert.match(main, /ipcMain\.handle\('terminal:resume'/)
  assert.match(main, /ipcMain\.on\('terminal:ready'/)
  assert.match(main, /ipcMain\.on\('terminal:ack'/)
  assert.match(main, /sendToRenderer\('terminal:output'/)
  assert.match(main, /sendToRenderer\('terminal:streamState'/)
  assert.match(preload, /resume: \(request\) => ipcRenderer\.invoke\('terminal:resume', request\)/)
  assert.match(preload, /ready: \(message\) => ipcRenderer\.send\('terminal:ready', message\)/)
  assert.match(preload, /ack: \(message\) => ipcRenderer\.send\('terminal:ack', message\)/)
  assert.match(preload, /onOutput: \(listener\)/)
  assert.match(preload, /onStreamState: \(listener\)/)
})

test('la migrazione elimina lo storico stringa e i canali legacy', () => {
  const main = read('electron/main.cjs')
  const preload = read('electron/preload.cjs')
  const terminalPreload = preload.slice(preload.indexOf('\n  terminal: {'), preload.lastIndexOf('\n})'))

  assert.doesNotMatch(main, /terminalOutputHistory|MAX_TERMINAL_OUTPUT_HISTORY|terminal:history|terminal:data/)
  assert.doesNotMatch(terminalPreload, /terminal:history|terminal:data|history: \(\)|onData: \(listener\)/)
})

test('i messaggi del flusso vengono accettati solo dalla finestra attendibile', () => {
  const main = read('electron/main.cjs')

  assert.match(main, /ipcMain\.handle\('terminal:resume',[\s\S]{0,240}assertTrustedSender\(event\)/)
  assert.match(main, /ipcMain\.on\('terminal:ready',[\s\S]{0,240}assertTrustedSender\(event\)/)
  assert.match(main, /ipcMain\.on\('terminal:ack',[\s\S]{0,240}assertTrustedSender\(event\)/)
})
