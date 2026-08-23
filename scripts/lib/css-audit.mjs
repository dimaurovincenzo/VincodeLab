import fs, { globSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

const COLOR_VALUE = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i
const THEME_OWNER_FILES = new Set(['tokens.css', 'themes.css'])

export function collectCssFiles(rootDir) {
  return globSync('src/**/*.css', { cwd: rootDir }).map((file) => path.resolve(rootDir, file)).sort()
}

function sourceLocation(rootDir, file, node, value) {
  return {
    file: path.relative(rootDir, file),
    line: node.source?.start?.line ?? 0,
    value,
  }
}

function recordSelectorDeclaration({ declarations, rootDir, file, selector, declaration }) {
  const item = {
    ...sourceLocation(rootDir, file, declaration, declaration.value),
    selector,
    property: declaration.prop,
  }
  const key = `${selector}\0${declaration.prop}`
  const occurrences = declarations.get(key) ?? []
  occurrences.push(item)
  declarations.set(key, occurrences)
}

export function auditCssArchitecture({ rootDir, files = collectCssFiles(rootDir) }) {
  const declarations = new Map()
  const report = {
    files: files.map((file) => path.relative(rootDir, file)),
    selectorCount: 0,
    collisions: [],
    collisionSelectorCount: 0,
    importantOccurrences: [],
    hardcodedColors: [],
    viewThemeSelectors: [],
  }

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const root = postcss.parse(source, { from: file })
    const isViewFile = file.split(path.sep).join('/').includes('/styles/views/')

    root.walkRules((rule) => {
      const selectors = rule.selectors.map((value) => value.replace(/\s+/g, ' ').trim())
      const ruleDeclarations = (rule.nodes ?? []).filter((node) => node.type === 'decl')
      report.selectorCount += selectors.length
      for (const selector of selectors) {
        if (isViewFile && /data-theme|prefers-color-scheme/.test(selector)) {
          report.viewThemeSelectors.push(sourceLocation(rootDir, file, rule, selector))
        }
        for (const declaration of ruleDeclarations) {
          recordSelectorDeclaration({ declarations, rootDir, file, selector, declaration })
        }
      }
      for (const declaration of ruleDeclarations) {
        const item = {
          ...sourceLocation(rootDir, file, declaration, declaration.value),
          selector: selectors.join(', '),
          property: declaration.prop,
        }
        if (declaration.important) report.importantOccurrences.push(item)
        if (!THEME_OWNER_FILES.has(path.basename(file)) && COLOR_VALUE.test(declaration.value)) {
          report.hardcodedColors.push(item)
        }
      }
    })

    if (isViewFile) {
      root.walkAtRules('media', (rule) => {
        if (/prefers-color-scheme/.test(rule.params)) {
          report.viewThemeSelectors.push(sourceLocation(rootDir, file, rule, rule.params))
        }
      })
    }
  }

  report.collisions = [...declarations.entries()]
    .filter(([, occurrences]) => new Set(occurrences.map((item) => item.file)).size > 1)
    .map(([key, occurrences]) => {
      const [selector, property] = key.split('\0')
      return { selector, property, occurrences }
    })
  report.collisionSelectorCount = new Set(report.collisions.map((collision) => collision.selector)).size

  return report
}

export function auditWithinBudget(report, budget) {
  return report.selectorCount <= (budget.maxSelectors ?? Number.POSITIVE_INFINITY)
    && report.collisionSelectorCount <= budget.maxCollisionSelectors
    && report.collisions.length <= budget.maxCollisionProperties
    && report.importantOccurrences.length <= budget.maxImportantOccurrences
    && report.hardcodedColors.length <= budget.maxHardcodedColors
    && report.viewThemeSelectors.length <= budget.maxViewThemeSelectors
}

export function formatCssAuditSummary(report) {
  return [
    `${report.files.length} file CSS`,
    `${report.selectorCount} selettori`,
    `${report.collisionSelectorCount} selettori collidenti`,
    `${report.collisions.length} proprietà collidenti`,
    `${report.importantOccurrences.length} occorrenze !important`,
    `${report.hardcodedColors.length} colori locali`,
    `${report.viewThemeSelectors.length} selettori tema nelle viste`,
  ].join(' · ')
}
