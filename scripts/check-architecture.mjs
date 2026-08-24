import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatArchitectureCheck, inspectArchitecture } from './lib/architecture-check.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const problems = inspectArchitecture({ root: path.resolve(scriptDirectory, '..') })

process.stdout.write(`${formatArchitectureCheck(problems)}\n`)
if (problems.length > 0) process.exitCode = 1
