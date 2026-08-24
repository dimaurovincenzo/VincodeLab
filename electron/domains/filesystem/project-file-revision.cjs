const { createHash } = require('node:crypto')

function createFileRevision(buffer, stats) {
  const digest = createHash('sha256')
    .update('vincodelab-project-file-v1\0')
    .update(buffer)
    .update('\0')
    .update(String(stats.size))
    .update('\0')
    .update(String(Math.round(stats.mtimeMs * 1_000)))
    .digest('base64url')
  return `v1-${digest}`
}

module.exports = { createFileRevision }
