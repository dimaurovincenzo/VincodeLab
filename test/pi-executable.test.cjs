const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { resolvePiExecutable } = require('../electron/pi-executable.cjs')

test('un override Pi esplicito è autorevole anche quando indica assenza', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-resolver-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const pathDirectory = path.join(root, 'bin')
  fs.mkdirSync(pathDirectory)
  const fallbackPi = path.join(pathDirectory, 'pi')
  fs.writeFileSync(fallbackPi, '#!/bin/sh\nexit 0\n', { mode: 0o700 })

  assert.equal(resolvePiExecutable({ environment: { PATH: pathDirectory, VINCODELAB_PI_PATH: path.join(root, 'missing-pi') }, homeDirectory: root }), undefined)
  assert.equal(resolvePiExecutable({ environment: { PATH: pathDirectory }, homeDirectory: root }), fallbackPi)
})
