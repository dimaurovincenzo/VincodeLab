#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditCssArchitecture, auditWithinBudget, formatCssAuditSummary } from './lib/css-audit.mjs'
import { cssAuditBudget } from './css-audit.config.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDirectory, '..')
const report = auditCssArchitecture({ rootDir })
const checkBudget = process.argv.includes('--check')
const printJson = process.argv.includes('--json')

console.log(formatCssAuditSummary(report))

if (printJson) {
  console.log(JSON.stringify(report, null, 2))
}

if (checkBudget && !auditWithinBudget(report, cssAuditBudget)) {
  console.error('Audit CSS fuori budget: sono state introdotte nuove collisioni o eccezioni visuali.')
  process.exitCode = 1
}
