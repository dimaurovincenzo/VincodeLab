import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('il benchmark chiude i dialog Ark con una sequenza pointer completa', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts', 'benchmark-reliability.mjs'), 'utf8')
  const escapeIndex = source.indexOf("new KeyboardEvent('keydown'")
  const settleIndex = source.indexOf('requestAnimationFrame(() => requestAnimationFrame(resolve))', escapeIndex)
  const fallbackGuardIndex = source.indexOf('if (backdrop && openPalette())', settleIndex)
  const pointerDownIndex = source.indexOf("new PointerEvent('pointerdown'", fallbackGuardIndex)
  const pointerUpIndex = source.indexOf("new PointerEvent('pointerup'", pointerDownIndex)
  const clickIndex = source.indexOf("new MouseEvent('click'", pointerUpIndex)

  assert.ok(escapeIndex >= 0)
  assert.ok(settleIndex > escapeIndex)
  assert.ok(fallbackGuardIndex > settleIndex)
  assert.ok(pointerDownIndex > fallbackGuardIndex)
  assert.ok(pointerUpIndex > pointerDownIndex)
  assert.ok(clickIndex > pointerUpIndex)
})
