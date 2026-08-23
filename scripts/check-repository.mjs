import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDirectory, '..')

const generatedPrefixes = ['dist/', 'node_modules/', 'release/', 'styled-system/']
const junkNames = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const documentationExtensions = new Set(['.md', '.mdx', '.yaml', '.yml'])
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mdx', '.mjs',
  '.svg', '.ts', '.tsx', '.txt', '.yaml', '.yml',
])
const sensitivePatterns = [
  { label: 'chiave privata', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u },
  { label: 'token cloud', pattern: /\b(?:AKIA[A-Z0-9]{16}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
]
const localHomePatterns = [
  /\/Users\/[A-Za-z0-9._-]+(?:\/|\b)/u,
  /\/home\/[A-Za-z0-9._-]+(?:\/|\b)/u,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\|\b)/u,
]

function normalizeRepositoryPath(file) {
  return file.split(path.sep).join('/')
}

export function listRepositoryFiles(root = defaultRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  return output.split('\0').filter(Boolean).map(normalizeRepositoryPath).sort()
}

function isDocumentationFile(file) {
  return file === 'README.md'
    || file === 'CONTRIBUTING.md'
    || file === 'SECURITY.md'
    || file.startsWith('docs/')
    || file.startsWith('.github/')
    || documentationExtensions.has(path.extname(file).toLowerCase())
}

function markdownTargets(source) {
  return [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => {
    const raw = match[1].trim()
    if (raw.startsWith('<')) return raw.slice(1, raw.indexOf('>'))
    return raw.split(/\s+["']/u, 1)[0]
  })
}

function inspectMarkdownLinks(root, file, source, problems) {
  for (const target of markdownTargets(source)) {
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue
    const [pathname] = target.split('#', 1)
    if (!pathname) continue

    let decodedPath
    try {
      decodedPath = decodeURIComponent(pathname)
    } catch {
      problems.push(`${file}: collegamento con codifica non valida: ${target}`)
      continue
    }

    const resolved = path.resolve(root, path.dirname(file), decodedPath)
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      problems.push(`${file}: collegamento esterno alla repository: ${target}`)
    } else if (!existsSync(resolved)) {
      problems.push(`${file}: collegamento locale inesistente: ${target}`)
    }
  }
}

export function inspectRepository({ root = defaultRoot, files = listRepositoryFiles(root) } = {}) {
  const problems = []

  for (const rawFile of files) {
    const file = normalizeRepositoryPath(rawFile)
    const basename = path.posix.basename(file)
    if (junkNames.has(basename)) problems.push(`${file}: file di sistema non pubblicabile`)
    if (generatedPrefixes.some((prefix) => file.startsWith(prefix))) {
      problems.push(`${file}: artefatto generato tracciato nella repository`)
    }

    const absolutePath = path.join(root, file)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue

    const source = readFileSync(absolutePath, 'utf8')
    for (const { label, pattern } of sensitivePatterns) {
      if (pattern.test(source)) problems.push(`${file}: possibile ${label}`)
    }
    if (isDocumentationFile(file) && localHomePatterns.some((pattern) => pattern.test(source))) {
      problems.push(`${file}: percorso home locale nella documentazione`)
    }
    if (path.extname(file).toLowerCase() === '.md') inspectMarkdownLinks(root, file, source, problems)
  }

  return problems
}

export function formatRepositoryCheck(problems) {
  if (problems.length === 0) return 'Repository pronta: nessun artefatto, percorso locale o collegamento rotto rilevato.'
  return ['Controllo repository non superato:', ...problems.map((problem) => `- ${problem}`)].join('\n')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  const problems = inspectRepository()
  process.stdout.write(`${formatRepositoryCheck(problems)}\n`)
  if (problems.length > 0) process.exitCode = 1
}
