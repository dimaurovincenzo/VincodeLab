const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { prepareTerminalAttachment } = require('../electron/domains/ai/terminal-attachments.cjs')

test('prepara solo file reali leggibili e restituisce metadata minimi', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincode-terminal-'))
  const filePath = path.join(directory, 'report con spazi.pdf')
  try {
    fs.writeFileSync(filePath, 'test')
    assert.deepEqual(prepareTerminalAttachment(filePath), {
      absolutePath: fs.realpathSync(filePath),
      name: 'report con spazi.pdf',
    })
    assert.throws(() => prepareTerminalAttachment(directory), /file regolare/)
    assert.throws(() => prepareTerminalAttachment('relative.pdf'), /assoluto/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('rifiuta collegamenti simbolici e path inesistenti', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincode-terminal-'))
  const targetPath = path.join(directory, 'target.txt')
  const linkPath = path.join(directory, 'collegamento.txt')
  try {
    fs.writeFileSync(targetPath, 'test')
    fs.symlinkSync(targetPath, linkPath)
    assert.throws(() => prepareTerminalAttachment(linkPath), /link simbolici/)
    assert.throws(() => prepareTerminalAttachment(path.join(directory, 'mancante.txt')), /non disponibile/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
