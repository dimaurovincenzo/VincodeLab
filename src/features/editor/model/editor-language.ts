import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'

export function languageForFile(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(extension ?? '')) return javascript({ typescript: ['ts', 'tsx'].includes(extension ?? ''), jsx: ['jsx', 'tsx'].includes(extension ?? '') })
  if (extension === 'json') return json()
  if (['md', 'mdx'].includes(extension ?? '')) return markdown()
  if (['html', 'htm'].includes(extension ?? '')) return html()
  if (extension === 'css') return css()
  if (['yml', 'yaml'].includes(extension ?? '')) return yaml()
  if (['sh', 'bash', 'zsh'].includes(extension ?? '')) return StreamLanguage.define(shell)
  if (extension === 'sql') return sql()
  if (extension === 'py') return python()
  return []
}
