#!/usr/bin/env node

import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCliArguments, validateAbsolutePath } from './lib/sftp-loopback-uat/config-builders.mjs'
import { runLoopbackUat } from './lib/sftp-loopback-uat/scenario.mjs'

export {
  buildAuthenticationArguments,
  buildControlCommandArguments,
  buildControlMasterArguments,
  buildKnownHostsLine,
  buildSftpIsolationArguments,
  buildSshClientOptions,
  buildSshdConfig,
  parseCliArguments,
} from './lib/sftp-loopback-uat/config-builders.mjs'
export { createPrivacySafeReport } from './lib/sftp-loopback-uat/report.mjs'
export { runLoopbackUat } from './lib/sftp-loopback-uat/scenario.mjs'

function usage() {
  return [
    'UAT SFTP loopback isolato per VincodeLab.',
    '',
    'Uso:',
    '  node scripts/uat-sftp-loopback.mjs --run [--timeout-ms 30000] [--output <report.json>]',
    '',
    'La modalità reale richiede macOS e produce esclusivamente JSON privacy-safe su stdout.',
  ].join('\n')
}

async function writeReportAtomically(outputPath, serializedReport) {
  validateAbsolutePath(outputPath, 'Percorso report')
  const temporaryReportPath = `${outputPath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryReportPath, serializedReport, { mode: 0o600 })
    await rename(temporaryReportPath, outputPath)
  } finally {
    try { await rm(temporaryReportPath, { force: true }) } catch {}
  }
}

async function main() {
  let options
  try {
    options = parseCliArguments(process.argv.slice(2))
  } catch {
    process.stderr.write(`${usage()}\n`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (!options.execute) {
    process.stderr.write('Esecuzione reale non avviata: aggiungere --run dopo aver liberato la finestra di profiling Electron.\n')
    process.exitCode = 2
    return
  }

  const interruption = new AbortController()
  const onInterrupt = () => interruption.abort()
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  try {
    const report = await runLoopbackUat({ signal: interruption.signal, timeoutMs: options.timeoutMs })
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`
    if (options.outputPath) {
      try {
        await writeReportAtomically(options.outputPath, serializedReport)
      } catch {
        process.stderr.write('Impossibile salvare il report UAT richiesto.\n')
        process.exitCode = 1
      }
    }
    process.stdout.write(serializedReport)
    if (!report.ok) process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntrypoint) await main()
