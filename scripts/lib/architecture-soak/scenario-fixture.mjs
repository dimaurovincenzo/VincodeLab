import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const UNICODE_PATTERN = 'A🙂é中'

export function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function restoreEnvironment(name, previousValue) {
  if (previousValue === undefined) delete process.env[name]
  else process.env[name] = previousValue
}
