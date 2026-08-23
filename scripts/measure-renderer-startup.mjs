import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const staticImportPattern = /\bimport(?!\s*\()(?:[^"'`;]*?\bfrom\s*)?\s*["']([^"']+)["']/gu

function htmlAssets(html, attribute, relation) {
  const pattern = relation
    ? new RegExp(`<link\\b(?=[^>]*\\brel=["']${relation}["'])[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'giu')
    : new RegExp(`<script\\b(?=[^>]*\\btype=["']module["'])[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'giu')
  return [...html.matchAll(pattern)].map((match) => match[1])
}

function relativeAsset(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  return path.resolve(path.dirname(fromFile), specifier)
}

async function compressedSize(filePath) {
  const source = await readFile(filePath)
  return { bytes: source.byteLength, gzipBytes: gzipSync(source).byteLength }
}

async function collectEagerJavaScript(entries) {
  const pending = [...entries]
  const visited = new Set()
  while (pending.length > 0) {
    const filePath = pending.pop()
    if (!filePath || visited.has(filePath)) continue
    visited.add(filePath)
    const source = await readFile(filePath, 'utf8')
    for (const match of source.matchAll(staticImportPattern)) {
      const importedFile = relativeAsset(filePath, match[1])
      if (importedFile && !visited.has(importedFile)) pending.push(importedFile)
    }
  }
  return [...visited].sort()
}

async function summarize(files, distDir) {
  const details = await Promise.all(files.map(async (filePath) => ({
    file: path.relative(distDir, filePath),
    ...await compressedSize(filePath),
  })))
  return {
    files: details,
    count: details.length,
    bytes: details.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: details.reduce((total, file) => total + file.gzipBytes, 0),
  }
}

export async function measureRendererStartup(distDirectory) {
  const distDir = path.resolve(distDirectory)
  const indexPath = path.join(distDir, 'index.html')
  await stat(indexPath)
  const html = await readFile(indexPath, 'utf8')
  const moduleEntries = htmlAssets(html, 'src').map((asset) => path.resolve(distDir, asset))
  const preloads = htmlAssets(html, 'href', 'modulepreload').map((asset) => path.resolve(distDir, asset))
  const styles = htmlAssets(html, 'href', 'stylesheet').map((asset) => path.resolve(distDir, asset))
  const eagerJavaScript = await collectEagerJavaScript([...moduleEntries, ...preloads])
  const javascript = await summarize(eagerJavaScript, distDir)
  const css = await summarize([...new Set(styles)].sort(), distDir)
  return {
    entry: path.relative(distDir, indexPath),
    javascript,
    css,
    total: {
      bytes: javascript.bytes + css.bytes,
      gzipBytes: javascript.gzipBytes + css.gzipBytes,
    },
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  const distDir = process.argv[2] ?? path.resolve(process.cwd(), 'dist')
  const result = await measureRendererStartup(distDir)
  process.stdout.write(`${JSON.stringify(result, null, process.argv.includes('--json') ? 0 : 2)}\n`)
}
