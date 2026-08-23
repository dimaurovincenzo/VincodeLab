const assert = require('node:assert/strict')
const test = require('node:test')
const { installPiPackage, listPiPackages, removePiPackage, updatePiPackage } = require('../electron/pi-system-service.cjs')

test('installPiPackage rifiuta sorgenti con controlli e usa argomenti non shell', async () => {
  const calls = []; const resolve = () => '/usr/local/bin/pi'; const run = async (executable, args) => { calls.push({ executable, args }); return { stdout: '', stderr: '' } }
  await assert.rejects(() => installPiPackage('x\n--flag', resolve, run), /Sorgente estensione non valida/)
  await installPiPackage('owner/plugin', resolve, run)
  assert.deepEqual(calls[0].args, ['install', 'owner/plugin'])
})

test('listPiPackages trasforma lista vuota reale in un elenco vuoto', async () => {
  assert.deepEqual(await listPiPackages(() => '/usr/local/bin/pi', async () => ({ stdout: 'No packages installed.\n', stderr: '' })), [])
})

test('azioni sui pacchetti usano il runner predefinito quando l’IPC non ne inietta uno', async () => {
  const resolve = () => process.execPath
  for (const action of [installPiPackage, updatePiPackage, removePiPackage]) {
    await assert.rejects(() => action('npm:pacchetto-di-test', resolve), /Il comando Pi non è riuscito/)
  }
})
