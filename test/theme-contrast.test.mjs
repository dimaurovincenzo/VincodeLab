import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tokens = fs.readFileSync(path.join(projectRoot, 'src/theme/tokens.ts'), 'utf8')

function paletteFor(mode) {
  const start = tokens.indexOf(`${mode}: {`)
  const end = mode === 'light' ? tokens.indexOf('dark: {', start) : tokens.indexOf('\n    },\n  },\n  spacing:', start)
  assert.notEqual(start, -1, `palette ${mode} assente`)
  assert.notEqual(end, -1, `fine palette ${mode} assente`)
  return Object.fromEntries(
    [...tokens.slice(start, end).matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*\{ value:\s*'(#[0-9A-Fa-f]{6})' \},?$/gm)]
      .map(([, role, value]) => [role, value]),
  )
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9A-Fa-f]{2}/g).map((channel) => Number.parseInt(channel, 16) / 255)
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function assertContrast(palette, foreground, background, minimum = 4.5) {
  assert.ok(palette[foreground], `token ${foreground} assente`)
  assert.ok(palette[background], `token ${background} assente`)
  const ratio = contrastRatio(palette[foreground], palette[background])
  assert.ok(
    ratio >= minimum,
    `${foreground} ${palette[foreground]} su ${background} ${palette[background]}: ${ratio.toFixed(2)}:1, richiesto almeno ${minimum}:1`,
  )
}

test('i semantic token Graphite mantengono contrasto WCAG AA in light e dark mode', async (t) => {
  const surfaces = ['surfaceCanvas', 'surfacePanel', 'surfaceRaised', 'surfaceSubtle', 'surfaceHover', 'surfaceSelected']
  const textRoles = ['textPrimary', 'textSecondary', 'textTertiary']
  const semanticPairs = [
    ['accentContrast', 'accentSolid'],
    ['accentContrast', 'accentHover'],
    ['accentText', 'accentSubtle'],
    ['accentText', 'accentMuted'],
    ['stateSuccess', 'stateSuccessSoft'],
    ['stateWarning', 'stateWarningSoft'],
    ['stateError', 'stateErrorSoft'],
    ['codeText', 'codeSurface'],
    ['codeMuted', 'codeSurface'],
  ]

  for (const mode of ['light', 'dark']) {
    await t.test(mode, () => {
      const palette = paletteFor(mode)
      for (const textRole of textRoles) {
        for (const surface of surfaces) assertContrast(palette, textRole, surface)
      }
      for (const [foreground, background] of semanticPairs) assertContrast(palette, foreground, background)
    })
  }
})
