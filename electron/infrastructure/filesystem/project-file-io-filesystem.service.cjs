const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

async function readBoundedFile(filePath, maxSize, tooLargeMessage) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0
  const fileHandle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow)
  try {
    const before = await fileHandle.stat()
    if (!before.isFile()) throw new Error('Il file richiesto non è un file regolare.')
    if (before.size > maxSize) throw new Error(tooLargeMessage)

    const allocation = Buffer.allocUnsafe(before.size + 1)
    let bytesRead = 0
    while (bytesRead < allocation.length) {
      const result = await fileHandle.read(allocation, bytesRead, allocation.length - bytesRead, null)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }

    const after = await fileHandle.stat()
    if (bytesRead > maxSize || after.size > maxSize) throw new Error(tooLargeMessage)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.size !== bytesRead) {
      throw new Error('Il file è cambiato durante la lettura. Riprova.')
    }
    return { buffer: allocation.subarray(0, bytesRead), mtimeMs: after.mtimeMs, size: after.size }
  } finally {
    await fileHandle.close()
  }
}

function writeFileAtomic(filePath, content, mode = 0o600) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)

  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true })
  }
}

module.exports = { readBoundedFile, writeFileAtomic }
