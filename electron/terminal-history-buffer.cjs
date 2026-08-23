function createTerminalHistoryBuffer({ maxBytes, byteLength = Buffer.byteLength }) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('Capacità storico non valida.')

  const blocks = []
  let bytes = 0

  return {
    append(block) {
      const next = {
        sequence: block.sequence,
        data: block.data,
        bytes: block.bytes ?? byteLength(block.data, 'utf8'),
      }
      blocks.push(next)
      bytes += next.bytes
      while (bytes > maxBytes && blocks.length > 1) bytes -= blocks.shift().bytes
    },
    clear() {
      blocks.length = 0
      bytes = 0
    },
    size() {
      return { blocks: blocks.length, bytes }
    },
    snapshot() {
      return {
        data: blocks.map((block) => block.data).join(''),
        firstSequence: blocks[0]?.sequence ?? 0,
        watermark: blocks.at(-1)?.sequence ?? 0,
        bytes,
      }
    },
  }
}

module.exports = { createTerminalHistoryBuffer }
