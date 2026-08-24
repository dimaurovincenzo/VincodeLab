const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { getApplicationErrorLogMetadata, toApplicationError } = require('../../domains/errors/application-error.cjs')

const BINARY_SAMPLE_BYTES = 8_192

function isBinary(value) {
  const sample = value.subarray(0, Math.min(value.length, BINARY_SAMPLE_BYTES))
  return sample.includes(0)
}

function createRemoteFileIo({ tempRoot, fileOperations = {}, log = () => undefined }) {
  const stagingRoot = path.join(tempRoot, 'vincodelab-remote-transfers')
  let stagingRootReady
  const io = {
    chmod: fs.promises.chmod.bind(fs.promises),
    copyFile: fs.promises.copyFile.bind(fs.promises),
    mkdir: fs.promises.mkdir.bind(fs.promises),
    open: fs.promises.open.bind(fs.promises),
    readFile: fs.promises.readFile.bind(fs.promises),
    rename: fs.promises.rename.bind(fs.promises),
    rm: fs.promises.rm.bind(fs.promises),
    stat: fs.promises.stat.bind(fs.promises),
    ...fileOperations,
  }

  async function cleanupTemporary(operation, cleanup) {
    try {
      await cleanup()
    } catch (error) {
      const incident = toApplicationError(error, {
        category: 'filesystem',
        domain: 'remote',
        message: 'La pulizia di un file temporaneo remoto non è stata completata.',
        operation,
        severity: 'warning',
      })
      log('warning', 'remote_temporary_cleanup_failed', getApplicationErrorLogMetadata(incident))
    }
  }

  function ensureStagingRoot() {
    stagingRootReady ??= (async () => {
      await io.mkdir(stagingRoot, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') await io.chmod(stagingRoot, 0o700)
    })()
    return stagingRootReady
  }

  function createTemporaryPath(suffix = '') {
    return path.join(stagingRoot, `${crypto.randomUUID()}${suffix}.tmp`)
  }

  function createDestinationTemporaryPath(destination) {
    return path.join(path.dirname(destination), `.${path.basename(destination)}.vincodelab-${crypto.randomUUID()}.tmp`)
  }

  async function flushFile(filePath) {
    const handle = await io.open(filePath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async function flushDirectory(directoryPath) {
    if (process.platform === 'win32') return
    let handle
    try {
      handle = await io.open(directoryPath, 'r')
      await handle.sync()
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error
    } finally {
      await handle?.close()
    }
  }

  async function statBoundedFile(filePath, maxBytes, errorMessage) {
    let stats
    try {
      stats = await io.stat(filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(errorMessage)
      throw error
    }
    if (!stats.isFile() || stats.size > maxBytes) throw new Error(errorMessage)
    return stats
  }

  async function readSample(filePath) {
    let handle
    try {
      handle = await io.open(filePath, 'r')
      const stats = await handle.stat()
      if (!stats.isFile()) throw new Error('Copia locale non trovata.')
      const sample = Buffer.alloc(Math.min(stats.size, BINARY_SAMPLE_BYTES))
      const { bytesRead } = sample.length > 0 ? await handle.read(sample, 0, sample.length, 0) : { bytesRead: 0 }
      return { sample: sample.subarray(0, bytesRead), size: stats.size }
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('Copia locale non trovata.')
      throw error
    } finally {
      await handle?.close()
    }
  }

  async function inspectFile(filePath, { maxBytes, collectLimit = 0, signal, errorMessage }) {
    const stats = await statBoundedFile(filePath, maxBytes, errorMessage)
    const hash = crypto.createHash('sha256')
    const sample = Buffer.alloc(BINARY_SAMPLE_BYTES)
    let collectedChunks = stats.size <= collectLimit ? [] : null
    let sampleLength = 0
    let bytes = 0
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024, signal })) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new Error(errorMessage)
      hash.update(chunk)
      if (sampleLength < sample.length) {
        const copied = Math.min(chunk.length, sample.length - sampleLength)
        chunk.copy(sample, sampleLength, 0, copied)
        sampleLength += copied
      }
      if (collectedChunks) {
        if (bytes <= collectLimit) collectedChunks.push(chunk)
        else collectedChunks = null
      }
    }
    return {
      content: collectedChunks ? Buffer.concat(collectedChunks, bytes) : undefined,
      hash: hash.digest('hex'),
      sample: sample.subarray(0, sampleLength),
      size: bytes,
    }
  }

  return {
    cleanupTemporary,
    createDestinationTemporaryPath,
    createTemporaryPath,
    ensureStagingRoot,
    flushDirectory,
    flushFile,
    inspectFile,
    io,
    isBinary,
    readSample,
    statBoundedFile,
  }
}

module.exports = { createRemoteFileIo, isBinary }
