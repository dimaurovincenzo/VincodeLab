import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history as editorHistory, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { foldGutter, foldKeymap, StreamLanguage } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { Decoration, EditorView, keymap, lineNumbers, WidgetType } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, SearchQuery, searchKeymap, setSearchQuery } from '@codemirror/search'
import { showMinimap } from '@replit/codemirror-minimap'
import { Icon } from '@iconify/react'
import ansibleIcon from '@iconify-icons/vscode-icons/file-type-ansible'
import astroIcon from '@iconify-icons/vscode-icons/file-type-astro'
import audioIcon from '@iconify-icons/vscode-icons/file-type-audio'
import bunIcon from '@iconify-icons/vscode-icons/file-type-bun'
import certIcon from '@iconify-icons/vscode-icons/file-type-cert'
import csharpIcon from '@iconify-icons/vscode-icons/file-type-csharp'
import clojureIcon from '@iconify-icons/vscode-icons/file-type-clojure'
import cppIcon from '@iconify-icons/vscode-icons/file-type-cpp'
import cssIcon from '@iconify-icons/vscode-icons/file-type-css'
import denoIcon from '@iconify-icons/vscode-icons/file-type-deno'
import dockerIcon from '@iconify-icons/vscode-icons/file-type-docker'
import dotenvIcon from '@iconify-icons/vscode-icons/file-type-dotenv'
import editorconfigIcon from '@iconify-icons/vscode-icons/file-type-editorconfig'
import elixirIcon from '@iconify-icons/vscode-icons/file-type-elixir'
import eslintIcon from '@iconify-icons/vscode-icons/file-type-eslint'
import excelIcon from '@iconify-icons/vscode-icons/file-type-excel'
import fontIcon from '@iconify-icons/vscode-icons/file-type-font'
import gitIcon from '@iconify-icons/vscode-icons/file-type-git'
import goIcon from '@iconify-icons/vscode-icons/file-type-go'
import graphqlIcon from '@iconify-icons/vscode-icons/file-type-graphql'
import haskellIcon from '@iconify-icons/vscode-icons/file-type-haskell'
import helmIcon from '@iconify-icons/vscode-icons/file-type-helm'
import htmlIcon from '@iconify-icons/vscode-icons/file-type-html'
import imageIcon from '@iconify-icons/vscode-icons/file-type-image'
import iniIcon from '@iconify-icons/vscode-icons/file-type-ini'
import javaIcon from '@iconify-icons/vscode-icons/file-type-java'
import javascriptIcon from '@iconify-icons/vscode-icons/file-type-js'
import jestIcon from '@iconify-icons/vscode-icons/file-type-jest'
import jsonIcon from '@iconify-icons/vscode-icons/file-type-json'
import kotlinIcon from '@iconify-icons/vscode-icons/file-type-kotlin'
import lessIcon from '@iconify-icons/vscode-icons/file-type-less'
import licenseIcon from '@iconify-icons/vscode-icons/file-type-license'
import logIcon from '@iconify-icons/vscode-icons/file-type-log'
import luaIcon from '@iconify-icons/vscode-icons/file-type-lua'
import makefileIcon from '@iconify-icons/vscode-icons/file-type-makefile'
import markdownIcon from '@iconify-icons/vscode-icons/file-type-markdown'
import mavenIcon from '@iconify-icons/vscode-icons/file-type-maven'
import nextIcon from '@iconify-icons/vscode-icons/file-type-next'
import nginxIcon from '@iconify-icons/vscode-icons/file-type-nginx'
import nodeIcon from '@iconify-icons/vscode-icons/file-type-node'
import npmIcon from '@iconify-icons/vscode-icons/file-type-npm'
import nuxtIcon from '@iconify-icons/vscode-icons/file-type-nuxt'
import pdfIcon from '@iconify-icons/vscode-icons/file-type-pdf2'
import perlIcon from '@iconify-icons/vscode-icons/file-type-perl'
import phpIcon from '@iconify-icons/vscode-icons/file-type-php'
import playrightIcon from '@iconify-icons/vscode-icons/file-type-playwright'
import pnpmIcon from '@iconify-icons/vscode-icons/file-type-pnpm'
import powershellIcon from '@iconify-icons/vscode-icons/file-type-powershell'
import prettierIcon from '@iconify-icons/vscode-icons/file-type-prettier'
import prismaIcon from '@iconify-icons/vscode-icons/file-type-prisma'
import protobufIcon from '@iconify-icons/vscode-icons/file-type-protobuf'
import pythonIcon from '@iconify-icons/vscode-icons/file-type-python'
import pythonConfigIcon from '@iconify-icons/vscode-icons/file-type-pythonconfig'
import rIcon from '@iconify-icons/vscode-icons/file-type-r'
import reactIcon from '@iconify-icons/vscode-icons/file-type-reactjs'
import rubyIcon from '@iconify-icons/vscode-icons/file-type-ruby'
import rustIcon from '@iconify-icons/vscode-icons/file-type-rust'
import sassIcon from '@iconify-icons/vscode-icons/file-type-sass'
import scssIcon from '@iconify-icons/vscode-icons/file-type-scss'
import shellIcon from '@iconify-icons/vscode-icons/file-type-shell'
import sqlIcon from '@iconify-icons/vscode-icons/file-type-sql'
import sqliteIcon from '@iconify-icons/vscode-icons/file-type-sqlite'
import svelteIcon from '@iconify-icons/vscode-icons/file-type-svelte'
import swiftIcon from '@iconify-icons/vscode-icons/file-type-swift'
import tailwindIcon from '@iconify-icons/vscode-icons/file-type-tailwind'
import terraformIcon from '@iconify-icons/vscode-icons/file-type-terraform'
import tomlIcon from '@iconify-icons/vscode-icons/file-type-toml'
import typescriptIcon from '@iconify-icons/vscode-icons/file-type-typescript'
import videoIcon from '@iconify-icons/vscode-icons/file-type-video'
import vitestIcon from '@iconify-icons/vscode-icons/file-type-vitest'
import vueIcon from '@iconify-icons/vscode-icons/file-type-vue'
import webpackIcon from '@iconify-icons/vscode-icons/file-type-webpack'
import wordIcon from '@iconify-icons/vscode-icons/file-type-word'
import xmlIcon from '@iconify-icons/vscode-icons/file-type-xml'
import yamlIcon from '@iconify-icons/vscode-icons/file-type-yaml'
import yarnIcon from '@iconify-icons/vscode-icons/file-type-yarn'
import zipIcon from '@iconify-icons/vscode-icons/file-type-zip'
import biomeIcon from '@iconify-icons/vscode-icons/file-type-biome'
import defaultFolderIcon from '@iconify-icons/vscode-icons/default-folder'
import defaultFolderOpenedIcon from '@iconify-icons/vscode-icons/default-folder-opened'
import apiFolderIcon from '@iconify-icons/vscode-icons/folder-type-api'
import botFolderIcon from '@iconify-icons/vscode-icons/folder-type-bot'
import clientFolderIcon from '@iconify-icons/vscode-icons/folder-type-client'
import commonFolderIcon from '@iconify-icons/vscode-icons/folder-type-common'
import configFolderIcon from '@iconify-icons/vscode-icons/folder-type-config'
import coverageFolderIcon from '@iconify-icons/vscode-icons/folder-type-coverage'
import distFolderIcon from '@iconify-icons/vscode-icons/folder-type-dist'
import docsFolderIcon from '@iconify-icons/vscode-icons/folder-type-docs'
import gitFolderIcon from '@iconify-icons/vscode-icons/folder-type-git'
import githubFolderIcon from '@iconify-icons/vscode-icons/folder-type-github'
import imagesFolderIcon from '@iconify-icons/vscode-icons/folder-type-images'
import logFolderIcon from '@iconify-icons/vscode-icons/folder-type-log'
import mysqlFolderIcon from '@iconify-icons/vscode-icons/folder-type-mysql'
import privateFolderIcon from '@iconify-icons/vscode-icons/folder-type-private'
import publicFolderIcon from '@iconify-icons/vscode-icons/folder-type-public'
import reduxFolderIcon from '@iconify-icons/vscode-icons/folder-type-redux'
import redisFolderIcon from '@iconify-icons/vscode-icons/folder-type-redis'
import serverFolderIcon from '@iconify-icons/vscode-icons/folder-type-server'
import servicesFolderIcon from '@iconify-icons/vscode-icons/folder-type-services'
import sourceFolderIcon from '@iconify-icons/vscode-icons/folder-type-src'
import testFolderIcon from '@iconify-icons/vscode-icons/folder-type-test'
import themeFolderIcon from '@iconify-icons/vscode-icons/folder-type-theme'
import toolsFolderIcon from '@iconify-icons/vscode-icons/folder-type-tools'
import cliFolderIcon from '@iconify-icons/vscode-icons/folder-type-cli'
import tempFolderIcon from '@iconify-icons/vscode-icons/folder-type-temp'
import vscodeFolderIcon from '@iconify-icons/vscode-icons/folder-type-vscode'
import { Braces, ChevronRight, ChevronsUpDown, CloudUpload, FileCode2, FileDiff, FilePlus2, FileText, FolderTree, RefreshCw, Save, Search, Sparkles, X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, Field, IconButton, Spinner, Splitter, Tabs, TreeView, createTreeCollection, toast, type ErrorNoticeAction, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { EmptyState } from '@/components/empty-state'
import { RemoteDiffDialog } from '@/components/remote-diff-dialog'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { graphiteCodeMirrorTheme } from '@/lib/codemirror-theme'
import { resolveNewFileDraft } from '@/lib/editor-new-file'
import { specialFileIconKey, type SpecialFileIconKey } from '@/lib/editor-icon-resolution'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { commitVolatileDraft, discardVolatileDraft, readVolatileDraft, restoreVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { editorStyles } from '@/theme/styles/editor'
import { confirmationDialogStyles } from '@/theme/styles/dialogs'
import { cx } from '../../styled-system/css'

type EditorPreview = 'image' | 'pdf' | 'csv' | 'markdown'
export type RemoteOpenRequest = { id: string; nonce: number }
export type EditorWorkbenchRequest =
  | { kind: 'open-file'; fileId: string; nonce: number }
  | { kind: 'focus-editor' | 'focus-explorer' | 'close-active' | 'next-tab' | 'previous-tab'; nonce: number }
export type EditorWorkbenchContext = {
  activeFileId: string | null
  activeFileName: string | null
  dirty: boolean
  source: 'workspace' | 'remote' | null
  selection: { fromLine: number; toLine: number } | null
}
type RemoteEditorFile = { file: RemoteTrackedFile; connectionTitle: string; binary: boolean }
type EditorTab = {
  id: string
  name: string
  content: string
  savedContent: string
  revision: number
  savedRevision: number
  instance: number
  source: 'workspace' | 'remote'
  diskRevision?: string
  restoredExternalConflict?: boolean
  preview?: EditorPreview
  remote?: RemoteEditorFile
}

type EditorFileConflict = { error: UserError; fileId: string; instance: number }
type EditorFailureRecovery =
  | { kind: 'compare-remote' }
  | { kind: 'create-file'; fileName: string }
  | { kind: 'load-directory'; directoryId: string; directoryName: string }
  | { kind: 'open-remote-file'; fileId: string }
  | { kind: 'open-workspace-file'; fileId: string }
  | { kind: 'refresh-explorer' }
  | { kind: 'save-all' }
  | { kind: 'save-file'; fileId: string }
  | { kind: 'upload-remote'; force: boolean }
type EditorFailure = { error: UserError; fileId?: string; recovery?: EditorFailureRecovery }
type ProjectEntryDialogState = {
  busy: boolean
  entryId: string
  entryKind: 'file' | 'directory'
  error: UserError | null
  mode: 'rename' | 'new-directory'
  value: string
}

type EditorTreeNode =
  | { kind: 'root'; value: 'editor:root'; name: string; children: EditorTreeNode[] }
  | { kind: 'file'; value: string; id: string; name: string }
  | { kind: 'directory'; value: string; id: string; name: string; loaded: boolean; children?: EditorTreeNode[] }
  | { kind: 'new-file'; value: string; name: string; directoryId: string }

type EditorCompartments = {
  fontSize: Compartment
  tabSize: Compartment
  wordWrap: Compartment
  documentMode: Compartment
}

type EditorStateOwner = {
  key: string
  tabId: string
  preview?: EditorPreview
}

type EditorScrollPosition = { left: number; top: number }
type EditorAutoSaveTimer = { timer: number; revision: number; instance: number }

const externalFileConflictCode = 'FILESYSTEM_EXTERNAL_CONFLICT'

function isExternalFileConflict(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && error.code === externalFileConflictCode) return true
  return normalizeUserError(error, { component: 'project-editor', operation: 'detect-file-conflict' }).code === externalFileConflictCode
}

function reportEditorFailure(error: unknown, options: Parameters<typeof normalizeUserError>[1]) {
  return reportUserError(normalizeUserError(error, { component: 'project-editor', ...options }))
}

const gitStatusWarningToastId = 'project-editor:git-status-warning'
const createdFileExplorerWarningToastId = 'project-editor:created-file-explorer-warning'

function showGitStatusWarning(
  error: unknown,
  options: Pick<NonNullable<Parameters<typeof normalizeUserError>[1]>, 'fallbackDescription' | 'operation' | 'title'>,
  onRefresh: () => void,
) {
  const incident = reportEditorFailure(error, {
    ...options,
    category: 'git',
    severity: 'warning',
  })
  toast.warning(incident.title, {
    action: { label: 'Aggiorna', onClick: onRefresh },
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    id: gitStatusWarningToastId,
  })
}

const editorStateCacheSuffixes = ['source', 'preview:image', 'preview:pdf', 'preview:csv', 'preview:markdown'] as const

function clearCachedEditorStateForFile<TState, TScroll>(fileId: string, states: Map<string, TState>, scrollPositions: Map<string, TScroll>) {
  for (const suffix of editorStateCacheSuffixes) {
    const key = `${fileId}::${suffix}`
    states.delete(key)
    scrollPositions.delete(key)
  }
}

function StartTreeNodeRenameEffect({ attempt, startRenaming, value }: { attempt: number; startRenaming: (value: string) => void; value: string }) {
  const started = useRef<string | null>(null)

  useLayoutEffect(() => {
    const key = `${value}:${attempt}`
    if (started.current === key) return
    started.current = key
    startRenaming(value)
  }, [attempt, startRenaming, value])

  return null
}

function StartTreeNodeRename({ attempt, value }: { attempt: number; value: string }) {
  return <TreeView.Context>{({ startRenaming }) => <StartTreeNodeRenameEffect attempt={attempt} startRenaming={startRenaming} value={value} />}</TreeView.Context>
}

const editorPanels: SplitterPanelData[] = [
  { id: 'editor-explorer', minSize: '220px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'editor-document', minSize: '420px' },
]

type Props = {
  workspace: string
  initialState?: WorkspaceSessionState['editor']
  remoteOpenRequest?: RemoteOpenRequest | null
  workbenchRequest?: EditorWorkbenchRequest | null
  onContextChange?: (context: EditorWorkbenchContext) => void
  onOpenGitDiff?: (fileId: string) => void
  onSendContextToAi?: (includeSelection: boolean) => void
  onSessionChange?: (state: WorkspaceSessionState['editor']) => void
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}

function remoteStateLabel(state: RemoteTrackedFile['localState']) {
  switch (state) {
    case 'synced': return 'Remoto · Sincronizzato'
    case 'modified': return 'Remoto · Modificato'
    case 'conflict': return 'Remoto · Conflitto'
    case 'offline': return 'Remoto · Offline'
  }
}

function previewKindForFile(fileName: string): EditorPreview | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension ?? '')) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'csv') return 'csv'
  if (extension === 'md') return 'markdown'
  return undefined
}

function parseCsvPreview(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (!quoted && character === separator) { rows.at(-1)!.push(cell); cell = '' } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      rows.at(-1)!.push(cell); cell = ''
      if (rows.length < 101) rows.push([])
    } else cell += character
  }
  if (rows.length <= 100) rows.at(-1)!.push(cell)
  return rows.filter((row) => row.some((value) => value.length > 0)).map((row) => row.slice(0, 30))
}

function appendMarkdownInline(parent: HTMLElement, text: string) {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g)
  for (const token of tokens) {
    if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code')
      code.textContent = token.slice(1, -1)
      parent.append(code)
    } else if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong')
      strong.textContent = token.slice(2, -2)
      parent.append(strong)
    } else if (token.startsWith('[')) {
      const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (!match) { parent.append(token); continue }
      const link = document.createElement('a')
      link.href = match[2]
      link.rel = 'noreferrer'
      link.target = '_blank'
      link.textContent = match[1]
      parent.append(link)
    } else parent.append(token)
  }
}

function renderMarkdownPreview(content: string) {
  const container = document.createElement('article')
  container.className = 'cm-markdown-preview'
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      while (index + 1 < lines.length && !lines[index + 1].startsWith('```')) codeLines.push(lines[++index])
      if (index + 1 < lines.length) index += 1
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = codeLines.join('\n')
      pre.append(code)
      container.append(pre)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const title = document.createElement(`h${heading[1].length}`)
      appendMarkdownInline(title, heading[2])
      container.append(title)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement('ul')
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        const item = document.createElement('li')
        appendMarkdownInline(item, lines[index].replace(/^[-*]\s+/, ''))
        list.append(item)
        index += 1
      }
      index -= 1
      container.append(list)
      continue
    }
    const quote = /^>\s?(.+)$/.exec(line)
    const paragraph = document.createElement(quote ? 'blockquote' : 'p')
    appendMarkdownInline(paragraph, quote ? quote[1] : line)
    container.append(paragraph)
  }
  return container
}

class MediaPreviewWidget extends WidgetType {
  private readonly preview: EditorPreview
  private readonly content: string

  constructor(preview: EditorPreview, content: string) {
    super()
    this.preview = preview
    this.content = content
  }

  eq(other: MediaPreviewWidget) {
    return this.preview === other.preview && this.content === other.content
  }

  toDOM() {
    const container = document.createElement('section')
    container.className = `cm-media-preview cm-media-preview-${this.preview}`
    if (this.preview === 'image') {
      const image = document.createElement('img')
      image.alt = 'Anteprima immagine'
      image.src = this.content
      container.append(image)
      return container
    }
    if (this.preview === 'pdf') {
      const frame = document.createElement('embed')
      frame.setAttribute('aria-label', 'Anteprima PDF')
      frame.src = this.content
      frame.type = 'application/pdf'
      container.append(frame)
      return container
    }
    if (this.preview === 'markdown') {
      container.append(renderMarkdownPreview(this.content))
      return container
    }
    const rows = parseCsvPreview(this.content)
    const table = document.createElement('table')
    const body = document.createElement('tbody')
    rows.forEach((row, rowIndex) => {
      const tableRow = document.createElement('tr')
      row.forEach((value) => {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td')
        cell.textContent = value
        tableRow.append(cell)
      })
      body.append(tableRow)
    })
    table.append(body)
    container.append(table)
    return container
  }
}

function mediaPreviewExtension(preview: EditorPreview, content: string) {
  const widget = new MediaPreviewWidget(preview, content)
  const decoration = (preview === 'csv' || preview === 'markdown') && content.length > 0
    ? Decoration.replace({ widget, block: true }).range(0, content.length)
    : Decoration.widget({ widget, block: true }).range(0)
  return EditorView.decorations.of(Decoration.set([decoration]))
}

function gitFileStatusLabel(file: GitFileStatus) {
  const codes = file.index === '?'
    ? ['?']
    : [file.index !== ' ' ? file.index : null, file.workingTree !== ' ' ? file.workingTree : null].filter(Boolean)
  const descriptions = [
    file.index !== ' ' && file.index !== '?' ? `staging: ${file.index}` : null,
    file.workingTree !== ' ' && file.index !== '?' ? `workspace: ${file.workingTree}` : null,
    file.index === '?' ? 'file non tracciato' : null,
  ].filter(Boolean)
  return { code: codes.join('/'), description: `Git — ${descriptions.join(' · ')}` }
}

function gitFileStatusClass(file: GitFileStatus) {
  const code = gitFileStatusLabel(file).code
  if (code.includes('?') || code.includes('A')) return editorStyles.gitStatusAdded
  if (code.includes('D')) return editorStyles.gitStatusDeleted
  if (code.includes('R') || code.includes('C')) return editorStyles.gitStatusRenamed
  return editorStyles.gitStatusModified
}

function remoteStatusClass(state: RemoteTrackedFile['localState']) {
  switch (state) {
    case 'synced': return editorStyles.remoteStatusSynced
    case 'modified': return editorStyles.remoteStatusModified
    case 'conflict': return editorStyles.remoteStatusConflict
    case 'offline': return editorStyles.remoteStatusOffline
  }
}

function gitStatusMap(status: GitStatus) {
  const next = new Map<string, GitFileStatus>()
  for (const file of status.files) {
    next.set(file.path, file)
    if (file.previousPath) next.set(file.previousPath, file)
  }
  return next
}

const FILE_NAME_ICONS: Record<string, typeof npmIcon> = {
  '.gitignore': gitIcon, '.prettierrc': prettierIcon, '.prettierignore': prettierIcon, '.eslintrc': eslintIcon,
  'dockerfile': dockerIcon, 'docker-compose.yml': dockerIcon, 'docker-compose.yaml': dockerIcon,
  'package.json': npmIcon, 'package-lock.json': npmIcon, 'yarn.lock': yarnIcon, 'pnpm-lock.yaml': pnpmIcon,
  'bun.lockb': bunIcon, 'tsconfig.json': typescriptIcon, 'vite.config.ts': nodeIcon, 'webpack.config.js': webpackIcon,
  'tailwind.config.js': tailwindIcon, 'tailwind.config.ts': tailwindIcon, 'eslint.config.js': eslintIcon,
  'jest.config.js': jestIcon, 'vitest.config.ts': vitestIcon, 'playwright.config.ts': playrightIcon,
  'makefile': makefileIcon, 'gradlew': mavenIcon, 'pom.xml': mavenIcon, '.npmrc': npmIcon, 'deno.json': denoIcon,
  'next.config.js': nextIcon, 'next.config.mjs': nextIcon, 'next.config.ts': nextIcon,
  'nuxt.config.js': nuxtIcon, 'nuxt.config.ts': nuxtIcon,
}

const FILE_EXTENSION_ICONS: Record<string, typeof npmIcon> = {
  ts: typescriptIcon, tsx: reactIcon, js: javascriptIcon, jsx: reactIcon, mjs: javascriptIcon, cjs: javascriptIcon,
  json: jsonIcon, md: markdownIcon, mdx: markdownIcon, html: htmlIcon, htm: htmlIcon, css: cssIcon, scss: scssIcon,
  sass: sassIcon, less: lessIcon, yml: yamlIcon, yaml: yamlIcon, toml: tomlIcon, ini: iniIcon, xml: xmlIcon,
  svg: xmlIcon, py: pythonIcon, java: javaIcon, c: cppIcon, h: cppIcon, cpp: cppIcon, hpp: cppIcon, cs: csharpIcon,
  go: goIcon, rs: rustIcon, php: phpIcon, rb: rubyIcon, swift: swiftIcon, kt: kotlinIcon, kts: kotlinIcon,
  sh: shellIcon, bash: shellIcon, zsh: shellIcon, fish: shellIcon, ps1: powershellIcon, sql: sqlIcon,
  gql: graphqlIcon, graphql: graphqlIcon, vue: vueIcon, svelte: svelteIcon, astro: astroIcon, lua: luaIcon,
  r: rIcon, pl: perlIcon, hs: haskellIcon, ex: elixirIcon, exs: elixirIcon, clj: clojureIcon, prisma: prismaIcon,
  tf: terraformIcon, tfvars: terraformIcon, helm: helmIcon, ansible: ansibleIcon, nginx: nginxIcon,
  zip: zipIcon, tar: zipIcon, gz: zipIcon, pdf: pdfIcon, xlsx: excelIcon, xls: excelIcon, docx: wordIcon,
  doc: wordIcon, ttf: fontIcon, otf: fontIcon, woff: fontIcon, mp3: audioIcon, wav: audioIcon, mp4: videoIcon,
  mov: videoIcon, png: imageIcon, jpg: imageIcon, jpeg: imageIcon, gif: imageIcon, webp: imageIcon, ico: imageIcon,
}

const SPECIAL_FILE_ICONS: Record<SpecialFileIconKey, typeof npmIcon> = {
  biome: biomeIcon,
  cargo: rustIcon,
  certificate: certIcon,
  composer: phpIcon,
  docker: dockerIcon,
  dotenv: dotenvIcon,
  editorconfig: editorconfigIcon,
  license: licenseIcon,
  log: logIcon,
  protobuf: protobufIcon,
  'python-config': pythonConfigIcon,
  shell: shellIcon,
  sqlite: sqliteIcon,
}

const FOLDER_ICONS: Record<string, typeof sourceFolderIcon> = {
  '.agents': botFolderIcon, '.codex': botFolderIcon, '.secrets': privateFolderIcon, '.worktrees': gitFolderIcon,
  src: sourceFolderIcon, source: sourceFolderIcon, app: sourceFolderIcon, client: clientFolderIcon, server: serverFolderIcon,
  api: apiFolderIcon, services: servicesFolderIcon, service: servicesFolderIcon, test: testFolderIcon, tests: testFolderIcon,
  spec: testFolderIcon, specs: testFolderIcon, '__tests__': testFolderIcon, assets: imagesFolderIcon, images: imagesFolderIcon,
  img: imagesFolderIcon, public: publicFolderIcon, static: publicFolderIcon, docs: docsFolderIcon, documentation: docsFolderIcon,
  config: configFolderIcon, configs: configFolderIcon, '.github': githubFolderIcon, '.git': gitFolderIcon, '.vscode': vscodeFolderIcon,
  dist: distFolderIcon, build: distFolderIcon, out: distFolderIcon, store: reduxFolderIcon, redux: reduxFolderIcon,
  theme: themeFolderIcon, themes: themeFolderIcon, styles: themeFolderIcon, coverage: coverageFolderIcon, 'graphify-out': toolsFolderIcon,
  logs: logFolderIcon, scripts: cliFolderIcon, tmp: tempFolderIcon, database: mysqlFolderIcon, mssql: mysqlFolderIcon, redis: redisFolderIcon,
  websocket: apiFolderIcon, common: commonFolderIcon, constants: configFolderIcon, errors: privateFolderIcon, mcp: toolsFolderIcon,
  types: toolsFolderIcon, utils: toolsFolderIcon, fixtures: testFolderIcon, helpers: toolsFolderIcon, integration: testFolderIcon,
  unit: testFolderIcon, load: testFolderIcon, shell: cliFolderIcon, security: privateFolderIcon, auth: privateFolderIcon,
  monitoring: logFolderIcon, observability: logFolderIcon, resilience: sourceFolderIcon, risk: privateFolderIcon,
}

function fileIconFor(fileName: string) {
  const lowerName = fileName.toLowerCase()
  const specialIcon = specialFileIconKey(lowerName)
  return (specialIcon ? SPECIAL_FILE_ICONS[specialIcon] : null) ?? FILE_NAME_ICONS[lowerName] ?? FILE_EXTENSION_ICONS[lowerName.split('.').pop() ?? ''] ?? null
}

function folderIconFor(folderName: string) {
  return FOLDER_ICONS[folderName.toLowerCase()] ?? null
}

function languageForFile(fileName: string) {
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

function languageLabelFor(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const labels: Record<string, string> = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', json: 'JSON', md: 'Markdown', mdx: 'MDX', html: 'HTML', css: 'CSS', scss: 'SCSS', yml: 'YAML', yaml: 'YAML', sh: 'Shell', sql: 'SQL', py: 'Python' }
  return labels[extension ?? ''] ?? 'Testo'
}

function previewLabelFor(preview: EditorPreview | undefined, fileName: string) {
  if (preview === 'image') return 'Immagine'
  if (preview === 'pdf') return 'PDF'
  if (preview === 'csv') return 'Tabella CSV'
  if (preview === 'markdown') return 'Markdown'
  return languageLabelFor(fileName)
}

function editorStateKey(tab: EditorTab) {
  return `${tab.id}::${tab.preview ? `preview:${tab.preview}` : 'source'}`
}

function editorDraftIdentity(workspace: string, source: EditorTab['source'], tabId: string): VolatileDraftIdentity {
  return { scope: 'project-editor', workspace, resource: JSON.stringify([source, tabId]) }
}

function sessionFileRef(tab: EditorTab): WorkspaceSessionFileRef {
  return {
    source: tab.source,
    id: tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id,
    mode: tab.preview ? 'preview' : 'source',
  }
}

function editorDocumentForTab(tab: EditorTab) {
  return tab.preview === 'image' || tab.preview === 'pdf' ? '' : tab.content
}

function toEditorTreeNodes(entries: ProjectFileTreeNode[], draftDirectoryId?: string, draftName = ''): EditorTreeNode[] {
  return entries.map((entry): EditorTreeNode => {
    if (entry.kind === 'file') return { kind: 'file', value: entry.id, id: entry.id, name: entry.name }
    const children = entry.children?.length ? toEditorTreeNodes(entry.children, draftDirectoryId, draftName) : []
    if (draftDirectoryId === entry.id) children.unshift({ kind: 'new-file', value: `editor:new-file:${entry.id}`, name: draftName, directoryId: entry.id })
    return { kind: 'directory', value: entry.id, id: entry.id, name: entry.name, loaded: entry.children !== undefined, children }
  })
}

function replaceDirectoryChildren(entries: ProjectFileTreeNode[], directoryId: string, children: ProjectFileTreeNode[]): ProjectFileTreeNode[] {
  return entries.map((entry) => {
    if (entry.id === directoryId) return { ...entry, children }
    return entry.children ? { ...entry, children: replaceDirectoryChildren(entry.children, directoryId, children) } : entry
  })
}

function remapProjectPath(value: string, previousId: string, nextId: string) {
  return value === previousId ? nextId : value.startsWith(`${previousId}/`) ? `${nextId}${value.slice(previousId.length)}` : value
}

function projectEntryContainsPath(entryId: string, entryKind: 'file' | 'directory', candidate: string) {
  return candidate === entryId || (entryKind === 'directory' && (entryId === '' || candidate.startsWith(`${entryId}/`)))
}

function projectEntriesOverlap(leftId: string, leftKind: 'file' | 'directory', rightId: string, rightKind: 'file' | 'directory') {
  return projectEntryContainsPath(leftId, leftKind, rightId) || projectEntryContainsPath(rightId, rightKind, leftId)
}

function renameProjectTreeEntry(entries: ProjectFileTreeNode[], previousId: string, nextId: string): ProjectFileTreeNode[] {
  return entries.map((entry) => {
    if (entry.id === previousId || entry.id.startsWith(`${previousId}/`)) {
      const id = remapProjectPath(entry.id, previousId, nextId)
      return {
        ...entry,
        id,
        ...(entry.id === previousId ? { name: nextId.split('/').at(-1) ?? entry.name } : {}),
        ...(entry.children ? { children: renameProjectTreeEntry(entry.children, previousId, nextId) } : {}),
      }
    }
    return entry.children ? { ...entry, children: renameProjectTreeEntry(entry.children, previousId, nextId) } : entry
  })
}

function removeProjectTreeEntry(entries: ProjectFileTreeNode[], entryId: string): ProjectFileTreeNode[] {
  return entries
    .filter((entry) => entry.id !== entryId)
    .map((entry) => entry.children ? { ...entry, children: removeProjectTreeEntry(entry.children, entryId) } : entry)
}

function mergeRefreshedProjectEntries(current: ProjectFileTreeNode[], refreshed: ProjectFileTreeNode[]) {
  const currentById = new Map(current.map((entry) => [entry.id, entry]))
  return refreshed.map((entry) => {
    const existing = currentById.get(entry.id)
    return entry.kind === 'directory' && existing?.kind === 'directory' && existing.children
      ? { ...entry, children: existing.children }
      : entry
  })
}

function findProjectTreeEntry(entries: ProjectFileTreeNode[], entryId: string): ProjectFileTreeNode | undefined {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    const nested = entry.children && findProjectTreeEntry(entry.children, entryId)
    if (nested) return nested
  }
  return undefined
}

function filterEditorTree(entries: ProjectFileTreeNode[], query: string): ProjectFileTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('it-IT')
  if (!normalizedQuery) return entries
  return entries.flatMap((entry) => {
    if (entry.kind === 'file') return entry.name.toLocaleLowerCase('it-IT').includes(normalizedQuery) ? [entry] : []
    const children = entry.children ? filterEditorTree(entry.children, normalizedQuery) : undefined
    return entry.name.toLocaleLowerCase('it-IT').includes(normalizedQuery) || (children?.length ?? 0) > 0 ? [{ ...entry, children }] : []
  })
}

function createEditorSearchPanel(view: EditorView) {
  const dom = document.createElement('form')
  dom.className = 'editor-search-panel'
  dom.setAttribute('aria-label', 'Cerca e sostituisci nel file')

  const createInput = (placeholder: string, mainField = false) => {
    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = placeholder
    if (mainField) input.setAttribute('main-field', 'true')
    return input
  }
  const createButton = (label: string, symbol: string, action: () => void) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = symbol
    button.addEventListener('click', action)
    return button
  }
  const createToggle = (label: string, symbol: string) => {
    const labelElement = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('aria-label', label)
    labelElement.title = label
    labelElement.append(input, document.createTextNode(symbol))
    return input
  }

  const searchInput = createInput('Cerca', true)
  const replaceInput = createInput('Sostituisci')
  const caseSensitive = createToggle('Distingui maiuscole', 'Aa')
  const regexp = createToggle('Espressione regolare', '.*')
  const wholeWord = createToggle('Parola intera', 'Ab')
  const applyQuery = () => {
    const previous = getSearchQuery(view.state)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: searchInput.value, replace: replaceInput.value, caseSensitive: caseSensitive.checked, regexp: regexp.checked, wholeWord: wholeWord.checked, literal: previous.literal })) })
  }
  const run = (command: (target: EditorView) => boolean) => {
    applyQuery()
    command(view)
    view.focus()
  }
  const syncQuery = () => {
    const query = getSearchQuery(view.state)
    searchInput.value = query.search
    replaceInput.value = query.replace
    caseSensitive.checked = query.caseSensitive
    regexp.checked = query.regexp
    wholeWord.checked = query.wholeWord
  }

  searchInput.addEventListener('input', applyQuery)
  replaceInput.addEventListener('input', applyQuery)
  for (const toggle of [caseSensitive, regexp, wholeWord]) toggle.addEventListener('change', applyQuery)
  dom.addEventListener('submit', (event) => { event.preventDefault(); run(findNext) })
  dom.append(searchInput, createButton('Risultato precedente', 'Precedente', () => run(findPrevious)), createButton('Risultato successivo', 'Successivo', () => run(findNext)), replaceInput, createButton('Sostituisci risultato', 'Sostituisci', () => run(replaceNext)), createButton('Sostituisci tutti i risultati', 'Tutti', () => run(replaceAll)), caseSensitive.parentElement!, regexp.parentElement!, wholeWord.parentElement!, createButton('Chiudi ricerca', 'Chiudi', () => { closeSearchPanel(view); view.focus() }))

  return { dom, top: true, mount: () => searchInput.focus(), update: syncQuery }
}

export function ProjectEditor({ workspace, initialState, remoteOpenRequest = null, workbenchRequest = null, onContextChange, onOpenGitDiff, onSendContextToAi, onSessionChange, onWorkspaceGuardChange }: Props) {
  const { preferences } = useAppPreferences()
  const editorFontSize = effectivePreference(preferences, 'editor.fontSize', 13)
  const editorTabSize = effectivePreference(preferences, 'editor.tabSize', 2)
  const editorWordWrap = effectivePreference(preferences, 'editor.wordWrap', true)
  const editorAutoSave = effectivePreference(preferences, 'editor.autoSave', false)
  const explorerWidth = effectivePreference(preferences, 'editor.explorerWidth', 320)
  const editorHost = useRef<HTMLDivElement>(null)
  const explorerTree = useRef<HTMLDivElement>(null)
  const editorView = useRef<EditorView | null>(null)
  const editorCompartments = useRef<EditorCompartments>({ fontSize: new Compartment(), tabSize: new Compartment(), wordWrap: new Compartment(), documentMode: new Compartment() })
  const editorBaseExtensions = useRef<Extension[] | null>(null)
  const editorStates = useRef(new Map<string, EditorState>())
  const editorScrollPositions = useRef(new Map<string, EditorScrollPosition>())
  const activeEditorStateOwner = useRef<EditorStateOwner | null>(null)
  const emptyEditorState = useRef<EditorState | null>(null)
  const editorScrollRestoreKey = useRef({})
  const saveActiveRef = useRef<() => Promise<void>>(async () => undefined)
  const tabsRef = useRef<EditorTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  const workspaceRef = useRef(workspace)
  const editorAlive = useRef(true)
  const activationIntent = useRef(0)
  const nextTabInstance = useRef(0)
  const openFileRequests = useRef(new Map<string, Promise<EditorTab>>())
  const activeProjectIdentityMutations = useRef(new Map<string, { entryId: string; entryKind: 'file' | 'directory' }>())
  const saveJobs = useRef(new Map<string, Promise<void>>())
  const savingCounts = useRef(new Map<string, number>())
  const autoSaveTimers = useRef(new Map<string, EditorAutoSaveTimer>())
  const fileRecoveryIds = useRef(new Set<string>())
  const fileConflictsRef = useRef(new Map<string, EditorFileConflict>())
  const [tree, setTree] = useState<ProjectFileTreeNode[]>([])
  const [gitStatusByPath, setGitStatusByPath] = useState<Map<string, GitFileStatus>>(new Map())
  const [explorerQuery, setExplorerQuery] = useState('')
  const [newFileName, setNewFileName] = useState<string | null>(null)
  const [newFileRenameAttempt, setNewFileRenameAttempt] = useState(0)
  const [creatingFile, setCreatingFile] = useState(false)
  const newFileTrigger = useRef<HTMLButtonElement>(null)
  const projectEntryDialogInput = useRef<HTMLInputElement>(null)
  const projectEntryDialogOpener = useRef<HTMLElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ fromLine: number; toLine: number } | null>(null)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [sessionRestoreReady, setSessionRestoreReady] = useState(() => !initialState)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [loadingDirectory, setLoadingDirectory] = useState<string | null>(null)
  const [refreshingExplorer, setRefreshingExplorer] = useState(false)
  const [savingFileIds, setSavingFileIds] = useState<Set<string>>(new Set())
  const [fileConflicts, setFileConflicts] = useState<Map<string, EditorFileConflict>>(new Map())
  const [explorerFailure, setExplorerFailure] = useState<EditorFailure | null>(null)
  const [documentFailure, setDocumentFailure] = useState<EditorFailure | null>(null)
  const [remoteComparison, setRemoteComparison] = useState<RemoteCompareResult | null>(null)
  const [remoteDiffFile, setRemoteDiffFile] = useState<RemoteTrackedFile | null>(null)
  const [uploadingRemote, setUploadingRemote] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [projectEntryDialog, setProjectEntryDialog] = useState<ProjectEntryDialogState | null>(null)
  const loadingDirectories = useRef(new Set<string>())
  const restoredSession = useRef<WorkspaceSessionState['editor'] | null>(null)
  const restoringSession = useRef(false)
  const pendingEditorFocus = useRef(false)

  useLayoutEffect(() => {
    if (workspaceRef.current === workspace) return
    workspaceRef.current = workspace
    activationIntent.current += 1
    for (const pending of autoSaveTimers.current.values()) window.clearTimeout(pending.timer)
    autoSaveTimers.current.clear()
    activeProjectIdentityMutations.current.clear()
    fileRecoveryIds.current.clear()
    fileConflictsRef.current = new Map()
    setFileConflicts(new Map())
    setExplorerFailure(null)
    setDocumentFailure(null)
  }, [workspace])

  useEffect(() => {
    editorAlive.current = true
    return () => {
      editorAlive.current = false
      activationIntent.current += 1
    }
  }, [])

  const focusEditorTarget = useCallback(() => {
    const view = editorView.current
    if (!view || view.dom.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    view.focus()
    if (view.hasFocus) return true

    // Le anteprime read-only (per esempio Markdown) non espongono un contentDOM
    // editabile: il tab attivo è il fallback operativo e mantiene la tastiera
    // dentro l'Editor invece di restituirla all'Explorer.
    const editorSurface = editorHost.current?.closest<HTMLElement>('[aria-label="Editor progetto"]')
    const activeTabTrigger = editorSurface?.querySelector<HTMLElement>('[aria-label="File aperti"] [role="tab"][aria-selected="true"]')
    activeTabTrigger?.focus()
    return document.activeElement === activeTabTrigger
  }, [])

  const focusEditor = useCallback(() => {
    pendingEditorFocus.current = true
    requestAnimationFrame(() => {
      if (focusEditorTarget()) pendingEditorFocus.current = false
    })
  }, [focusEditorTarget])

  const focusExplorer = useCallback(() => {
    requestAnimationFrame(() => {
      const tree = explorerTree.current
      const target = tree?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? tree
      target?.focus()
    })
  }, [])

  const refreshGitStatus = useCallback(async () => {
    const result = await window.vincodeLab.github.gitStatus({ force: true })
    setGitStatusByPath(gitStatusMap(result.data))
    toast.remove(gitStatusWarningToastId)
  }, [])

  const refreshGitStatusFromWarning = useCallback(() => {
    const retry = () => {
      void refreshGitStatus().then(() => {
        toast.success('Stato Git aggiornato.')
      }).catch((error) => {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status',
          title: 'Stato Git non aggiornato',
          fallbackDescription: 'L’Explorer resta operativo. Verifica il repository e riprova ad aggiornare gli indicatori Git.',
        }, retry)
      })
    }
    retry()
  }, [refreshGitStatus])

  const clearFileConflict = useCallback((fileId: string, instance: number) => {
    const current = fileConflictsRef.current.get(fileId)
    if (!current || current.instance !== instance) return
    const next = new Map(fileConflictsRef.current)
    next.delete(fileId)
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [])

  const recordFileConflict = useCallback((tab: EditorTab, cause: unknown) => {
    if (!editorAlive.current || workspaceRef.current !== workspace || tab.source !== 'workspace') return
    const incident = reportUserError(normalizeUserError(cause, {
      category: 'conflict',
      code: externalFileConflictCode,
      component: 'project-editor',
      operation: 'save-workspace-file',
      severity: 'warning',
      title: 'File modificato sul disco',
      description: `Impossibile salvare “${tab.name}” perché il file sul disco è cambiato o è stato rimosso. Le modifiche locali sono al sicuro. Scegli se ricaricare dal disco o sovrascrivere il file.`,
    }))
    const next = new Map(fileConflictsRef.current)
    next.set(tab.id, { error: incident, fileId: tab.id, instance: tab.instance })
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [workspace])

  const recordConflictRecoveryFailure = useCallback((tab: EditorTab, cause: unknown, operation: string, title: string, description: string) => {
    if (!editorAlive.current || workspaceRef.current !== workspace) return
    const incident = reportUserError(normalizeUserError(cause, {
      category: 'filesystem',
      component: 'project-editor',
      operation,
      title,
      description,
    }))
    const next = new Map(fileConflictsRef.current)
    next.set(tab.id, { error: incident, fileId: tab.id, instance: tab.instance })
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [workspace])

  const saveEditorTab = useCallback(async (tab: EditorTab, force = false) => {
    const requestWorkspace = workspace
    const remoteFile = tab.source === 'remote' && tab.remote
      ? await window.vincodeLab.remoteFiles.saveLocal(tab.remote.file.id, tab.content)
      : null
    const savedFile = !remoteFile
      ? await window.vincodeLab.files.save(tab.id, tab.content, force ? { force: true } : { revision: tab.diskRevision })
      : null

    if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
    const currentTab = tabsRef.current.find((entry) => entry.id === tab.id && entry.instance === tab.instance)
    if (!currentTab) return
    const saveStillMatchesDocument = currentTab.content === tab.content
    const next = tabsRef.current.map((entry) => entry.id === tab.id && entry.instance === tab.instance
      ? {
          ...entry,
          savedContent: tab.content,
          savedRevision: tab.revision,
          ...(savedFile ? { diskRevision: savedFile.revision } : {}),
          ...(remoteFile && entry.remote ? { remote: { ...entry.remote, file: remoteFile } } : {}),
        }
      : entry)
    tabsRef.current = next
    setTabs(next)
    setDocumentFailure((current) => current?.fileId === tab.id ? null : current)
    clearFileConflict(tab.id, tab.instance)
    if (saveStillMatchesDocument) commitVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id), tab.content)
    else writeVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id), currentTab.content, tab.content)

    if (tab.source === 'workspace') {
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-save',
          title: 'File salvato, stato Git non aggiornato',
          fallbackDescription: 'Il file è al sicuro. Gli indicatori Git potrebbero essere obsoleti; aggiornali quando sei pronto.',
        }, refreshGitStatusFromWarning)
      }
    }
    toast.success(remoteFile ? 'Copia locale salvata.' : 'File salvato.', { description: remoteFile ? remoteFile.remotePath : tab.id })
  }, [clearFileConflict, refreshGitStatus, refreshGitStatusFromWarning, workspace])

  const saveEditorTabById = useCallback((fileId: string, options: { force?: boolean } = {}) => {
    if (fileRecoveryIds.current.has(fileId)) return Promise.resolve()
    const tab = tabsRef.current.find((entry) => entry.id === fileId)
    if (!tab) return Promise.resolve()
    const pendingConflict = fileConflictsRef.current.get(fileId)
    if (tab.content === tab.savedContent && !(options.force && pendingConflict?.instance === tab.instance)) return Promise.resolve()
    if (!options.force && pendingConflict?.instance === tab.instance) {
      return Promise.reject(Object.assign(new Error('Risolvi il conflitto del file prima di salvarlo.'), { code: externalFileConflictCode }))
    }
    const jobKey = `${workspace}\0${fileId}\0${tab.instance}`
    const currentJob = saveJobs.current.get(jobKey)
    if (currentJob) return currentJob

    const pendingTimer = autoSaveTimers.current.get(fileId)
    if (pendingTimer) window.clearTimeout(pendingTimer.timer)
    autoSaveTimers.current.delete(fileId)
    savingCounts.current.set(fileId, (savingCounts.current.get(fileId) ?? 0) + 1)
    setSavingFileIds((current) => new Set(current).add(fileId))
    const job = saveEditorTab(tab, options.force === true).catch((error) => {
      if (isExternalFileConflict(error)) recordFileConflict(tab, error)
      throw error
    })
    saveJobs.current.set(jobKey, job)
    const finish = () => {
      if (saveJobs.current.get(jobKey) === job) saveJobs.current.delete(jobKey)
      const remainingSaves = Math.max(0, (savingCounts.current.get(fileId) ?? 1) - 1)
      if (remainingSaves > 0) savingCounts.current.set(fileId, remainingSaves)
      else savingCounts.current.delete(fileId)
      if (!editorAlive.current) return
      setSavingFileIds((current) => {
        if (remainingSaves > 0 || !current.has(fileId)) return current
        const next = new Set(current)
        next.delete(fileId)
        return next
      })
    }
    void job.then(finish, finish)
    return job
  }, [recordFileConflict, saveEditorTab, workspace])

  const saveActive = useCallback(async () => {
    const fileId = activeIdRef.current
    if (!fileId) return
    try {
      await saveEditorTabById(fileId)
    } catch (error) {
      if (isExternalFileConflict(error)) return
      const tab = tabsRef.current.find((entry) => entry.id === fileId)
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'save-file',
          title: 'File non salvato',
          fallbackDescription: `Le modifiche${tab ? ` a “${tab.name}”` : ''} sono rimaste nell’Editor. Verifica che il file sia accessibile e riprova.`,
        }),
        fileId,
        recovery: { kind: 'save-file', fileId },
      })
    }
  }, [saveEditorTabById])
  saveActiveRef.current = saveActive

  const saveAll = useCallback(async () => {
    const dirtyFileIds = tabsRef.current.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.id)
    try {
      for (const fileId of dirtyFileIds) {
        while (true) {
          const current = tabsRef.current.find((tab) => tab.id === fileId)
          if (!current || current.content === current.savedContent) break
          await saveEditorTabById(fileId)
        }
      }
      setDocumentFailure((current) => current?.error.operation === 'save-files-before-workspace-change' ? null : current)
    } catch (error) {
      if (isExternalFileConflict(error)) throw error
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: 'save-files-before-workspace-change',
        title: 'File non salvati',
        fallbackDescription: 'Il cambio di workspace o la chiusura è stato annullato. Le modifiche restano aperte nell’Editor e puoi riprovare il salvataggio.',
      })
      setDocumentFailure({ error: incident, recovery: { kind: 'save-all' } })
      throw error
    }
  }, [saveEditorTabById])

  const discardAll = useCallback(async () => {
    const requestWorkspace = workspace
    const discardedTabs = tabsRef.current
      .filter((tab) => tab.content !== tab.savedContent)
      .map((tab) => {
        const jobKey = `${workspace}\0${tab.id}\0${tab.instance}`
        const pendingJob = saveJobs.current.get(jobKey)
        return {
          id: tab.id,
          instance: tab.instance,
          savedContent: tab.savedContent,
          diskRevision: tab.diskRevision,
          source: tab.source,
          remoteFileId: tab.remote?.file.id,
          pendingJob,
        }
      })

    for (const tab of discardedTabs) {
      const pendingTimer = autoSaveTimers.current.get(tab.id)
      if (pendingTimer) window.clearTimeout(pendingTimer.timer)
      autoSaveTimers.current.delete(tab.id)
    }

    try {
      const restoredRemoteFiles = new Map<string, RemoteTrackedFile>()
      const restoredProjectRevisions = new Map<string, string>()
      await Promise.all(discardedTabs.map(async (tab) => {
        if (!tab.pendingJob) return
        await tab.pendingJob.catch(() => {
          // Lo scarto sostituisce comunque il contenuto con l'ultima baseline salvata;
          // il failure della write concorrente non deve oscurare questa recovery.
        })
        if (!editorAlive.current || workspaceRef.current !== requestWorkspace) throw new Error('Il workspace è cambiato durante il ripristino.')
        if (tab.source === 'remote') {
          if (!tab.remoteFileId) throw new Error('Copia remota non disponibile per il ripristino.')
          restoredRemoteFiles.set(tab.id, await window.vincodeLab.remoteFiles.saveLocal(tab.remoteFileId, tab.savedContent))
          return
        }
        const current = tabsRef.current.find((entry) => entry.id === tab.id && entry.instance === tab.instance)
        const revision = current?.diskRevision ?? tab.diskRevision
        const saved = await window.vincodeLab.files.save(tab.id, tab.savedContent, { revision })
        restoredProjectRevisions.set(tab.id, saved.revision)
      }))

      if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
      for (const tab of discardedTabs) {
        discardVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id))
      }
      const discardedById = new Map(discardedTabs.map((tab) => [tab.id, tab]))
      const next = tabsRef.current.map((tab) => {
        const discarded = discardedById.get(tab.id)
        if (!discarded || tab.instance !== discarded.instance) return tab
        const restoredRemoteFile = restoredRemoteFiles.get(tab.id)
        return {
          ...tab,
          content: discarded.savedContent,
          savedContent: discarded.savedContent,
          revision: tab.revision + 1,
          savedRevision: tab.revision + 1,
          ...(restoredProjectRevisions.has(tab.id) ? { diskRevision: restoredProjectRevisions.get(tab.id) } : {}),
          ...(restoredRemoteFile && tab.remote ? { remote: { ...tab.remote, file: restoredRemoteFile } } : {}),
        }
      })
      tabsRef.current = next
      setTabs(next)
      setDocumentFailure((current) => current?.error.operation === 'discard-files-before-workspace-change' ? null : current)
    } catch (error) {
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: 'discard-files-before-workspace-change',
        title: 'Bozze non ripristinate',
        fallbackDescription: 'Il cambio di workspace o la chiusura è stato annullato. Le modifiche restano aperte nell’Editor; puoi salvarle prima di riprovare.',
      })
      setDocumentFailure({ error: incident, recovery: { kind: 'save-all' } })
      throw error
    }
  }, [workspace])

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => tabsRef.current.some((tab) => tab.content !== tab.savedContent),
      saveAll,
      discardAll,
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [discardAll, onWorkspaceGuardChange, saveAll])

  const refreshExplorer = useCallback(async (quiet = false) => {
    setRefreshingExplorer(true)
    try {
      const result = await window.vincodeLab.files.list()
      setTree(result.entries)
      setTruncated(result.truncated)
      toast.remove(createdFileExplorerWarningToastId)
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-explorer',
          title: 'Explorer aggiornato, stato Git non disponibile',
          fallbackDescription: 'L’elenco dei file è aggiornato. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
      setExpanded(new Set())
      setSelectedDirectoryId(null)
      setExplorerFailure(null)
      if (!quiet) toast.success('Explorer aggiornato.')
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'refresh-explorer',
          title: 'Explorer non aggiornato',
          fallbackDescription: 'I file già aperti restano disponibili. Verifica l’accesso al workspace e riprova.',
        }),
        recovery: { kind: 'refresh-explorer' },
      })
    } finally {
      setRefreshingExplorer(false)
    }
  }, [refreshGitStatus, refreshGitStatusFromWarning])

  useEffect(() => {
    let active = true
    void window.vincodeLab.files.list().then((result) => {
      if (!active) return
      setTree(result.entries)
      setTruncated(result.truncated)
    }).catch((error) => {
      if (active) setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'load-explorer',
          title: 'Explorer non disponibile',
          fallbackDescription: 'L’Editor resta operativo per i file già aperti. Verifica l’accesso al workspace e riprova.',
        }),
        recovery: { kind: 'refresh-explorer' },
      })
    })
    // Rinvia il refresh Git: evita un aggiornamento di stato sincrono durante il montaggio della vista.
    void Promise.resolve().then(refreshGitStatus).catch((error) => {
      if (!active) return
      // Lo stato Git è un arricchimento dell'Explorer: i file restano pienamente operativi.
      showGitStatusWarning(error, {
        operation: 'load-git-status',
        title: 'Stato Git non disponibile',
        fallbackDescription: 'L’Explorer resta operativo senza indicatori Git.',
      }, refreshGitStatusFromWarning)
    })
    return () => { active = false }
  }, [refreshGitStatus, refreshGitStatusFromWarning])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const saving = Boolean(activeId && savingFileIds.has(activeId))
  const activeFileConflict = activeTab ? fileConflicts.get(activeTab.id) : undefined

  useEffect(() => {
    if (!pendingEditorFocus.current || !activeId || activeTab?.remote?.binary) return
    const frame = requestAnimationFrame(() => {
      if (focusEditorTarget()) pendingEditorFocus.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, activeTab?.remote?.binary, focusEditorTarget])

  const tabSessionSignature = useMemo(() => tabs.map((tab) => {
    const file = sessionFileRef(tab)
    return `${file.source}:${file.id}:${file.mode}`
  }).join('\0'), [tabs])
  const canToggleTextPreview = activeTab?.preview === 'csv' || activeTab?.preview === 'markdown' || previewKindForFile(activeTab?.name ?? '') === 'csv' || previewKindForFile(activeTab?.name ?? '') === 'markdown'

  useEffect(() => {
    onContextChange?.({
      activeFileId: activeTab?.id ?? null,
      activeFileName: activeTab?.name ?? null,
      dirty: Boolean(activeTab && activeTab.content !== activeTab.savedContent),
      source: activeTab?.source ?? null,
      selection: activeTab && !activeTab.preview && !activeTab.remote?.binary ? selection : null,
    })
  }, [activeTab, onContextChange, selection])

  useEffect(() => {
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
    for (const [fileId, pending] of autoSaveTimers.current) {
      const tab = tabsById.get(fileId)
      const conflict = fileConflicts.get(fileId)
      if (editorAutoSave && tab && !conflict && tab.content !== tab.savedContent && tab.instance === pending.instance && tab.revision === pending.revision) continue
      window.clearTimeout(pending.timer)
      autoSaveTimers.current.delete(fileId)
    }
    if (!editorAutoSave) return

    for (const tab of tabs) {
      const conflict = fileConflicts.get(tab.id)
      if (tab.content === tab.savedContent || autoSaveTimers.current.has(tab.id) || conflict?.instance === tab.instance) continue
      const pending = {
        instance: tab.instance,
        revision: tab.revision,
        timer: window.setTimeout(() => {
          const scheduled = autoSaveTimers.current.get(tab.id)
          if (!scheduled || scheduled.instance !== tab.instance || scheduled.revision !== tab.revision) return
          autoSaveTimers.current.delete(tab.id)
          const current = tabsRef.current.find((entry) => entry.id === tab.id)
          if (!current || current.instance !== tab.instance || current.revision !== tab.revision || current.content === current.savedContent) return
          void saveEditorTabById(tab.id).catch((error) => {
            if (isExternalFileConflict(error)) return
            setDocumentFailure({
              error: reportEditorFailure(error, {
                category: 'filesystem',
                operation: 'auto-save-file',
                title: 'Salvataggio automatico non completato',
                fallbackDescription: `Le modifiche a “${tab.name}” sono rimaste nell’Editor. Salva manualmente quando il file torna accessibile.`,
              }),
              fileId: tab.id,
              recovery: { kind: 'save-file', fileId: tab.id },
            })
          })
        }, 700),
      }
      autoSaveTimers.current.set(tab.id, pending)
    }
  }, [editorAutoSave, fileConflicts, saveEditorTabById, tabs])

  useEffect(() => () => {
    for (const pending of autoSaveTimers.current.values()) window.clearTimeout(pending.timer)
    autoSaveTimers.current.clear()
  }, [])

  const toggleTextPreview = () => {
    if (!activeTab) return
    const preview = previewKindForFile(activeTab.name)
    if (preview !== 'csv' && preview !== 'markdown') return
    setTabs((current) => {
      const finalTabs = current.map((tab) => tab.id === activeTab.id ? { ...tab, preview: activeTab.preview ? undefined : preview } : tab)
      tabsRef.current = finalTabs
      return finalTabs
    })
  }

  const editorDocumentMode = useCallback((tab: EditorTab): Extension => tab.preview
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false), mediaPreviewExtension(tab.preview, tab.content)]
    : [EditorState.readOnly.of(false), EditorView.editable.of(true), languageForFile(tab.name)], [])

  const editorConfigurationEffects = useCallback((tab: EditorTab) => {
    const compartments = editorCompartments.current
    return [
      compartments.fontSize.reconfigure(EditorView.theme({ '&': { fontSize: `${editorFontSize}px` } })),
      compartments.tabSize.reconfigure(EditorState.tabSize.of(editorTabSize)),
      compartments.wordWrap.reconfigure(editorWordWrap ? EditorView.lineWrapping : []),
      compartments.documentMode.reconfigure(editorDocumentMode(tab)),
    ]
  }, [editorDocumentMode, editorFontSize, editorTabSize, editorWordWrap])

  const configureEditorState = useCallback((state: EditorState, tab: EditorTab) => {
    const content = editorDocumentForTab(tab)
    return state.update({
      ...(state.doc.toString() === content ? {} : { changes: { from: 0, to: state.doc.length, insert: content } }),
      effects: editorConfigurationEffects(tab),
    }).state
  }, [editorConfigurationEffects])

  useEffect(() => {
    if (!editorHost.current) return
    const compartments = editorCompartments.current
    const extensions: Extension[] = [
      graphiteCodeMirrorTheme,
      lineNumbers(),
      foldGutter(),
      editorHistory(),
      compartments.fontSize.of(EditorView.theme({ '&': { fontSize: `${editorFontSize}px` } })),
      compartments.tabSize.of(EditorState.tabSize.of(editorTabSize)),
      compartments.wordWrap.of(editorWordWrap ? EditorView.lineWrapping : []),
      compartments.documentMode.of([]),
      search({ top: true, createPanel: createEditorSearchPanel }),
      showMinimap.compute(['doc'], () => ({
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'editor-minimap'
          return { dom }
        },
        displayText: 'characters',
        showOverlay: 'always',
      })),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab, { key: 'Mod-s', run: () => { void saveActiveRef.current(); return true } }]),
      EditorView.updateListener.of((update) => {
        const owner = activeEditorStateOwner.current
        if (!owner) return
        editorStates.current.set(owner.key, update.state)
        editorScrollPositions.current.set(owner.key, { left: update.view.scrollDOM.scrollLeft, top: update.view.scrollDOM.scrollTop })
        if (update.selectionSet || update.viewportChanged) setSessionRevision((current) => current + 1)
        if (update.selectionSet || update.docChanged) {
          const selected = update.state.selection.main
          setSelection(selected.from === selected.to ? null : {
            fromLine: update.state.doc.lineAt(selected.from).number,
            toLine: update.state.doc.lineAt(selected.to).number,
          })
        }
        if (!update.docChanged || owner.preview) return
        const content = update.state.doc.toString()
        setTabs((current) => {
          const next = current.map((tab) => {
            if (tab.id !== owner.tabId) return tab
            writeVolatileDraft(editorDraftIdentity(workspaceRef.current, tab.source, tab.id), content, tab.savedContent)
            return { ...tab, content, revision: tab.revision + 1 }
          })
          tabsRef.current = next
          return next
        })
      }),
    ]
    editorBaseExtensions.current = extensions
    const state = EditorState.create({ extensions })
    emptyEditorState.current = state
    const view = new EditorView({ state, parent: editorHost.current })
    editorView.current = view
    return () => {
      if (editorView.current === view) editorView.current = null
      view.destroy()
      editorBaseExtensions.current = null
      emptyEditorState.current = null
    }
    // La vista e il suo DOM vivono quanto ProjectEditor; preferenze e documento
    // vengono aggiornati tramite Compartment e setState, mai con un remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = editorView.current
    if (!view) return
    const tab = tabsRef.current.find((entry) => entry.id === activeId)
    const nextOwner = tab && !tab.remote?.binary ? { key: editorStateKey(tab), tabId: tab.id, preview: tab.preview } : null
    const currentOwner = activeEditorStateOwner.current

    if (currentOwner?.key === nextOwner?.key && tab) {
      view.dispatch({ effects: editorConfigurationEffects(tab) })
      return
    }

    if (currentOwner) {
      editorStates.current.set(currentOwner.key, view.state)
      editorScrollPositions.current.set(currentOwner.key, { left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop })
    }

    activeEditorStateOwner.current = nextOwner
    if (!nextOwner || !tab) {
      if (emptyEditorState.current) view.setState(emptyEditorState.current)
      setSelection(null)
      return
    }

    const baseExtensions = editorBaseExtensions.current
    if (!baseExtensions) return
    const cachedState = editorStates.current.get(nextOwner.key) ?? EditorState.create({ doc: editorDocumentForTab(tab), extensions: baseExtensions })
    const nextState = configureEditorState(cachedState, tab)
    const scrollPosition = editorScrollPositions.current.get(nextOwner.key) ?? { left: 0, top: 0 }
    editorStates.current.set(nextOwner.key, nextState)
    view.setState(nextState)
    const selected = nextState.selection.main
    setSelection(selected.from === selected.to ? null : {
      fromLine: nextState.doc.lineAt(selected.from).number,
      toLine: nextState.doc.lineAt(selected.to).number,
    })
    view.requestMeasure({
      key: editorScrollRestoreKey.current,
      read: () => scrollPosition,
      write: (position, currentView) => {
        if (activeEditorStateOwner.current?.key !== nextOwner.key) return
        currentView.scrollDOM.scrollLeft = position.left
        currentView.scrollDOM.scrollTop = position.top
      },
    })
  }, [activeId, activeTab?.preview, activeTab?.remote?.binary, configureEditorState, editorConfigurationEffects])

  useEffect(() => {
    const view = editorView.current
    const tab = tabsRef.current.find((entry) => entry.id === activeId)
    if (!view || !tab || tab.remote?.binary || activeEditorStateOwner.current?.key !== editorStateKey(tab)) return
    const content = editorDocumentForTab(tab)
    if (view.state.doc.toString() === content) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      effects: editorCompartments.current.documentMode.reconfigure(editorDocumentMode(tab)),
    })
  }, [activeId, activeTab?.content, activeTab?.preview, activeTab?.remote?.binary, editorDocumentMode])

  const hasActiveProjectIdentityMutation = useCallback((entryId: string, entryKind: 'file' | 'directory') => (
    [...activeProjectIdentityMutations.current.values()].some((mutation) => (
      projectEntriesOverlap(mutation.entryId, mutation.entryKind, entryId, entryKind)
    ))
  ), [])

  const beginProjectIdentityMutation = useCallback((entryId: string, entryKind: 'file' | 'directory') => {
    const key = `${entryKind}\0${entryId}`
    activeProjectIdentityMutations.current.set(key, { entryId, entryKind })
    return () => { activeProjectIdentityMutations.current.delete(key) }
  }, [])

  const openFile = useCallback(async (fileId: string, focusAfterOpen = true, activateAfterOpen = true) => {
    const requestWorkspace = workspace
    const intent = activateAfterOpen ? ++activationIntent.current : activationIntent.current
    const activate = (tabId: string) => {
      if (!activateAfterOpen || !editorAlive.current || workspaceRef.current !== requestWorkspace || activationIntent.current !== intent) return
      activeIdRef.current = tabId
      setActiveId(tabId)
      if (focusAfterOpen) focusEditor()
    }
    const existing = tabsRef.current.find((tab) => tab.id === fileId)
    if (existing) {
      activate(existing.id)
      return
    }
    if (hasActiveProjectIdentityMutation(fileId, 'file')) {
      toast.info('Attendi la conclusione della modifica prima di aprire questo file.', { description: fileId })
      return
    }

    const requestKey = `workspace\0${requestWorkspace}\0${fileId}`
    let request = openFileRequests.current.get(requestKey)
    const ownsRequest = !request
    if (!request) {
      setLoadingFile(fileId)
      request = (async () => {
        const previewKind = previewKindForFile(fileId)
        const file = previewKind === 'image' || previewKind === 'pdf'
          ? await window.vincodeLab.files.preview(fileId)
          : await window.vincodeLab.files.read(fileId)
        const draftIdentity = editorDraftIdentity(requestWorkspace, 'workspace', file.id)
        const volatileDraft = readVolatileDraft(draftIdentity)
        const restoredExternalConflict = Boolean(volatileDraft && volatileDraft.content !== file.content && volatileDraft.baseline !== file.content)
        // Un draft sopravvissuto a un crash non viene ribasato automaticamente se
        // il file è cambiato: anche dopo un nuovo rimontaggio serve una scelta esplicita.
        const content = restoredExternalConflict && volatileDraft
          ? volatileDraft.content
          : restoreVolatileDraft(draftIdentity, file.content)
        return {
          id: file.id,
          name: file.name,
          content,
          savedContent: file.content,
          revision: content === file.content ? 0 : 1,
          savedRevision: 0,
          instance: ++nextTabInstance.current,
          source: 'workspace' as const,
          ...('revision' in file ? { diskRevision: file.revision } : {}),
          ...(restoredExternalConflict ? { restoredExternalConflict: true } : {}),
          ...(previewKind ? { preview: previewKind } : {}),
        }
      })()
      openFileRequests.current.set(requestKey, request)
    }
    try {
      const opened = await request
      if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
      const installed = tabsRef.current.find((tab) => tab.id === opened.id) ?? opened
      if (!tabsRef.current.some((tab) => tab.id === installed.id)) {
        const next = [...tabsRef.current, installed]
        tabsRef.current = next
        setTabs(next)
      }
      setDocumentFailure((current) => current?.recovery?.kind === 'open-workspace-file' && current.recovery.fileId === fileId ? null : current)
      if (installed.restoredExternalConflict && !fileConflictsRef.current.has(installed.id)) {
        recordFileConflict(installed, Object.assign(
          new Error(`Il file è cambiato mentre le modifiche locali venivano recuperate. [${externalFileConflictCode}]`),
          { code: externalFileConflictCode },
        ))
      }
      activate(installed.id)
    } catch (error) {
      if (ownsRequest && editorAlive.current && workspaceRef.current === requestWorkspace) {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'filesystem',
            operation: 'open-workspace-file',
            title: 'File non aperto',
            fallbackDescription: 'Il file selezionato non è stato aperto. Gli altri tab e le modifiche già presenti restano disponibili.',
          }),
          fileId,
          recovery: { kind: 'open-workspace-file', fileId },
        })
      }
    } finally {
      if (ownsRequest && openFileRequests.current.get(requestKey) === request) openFileRequests.current.delete(requestKey)
      if (ownsRequest && editorAlive.current && workspaceRef.current === requestWorkspace) {
        setLoadingFile((current) => current === fileId ? null : current)
      }
    }
  }, [focusEditor, hasActiveProjectIdentityMutation, recordFileConflict, workspace])

  const openRemoteFile = useCallback(async (fileId: string, focusAfterOpen = true, activateAfterOpen = true) => {
    const requestWorkspace = workspace
    const intent = activateAfterOpen ? ++activationIntent.current : activationIntent.current
    const activate = (tabId: string) => {
      if (!activateAfterOpen || !editorAlive.current || workspaceRef.current !== requestWorkspace || activationIntent.current !== intent) return
      activeIdRef.current = tabId
      setActiveId(tabId)
      if (focusAfterOpen) focusEditor()
    }
    const existing = tabsRef.current.find((tab) => tab.source === 'remote' && tab.remote?.file.id === fileId)
    if (existing) {
      activate(existing.id)
      return
    }

    const loadingId = `remote:${fileId}`
    const requestKey = `remote\0${requestWorkspace}\0${fileId}`
    let request = openFileRequests.current.get(requestKey)
    const ownsRequest = !request
    if (!request) {
      setLoadingFile(loadingId)
      request = (async () => {
        const [preview, connections] = await Promise.all([
          window.vincodeLab.remoteFiles.preview(fileId),
          window.vincodeLab.managedSsh.list(),
        ])
        const content = preview.binary ? '' : (await window.vincodeLab.remoteFiles.read(fileId)).content
        const connection = connections.find((entry) => entry.id === preview.file.connectionId)
        const previewKind = preview.binary ? undefined : previewKindForFile(preview.file.name)
        const restoredContent = preview.binary
          ? content
          : restoreVolatileDraft(editorDraftIdentity(requestWorkspace, 'remote', `remote:${preview.file.id}`), content)
        return {
          id: `remote:${preview.file.id}`,
          name: preview.file.name,
          content: restoredContent,
          savedContent: content,
          revision: restoredContent === content ? 0 : 1,
          savedRevision: 0,
          instance: ++nextTabInstance.current,
          source: 'remote' as const,
          remote: { file: preview.file, connectionTitle: connection?.title ?? connection?.destination ?? 'Connessione remota', binary: preview.binary },
          ...(previewKind ? { preview: previewKind } : {}),
        }
      })()
      openFileRequests.current.set(requestKey, request)
    }
    try {
      const opened = await request
      if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
      const installed = tabsRef.current.find((tab) => tab.id === opened.id) ?? opened
      if (!tabsRef.current.some((tab) => tab.id === installed.id)) {
        const next = [...tabsRef.current, installed]
        tabsRef.current = next
        setTabs(next)
      }
      setDocumentFailure((current) => current?.recovery?.kind === 'open-remote-file' && current.recovery.fileId === fileId ? null : current)
      activate(installed.id)
    } catch (error) {
      if (ownsRequest && editorAlive.current && workspaceRef.current === requestWorkspace) {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'remote',
            operation: 'open-remote-file',
            title: 'File remoto non aperto',
            fallbackDescription: 'La copia remota non è stata aperta. Gli altri tab e le modifiche locali restano disponibili. Riconnetti il server e riprova.',
          }),
          fileId: loadingId,
          recovery: { kind: 'open-remote-file', fileId },
        })
      }
    } finally {
      if (ownsRequest && openFileRequests.current.get(requestKey) === request) openFileRequests.current.delete(requestKey)
      if (ownsRequest && editorAlive.current && workspaceRef.current === requestWorkspace) {
        setLoadingFile((current) => current === loadingId ? null : current)
      }
    }
  }, [focusEditor, workspace])

  useEffect(() => {
    if (!remoteOpenRequest) return
    void openRemoteFile(remoteOpenRequest.id)
  }, [openRemoteFile, remoteOpenRequest])

  useEffect(() => {
    if (!initialState) return
    if (restoredSession.current === initialState) {
      // Fast Refresh può preservare i ref ma ricreare lo state del componente:
      // una sessione già applicata deve tornare immediatamente operativa.
      if (!restoringSession.current) queueMicrotask(() => setSessionRestoreReady(true))
      return
    }
    restoredSession.current = initialState
    restoringSession.current = true
    const restoreActivationIntent = activationIntent.current
    let cancelled = false
    setSessionRestoreReady(false)

    void (async () => {
      setExpanded(new Set(initialState.expandedDirectoryIds))
      for (const file of initialState.openFiles) {
        if (cancelled) return
        if (file.source === 'workspace') await openFile(file.id, false, false)
        else await openRemoteFile(file.id, false, false)
        if (!file.mode) continue
        const tabId = file.source === 'workspace' ? file.id : `remote:${file.id}`
        const tab = tabsRef.current.find((entry) => entry.id === tabId)
        if (!tab) continue
        const previewKind = previewKindForFile(tab.name)
        if (previewKind !== 'csv' && previewKind !== 'markdown') continue
        const preview = file.mode === 'preview' ? previewKind : undefined
        if (tab.preview === preview) continue
        const nextTabs = tabsRef.current.map((entry) => entry.id === tabId ? { ...entry, preview } : entry)
        tabsRef.current = nextTabs
        setTabs(nextTabs)
      }
      if (cancelled) return

      const baseExtensions = editorBaseExtensions.current
      if (baseExtensions) {
        for (const storedView of initialState.fileViews) {
          const tabId = storedView.source === 'workspace' ? storedView.id : `remote:${storedView.id}`
          const tab = tabsRef.current.find((entry) => entry.id === tabId)
          if (!tab || tab.remote?.binary) continue
          const document = editorDocumentForTab(tab)
          const anchor = Math.min(storedView.selection.anchor, document.length)
          const head = Math.min(storedView.selection.head, document.length)
          const state = EditorState.create({
            doc: document,
            extensions: baseExtensions,
            selection: { anchor, head },
          })
          editorStates.current.set(editorStateKey(tab), configureEditorState(state, tab))
          editorScrollPositions.current.set(editorStateKey(tab), storedView.scroll)
        }
      }

      const activeFile = initialState.activeFile
      const activeTabId = activeFile ? (activeFile.source === 'workspace' ? activeFile.id : `remote:${activeFile.id}`) : null
      const restoredActiveId = activationIntent.current === restoreActivationIntent
        ? (activeTabId && tabsRef.current.some((tab) => tab.id === activeTabId) ? activeTabId : tabsRef.current.at(-1)?.id ?? null)
        : activeIdRef.current
      activeIdRef.current = restoredActiveId
      setActiveId(restoredActiveId)
      restoringSession.current = false
      setSessionRestoreReady(true)

      window.setTimeout(() => {
        if (cancelled || !restoredActiveId) return
        const tab = tabsRef.current.find((entry) => entry.id === restoredActiveId)
        if (!tab) return
        const storedId = tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id
        const storedView = initialState.fileViews.find((view) => view.source === tab.source && view.id === storedId)
        const view = editorView.current
        if (!storedView || !view || tab.remote?.binary) return
        const anchor = Math.min(storedView.selection.anchor, view.state.doc.length)
        const head = Math.min(storedView.selection.head, view.state.doc.length)
        view.dispatch({ selection: { anchor, head }, scrollIntoView: false })
        view.scrollDOM.scrollTop = storedView.scroll.top
        view.scrollDOM.scrollLeft = storedView.scroll.left
      }, 0)
    })()

    return () => { cancelled = true; restoringSession.current = false }
  }, [configureEditorState, initialState, openFile, openRemoteFile])

  useEffect(() => {
    if (!onSessionChange || !sessionRestoreReady || restoringSession.current) return

    const openTabs = tabsRef.current
    const activeTab = openTabs.find((tab) => tab.id === activeIdRef.current) ?? null
    const fileViews: WorkspaceSessionFileView[] = []

    for (const tab of openTabs) {
      if (tab.remote?.binary) continue
      const key = editorStateKey(tab)
      const isActiveOwner = activeEditorStateOwner.current?.key === key
      const state = isActiveOwner ? editorView.current?.state : editorStates.current.get(key)
      if (!state) continue
      const storedScroll = isActiveOwner && editorView.current
        ? { top: editorView.current.scrollDOM.scrollTop, left: editorView.current.scrollDOM.scrollLeft }
        : editorScrollPositions.current.get(key) ?? { top: 0, left: 0 }
      const selected = state.selection.main
      fileViews.push({
        ...sessionFileRef(tab),
        selection: {
          anchor: Math.min(selected.anchor, 2_000_000),
          head: Math.min(selected.head, 2_000_000),
        },
        scroll: {
          top: Math.min(Math.max(0, storedScroll.top), 100_000_000),
          left: Math.min(Math.max(0, storedScroll.left), 100_000_000),
        },
      })
    }

    onSessionChange({
      openFiles: openTabs.map(sessionFileRef),
      activeFile: activeTab ? sessionFileRef(activeTab) : null,
      expandedDirectoryIds: [...expanded],
      fileViews,
    })
  }, [activeId, expanded, onSessionChange, sessionRestoreReady, sessionRevision, tabSessionSignature])

  const updateRemoteTab = useCallback((file: RemoteTrackedFile) => {
    setTabs((current) => {
      const next = current.map((entry) => entry.source === 'remote' && entry.remote?.file.id === file.id
        ? { ...entry, remote: { ...entry.remote, file } }
        : entry)
      tabsRef.current = next
      return next
    })
  }, [])

  const compareRemoteFile = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current)
    if (!tab?.remote) return
    if (tab.content !== tab.savedContent) {
      toast.info('Salva prima la copia locale per confrontarla con il server.')
      return
    }
    try {
      const comparison = await window.vincodeLab.remoteFiles.compare(tab.remote.file.id)
      const tracked = (await window.vincodeLab.remoteFiles.listTracked()).find((entry) => entry.id === tab.remote?.file.id) ?? tab.remote.file
      updateRemoteTab(tracked)
      setRemoteDiffFile(tracked)
      setRemoteComparison(comparison)
      setDocumentFailure((current) => current?.fileId === tab.id ? null : current)
    } catch (error) {
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'remote',
          operation: 'compare-remote-file',
          title: 'Confronto remoto non disponibile',
          fallbackDescription: 'La copia locale è rimasta invariata. Riconnetti il server e riprova il confronto.',
        }),
        fileId: tab.id,
        recovery: { kind: 'compare-remote' },
      })
    }
  }, [setRemoteComparison, setRemoteDiffFile, updateRemoteTab])

  const uploadRemoteFile = useCallback(async (force: boolean) => {
    const file = remoteDiffFile
    if (!file || uploadingRemote) return
    setUploadingRemote(true)
    try {
      const result = await window.vincodeLab.remoteFiles.upload(file.id, { force })
      if (result.status === 'conflict') {
        const comparison = await window.vincodeLab.remoteFiles.compare(file.id)
        const tracked = (await window.vincodeLab.remoteFiles.listTracked()).find((entry) => entry.id === file.id) ?? { ...file, localState: 'conflict' as const }
        updateRemoteTab(tracked)
        setRemoteDiffFile(tracked)
        setRemoteComparison(comparison)
        toast.warning('Il file sul server è cambiato. Verifica il conflitto prima di forzare la sostituzione.')
        return
      }
      if (result.file) updateRemoteTab(result.file)
      setRemoteComparison(null)
      setRemoteDiffFile(null)
      setDocumentFailure((current) => current?.fileId === `remote:${file.id}` ? null : current)
      toast.success('File caricato sul server.', { description: file.remotePath })
    } catch (error) {
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'remote',
          operation: 'upload-remote-file',
          title: 'File non caricato sul server',
          fallbackDescription: 'La copia locale è rimasta al sicuro. Riconnetti il server e riprova; il file remoto non è stato sostituito.',
        }),
        fileId: `remote:${file.id}`,
        recovery: { kind: 'upload-remote', force },
      })
    } finally {
      setUploadingRemote(false)
    }
  }, [remoteDiffFile, setRemoteComparison, setRemoteDiffFile, updateRemoteTab, uploadingRemote])

  const requestRemoteUpload = useCallback((force: boolean) => {
    if (!remoteDiffFile) return
    setConfirmation({
      title: force ? 'Forza sostituzione sul server' : 'Carica il file sul server',
      detail: force
        ? `La versione remota di “${remoteDiffFile.name}” è cambiata. Forzando il caricamento sostituirai comunque il contenuto sul server.`
        : `La copia locale di “${remoteDiffFile.name}” sostituirà il file remoto. Il salvataggio nell’Editor resta separato da questa operazione.`,
      confirmLabel: force ? 'Forza sostituzione' : 'Carica sul server',
      destructive: force,
      onConfirm: () => void uploadRemoteFile(force),
    })
  }, [remoteDiffFile, setConfirmation, uploadRemoteFile])

  const closeTabConfirmed = useCallback((fileId: string) => {
    const pendingSave = autoSaveTimers.current.get(fileId)
    if (pendingSave) window.clearTimeout(pendingSave.timer)
    autoSaveTimers.current.delete(fileId)
    if (activeEditorStateOwner.current?.tabId === fileId) activeEditorStateOwner.current = null
    clearCachedEditorStateForFile(fileId, editorStates.current, editorScrollPositions.current)
    const closingTab = tabsRef.current.find((entry) => entry.id === fileId)
    if (closingTab) discardVolatileDraft(editorDraftIdentity(workspaceRef.current, closingTab.source, closingTab.id))
    if (closingTab) clearFileConflict(fileId, closingTab.instance)
    const remaining = tabsRef.current.filter((entry) => entry.id !== fileId)
    tabsRef.current = remaining
    setTabs(remaining)
    if (activeIdRef.current === fileId) {
      activationIntent.current += 1
      const nextActiveId = remaining.at(-1)?.id ?? null
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
      if (nextActiveId) focusEditor()
      else focusExplorer()
    }
  }, [clearFileConflict, focusEditor, focusExplorer])

  const closeTab = useCallback((fileId: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId)
    if (!tab) return
    if (savingCounts.current.has(fileId)) {
      toast.info('Attendi la conclusione del salvataggio prima di chiudere il file.')
      return
    }
    if (tab.content === tab.savedContent) {
      closeTabConfirmed(fileId)
      return
    }
    setConfirmation({ title: 'Chiudi senza salvare', detail: `Le modifiche a “${tab.name}” non sono state salvate e verranno scartate.`, confirmLabel: 'Scarta modifiche', destructive: true, onConfirm: () => closeTabConfirmed(fileId) })
  }, [closeTabConfirmed])

  const reloadWorkspaceFileFromDisk = useCallback(async (fileId: string, instance: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance && entry.source === 'workspace')
    if (!tab || savingCounts.current.has(fileId)) return
    const requestWorkspace = workspace
    fileRecoveryIds.current.add(fileId)
    savingCounts.current.set(fileId, 1)
    setSavingFileIds((current) => new Set(current).add(fileId))
    try {
      const file = await window.vincodeLab.files.read(fileId)
      if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (!current) return
      const nextRevision = current.revision + 1
      const next = tabsRef.current.map((entry) => entry.id === fileId && entry.instance === instance
        ? { ...entry, content: file.content, savedContent: file.content, diskRevision: file.revision, revision: nextRevision, savedRevision: nextRevision }
        : entry)
      tabsRef.current = next
      setTabs(next)
      clearFileConflict(fileId, instance)
      discardVolatileDraft(editorDraftIdentity(requestWorkspace, 'workspace', fileId))
      toast.success('File ricaricato dal disco.', { description: fileId })
      focusEditor()
    } catch (cause) {
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (current) recordConflictRecoveryFailure(
        current,
        cause,
        'reload-workspace-file',
        'Impossibile ricaricare il file',
        `“${current.name}” non è disponibile sul disco. Le modifiche locali sono ancora al sicuro. Puoi riprovare oppure sovrascrivere esplicitamente il file.`,
      )
    } finally {
      fileRecoveryIds.current.delete(fileId)
      savingCounts.current.delete(fileId)
      if (editorAlive.current && workspaceRef.current === requestWorkspace) {
        setSavingFileIds((current) => {
          if (!current.has(fileId)) return current
          const next = new Set(current)
          next.delete(fileId)
          return next
        })
      }
    }
  }, [clearFileConflict, focusEditor, recordConflictRecoveryFailure, workspace])

  const overwriteWorkspaceFile = useCallback(async (fileId: string, instance: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance && entry.source === 'workspace')
    if (!tab) return
    try {
      await saveEditorTabById(fileId, { force: true })
    } catch (cause) {
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (current) recordConflictRecoveryFailure(
        current,
        cause,
        'force-overwrite-workspace-file',
        'Impossibile sovrascrivere il file',
        `“${current.name}” non è stato sovrascritto. Le modifiche locali sono ancora al sicuro. Puoi riprovare oppure ricaricare la versione presente sul disco.`,
      )
    }
  }, [recordConflictRecoveryFailure, saveEditorTabById])

  const requestReloadWorkspaceFile = useCallback((conflict: EditorFileConflict) => {
    const tab = tabsRef.current.find((entry) => entry.id === conflict.fileId && entry.instance === conflict.instance)
    if (!tab) return
    setConfirmation({
      title: 'Ricarica la versione sul disco',
      detail: `Le modifiche locali a “${tab.name}” verranno sostituite dalla versione presente sul disco. Questa operazione non sovrascrive il file esterno.`,
      confirmLabel: 'Ricarica dal disco',
      destructive: true,
      onConfirm: () => { void reloadWorkspaceFileFromDisk(conflict.fileId, conflict.instance) },
    })
  }, [reloadWorkspaceFileFromDisk])

  const requestOverwriteWorkspaceFile = useCallback((conflict: EditorFileConflict) => {
    const tab = tabsRef.current.find((entry) => entry.id === conflict.fileId && entry.instance === conflict.instance)
    if (!tab) return
    setConfirmation({
      title: 'Sovrascrivi la versione sul disco',
      detail: `La versione esterna di “${tab.name}” verrà sostituita con le modifiche locali conservate nell’Editor. Non sarà possibile recuperarla da VincodeLab.`,
      confirmLabel: 'Sovrascrivi file',
      destructive: true,
      onConfirm: () => { void overwriteWorkspaceFile(conflict.fileId, conflict.instance) },
    })
  }, [overwriteWorkspaceFile])

  const cycleOpenTab = useCallback((offset: -1 | 1) => {
    const current = tabsRef.current
    if (current.length < 2) {
      if (current.length === 1) focusEditor()
      return
    }
    const activeIndex = Math.max(0, current.findIndex((tab) => tab.id === activeIdRef.current))
    const nextIndex = (activeIndex + offset + current.length) % current.length
    const nextId = current[nextIndex]?.id ?? null
    activationIntent.current += 1
    activeIdRef.current = nextId
    setActiveId(nextId)
    focusEditor()
  }, [focusEditor])

  const handledWorkbenchRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!sessionRestoreReady || !workbenchRequest || handledWorkbenchRequest.current === workbenchRequest.nonce) return
    handledWorkbenchRequest.current = workbenchRequest.nonce

    if (workbenchRequest.kind === 'open-file') {
      void openFile(workbenchRequest.fileId)
      return
    }
    if (workbenchRequest.kind === 'focus-editor') {
      if (activeId) focusEditor()
      else focusExplorer()
      return
    }
    if (workbenchRequest.kind === 'focus-explorer') {
      focusExplorer()
      return
    }
    if (workbenchRequest.kind === 'close-active') {
      const fileId = activeIdRef.current
      if (fileId) closeTab(fileId)
      return
    }

    cycleOpenTab(workbenchRequest.kind === 'next-tab' ? 1 : -1)
  }, [activeId, closeTab, cycleOpenTab, focusEditor, focusExplorer, openFile, sessionRestoreReady, workbenchRequest])

  const refreshCreatedFileInExplorer = async (fileId: string) => {
    const segments = fileId.split('/')
    const directorySegments = segments.slice(0, -1)
    if (!directorySegments.length) {
      const result = await window.vincodeLab.files.list()
      setTree(result.entries)
      setTruncated(result.truncated)
      return
    }

    let nextTree = tree
    const directoriesToExpand: string[] = []
    for (let index = 1; index <= directorySegments.length; index += 1) {
      const directoryId = directorySegments.slice(0, index).join('/')
      const result = await window.vincodeLab.files.listDirectory(directoryId)
      nextTree = replaceDirectoryChildren(nextTree, directoryId, result.entries)
      directoriesToExpand.push(directoryId)
      if (result.truncated) toast.info(`La cartella ${directoryId} è limitata a 1.000 elementi.`)
    }
    setTree(nextTree)
    setExpanded((current) => new Set([...current, ...directoriesToExpand]))
  }

  const createFile = async (fileName: string) => {
    const draft = resolveNewFileDraft(fileName)
    if (draft.action === 'cancel') {
      setNewFileName(null)
      return
    }
    if (creatingFile) return
    const requestWorkspace = workspace
    const intent = ++activationIntent.current
    setCreatingFile(true)
    try {
      const file = await window.vincodeLab.files.create(selectedDirectoryId ?? '', draft.fileName)
      if (!editorAlive.current || workspaceRef.current !== requestWorkspace) return
      const tab: EditorTab = {
        id: file.id,
        name: file.name,
        content: file.content,
        savedContent: file.content,
        revision: 0,
        savedRevision: 0,
        instance: ++nextTabInstance.current,
        source: 'workspace',
        diskRevision: file.revision,
      }
      const next = [...tabsRef.current, tab]
      tabsRef.current = next
      setTabs(next)
      if (editorAlive.current && workspaceRef.current === requestWorkspace && activationIntent.current === intent) {
        activeIdRef.current = file.id
        setActiveId(file.id)
        focusEditor()
      }
      setExplorerQuery('')
      setNewFileName(null)
      setExplorerFailure(null)
      try {
        await refreshCreatedFileInExplorer(file.id)
        toast.remove(createdFileExplorerWarningToastId)
      } catch (error) {
        const incident = reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'refresh-explorer-after-create',
          severity: 'warning',
          title: 'File creato, Explorer non aggiornato',
          fallbackDescription: 'Il file è aperto e al sicuro. Aggiorna Explorer per riallineare l’elenco dei file.',
        })
        toast.warning(incident.title, {
          action: { label: 'Aggiorna', onClick: () => { void refreshExplorer(true) } },
          description: `${incident.description} Riferimento ${incident.correlationId}.`,
          id: createdFileExplorerWarningToastId,
        })
      }
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-create',
          title: 'File creato, stato Git non aggiornato',
          fallbackDescription: 'Il file è aperto e al sicuro. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
      toast.success('Nuovo file creato.', { description: file.id })
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'create-file',
          title: 'File non creato',
          fallbackDescription: 'Il nome e la cartella scelti sono rimasti nell’Explorer. Correggili oppure verifica i permessi e riprova.',
        }),
        recovery: { kind: 'create-file', fileName: draft.fileName },
      })
      setNewFileRenameAttempt((current) => current + 1)
    } finally {
      if (editorAlive.current && workspaceRef.current === requestWorkspace) setCreatingFile(false)
    }
  }

  const loadDirectory = useCallback(async (directoryId: string, directoryName: string) => {
    if (hasActiveProjectIdentityMutation(directoryId, 'directory')) {
      toast.info('Attendi la conclusione della modifica prima di aprire questa cartella.', { description: directoryName })
      return
    }
    if (loadingDirectories.current.has(directoryId)) return
    const directory = findProjectTreeEntry(tree, directoryId)
    if (!directory || directory.children !== undefined) return
    loadingDirectories.current.add(directoryId)
    setLoadingDirectory(directoryId)
    try {
      const result = await window.vincodeLab.files.listDirectory(directoryId)
      setTree((current) => replaceDirectoryChildren(current, directoryId, result.entries))
      setExplorerFailure((current) => current?.recovery?.kind === 'load-directory' && current.recovery.directoryId === directoryId ? null : current)
      if (result.truncated) toast.info(`La cartella ${directoryName} è limitata a 1.000 elementi.`)
    } catch (error) {
      setExpanded((current) => { const next = new Set(current); next.delete(directoryId); return next })
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'load-directory',
          title: 'Cartella non aperta',
          fallbackDescription: `La cartella “${directoryName}” non è stata caricata. I file già aperti restano disponibili.`,
        }),
        recovery: { kind: 'load-directory', directoryId, directoryName },
      })
    } finally {
      loadingDirectories.current.delete(directoryId)
      setLoadingDirectory((current) => current === directoryId ? null : current)
    }
  }, [hasActiveProjectIdentityMutation, tree])

  const refreshMutationParent = useCallback(async (entryId: string) => {
    const parentId = entryId.split('/').slice(0, -1).join('/')
    const result = parentId
      ? await window.vincodeLab.files.listDirectory(parentId)
      : await window.vincodeLab.files.list()
    setTree((current) => {
      if (!parentId) return mergeRefreshedProjectEntries(current, result.entries)
      const existing = findProjectTreeEntry(current, parentId)
      return replaceDirectoryChildren(current, parentId, mergeRefreshedProjectEntries(existing?.children ?? [], result.entries))
    })
    if (!parentId) setTruncated(result.truncated)
    if (result.truncated) toast.info(`La cartella ${parentId || 'principale'} mostra un elenco limitato.`)
  }, [])

  const affectedWorkspaceTabs = useCallback((entryId: string, entryKind: 'file' | 'directory') => tabsRef.current.filter((tab) => (
    tab.source === 'workspace' && projectEntryContainsPath(entryId, entryKind, tab.id)
  )), [])

  const projectEntryCanMutate = useCallback((entryId: string, entryKind: 'file' | 'directory') => {
    if (hasActiveProjectIdentityMutation(entryId, entryKind)) {
      toast.info('Una modifica dello stesso elemento è già in corso. Attendi prima di riprovare.')
      return false
    }
    const workspaceRequestPrefix = `workspace\0${workspaceRef.current}\0`
    const pendingOpenFile = [...openFileRequests.current.keys()]
      .filter((requestKey) => requestKey.startsWith(workspaceRequestPrefix))
      .map((requestKey) => requestKey.slice(workspaceRequestPrefix.length))
      .find((fileId) => projectEntriesOverlap(entryId, entryKind, fileId, 'file'))
    if (pendingOpenFile) {
      toast.info('Attendi l’apertura del file prima di modificare questo elemento.', { description: pendingOpenFile })
      return false
    }
    const pendingDirectory = [...loadingDirectories.current]
      .find((directoryId) => projectEntriesOverlap(entryId, entryKind, directoryId, 'directory'))
    if (pendingDirectory) {
      toast.info('Attendi il caricamento della cartella prima di modificare questo elemento.', { description: pendingDirectory })
      return false
    }
    const affected = affectedWorkspaceTabs(entryId, entryKind)
    const savingTab = affected.find((tab) => savingCounts.current.has(tab.id))
    if (savingTab) {
      toast.info('Attendi il salvataggio prima di modificare questo elemento.', { description: savingTab.name })
      return false
    }
    const conflictedTab = affected.find((tab) => fileConflictsRef.current.has(tab.id))
    if (conflictedTab) {
      toast.warning('Risolvi il conflitto prima di modificare questo elemento.', { description: `“${conflictedTab.name}” e le modifiche locali sono rimasti al sicuro.` })
      return false
    }
    const dirtyTab = affected.find((tab) => tab.content !== tab.savedContent)
    if (dirtyTab) {
      toast.warning('Salva il file prima di modificare questo elemento.', { description: `Le modifiche a “${dirtyTab.name}” sono rimaste nell’Editor.` })
      return false
    }
    return true
  }, [affectedWorkspaceTabs, hasActiveProjectIdentityMutation])

  const applyRenamedProjectEntry = useCallback((previousId: string, nextId: string, entryKind: 'file' | 'directory') => {
    const nextTabs = tabsRef.current.map((tab) => {
      if (tab.source !== 'workspace' || !projectEntryContainsPath(previousId, entryKind, tab.id)) return tab
      const oldKey = editorStateKey(tab)
      const id = remapProjectPath(tab.id, previousId, nextId)
      const renamed = { ...tab, id, name: id.split('/').at(-1) ?? tab.name }
      const nextKey = editorStateKey(renamed)
      const state = editorStates.current.get(oldKey)
      const scroll = editorScrollPositions.current.get(oldKey)
      if (state) { editorStates.current.delete(oldKey); editorStates.current.set(nextKey, state) }
      if (scroll) { editorScrollPositions.current.delete(oldKey); editorScrollPositions.current.set(nextKey, scroll) }
      if (activeEditorStateOwner.current?.tabId === tab.id) activeEditorStateOwner.current = { ...activeEditorStateOwner.current, key: nextKey, tabId: id }
      discardVolatileDraft(editorDraftIdentity(workspaceRef.current, 'workspace', tab.id))
      return renamed
    })
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    if (activeIdRef.current && projectEntryContainsPath(previousId, entryKind, activeIdRef.current)) {
      const nextActiveId = remapProjectPath(activeIdRef.current, previousId, nextId)
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
    }
    setExpanded((current) => new Set([...current].map((id) => remapProjectPath(id, previousId, nextId))))
    setSelectedDirectoryId((current) => current && projectEntryContainsPath(previousId, entryKind, current) ? remapProjectPath(current, previousId, nextId) : current)
    setTree((current) => renameProjectTreeEntry(current, previousId, nextId))
    setSessionRevision((current) => current + 1)
  }, [])

  const openRenameProjectEntry = useCallback((entryId: string, entryKind: 'file' | 'directory') => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    projectEntryDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectEntryDialog({
      busy: false,
      entryId,
      entryKind,
      error: null,
      mode: 'rename',
      value: entryId.split('/').at(-1) ?? entryId,
    })
  }, [projectEntryCanMutate])

  const openNewProjectDirectory = useCallback((parentId: string) => {
    if (!projectEntryCanMutate(parentId, 'directory')) return
    projectEntryDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectEntryDialog({ busy: false, entryId: parentId, entryKind: 'directory', error: null, mode: 'new-directory', value: '' })
  }, [projectEntryCanMutate])

  const submitProjectEntryDialog = useCallback(async () => {
    const request = projectEntryDialog
    if (!request || request.busy || !request.value.trim()) return
    setProjectEntryDialog({ ...request, busy: true, error: null })
    try {
      if (request.mode === 'new-directory') {
        if (!projectEntryCanMutate(request.entryId, 'directory')) {
          setProjectEntryDialog((current) => current ? { ...current, busy: false } : current)
          return
        }
        const created = await window.vincodeLab.files.createDirectory(request.entryId, request.value)
        await refreshMutationParent(created.id)
        setExpanded((current) => request.entryId ? new Set(current).add(request.entryId) : current)
        setSelectedDirectoryId(created.id)
        toast.success('Nuova cartella creata.', { description: created.id })
      } else {
        if (!projectEntryCanMutate(request.entryId, request.entryKind)) {
          setProjectEntryDialog((current) => current ? { ...current, busy: false } : current)
          return
        }
        const finishIdentityMutation = beginProjectIdentityMutation(request.entryId, request.entryKind)
        try {
          const renamed = await window.vincodeLab.files.rename(request.entryId, request.value, request.entryKind)
          if (renamed.renamed) applyRenamedProjectEntry(renamed.previousId, renamed.id, request.entryKind)
          toast.success(renamed.renamed ? 'Elemento rinominato.' : 'Nome già aggiornato.', { description: renamed.id })
        } finally {
          finishIdentityMutation()
        }
      }
      setProjectEntryDialog(null)
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-entry-mutation',
          title: 'Elemento aggiornato, stato Git non disponibile',
          fallbackDescription: 'La modifica al filesystem è riuscita. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
    } catch (error) {
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: request.mode === 'rename' ? 'rename-project-entry' : 'create-project-directory',
        title: request.mode === 'rename' ? 'Elemento non rinominato' : 'Cartella non creata',
        fallbackDescription: request.mode === 'rename'
          ? 'Il nome precedente e i file aperti sono rimasti invariati. Correggi il nome o verifica i permessi e riprova.'
          : 'La cartella scelta è rimasta invariata. Correggi il nome o verifica i permessi e riprova.',
      })
      setProjectEntryDialog((current) => current ? { ...current, busy: false, error: incident } : current)
    }
  }, [applyRenamedProjectEntry, beginProjectIdentityMutation, projectEntryCanMutate, projectEntryDialog, refreshGitStatus, refreshGitStatusFromWarning, refreshMutationParent])

  const duplicateProjectEntryFromMenu = useCallback(async (entryId: string, entryKind: 'file' | 'directory') => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    try {
      const duplicated = await window.vincodeLab.files.duplicate(entryId, entryKind)
      await refreshMutationParent(duplicated.id)
      if (entryKind === 'file') void openFile(duplicated.id)
      toast.success(entryKind === 'file' ? 'File duplicato.' : 'Cartella duplicata.', { description: duplicated.id })
      try { await refreshGitStatus() } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-duplicate',
          title: 'Elemento duplicato, stato Git non disponibile',
          fallbackDescription: 'La copia è stata creata. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'duplicate-project-entry',
          title: 'Elemento non duplicato',
          fallbackDescription: 'L’elemento originale è rimasto invariato. Verifica dimensione, permessi e spazio disponibile, poi riprova.',
        }),
      })
    }
  }, [openFile, projectEntryCanMutate, refreshGitStatus, refreshGitStatusFromWarning, refreshMutationParent])

  const requestTrashProjectEntry = useCallback((entryId: string, entryKind: 'file' | 'directory') => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    const entryName = entryId.split('/').at(-1) ?? entryId
    setConfirmation({
      title: `Sposta “${entryName}” nel Cestino`,
      detail: entryKind === 'directory'
        ? 'La cartella e tutto il suo contenuto verranno spostati nel Cestino di macOS. I file aperti coinvolti verranno chiusi soltanto dopo il completamento.'
        : 'Il file verrà spostato nel Cestino di macOS e chiuso nell’Editor soltanto dopo il completamento.',
      confirmLabel: 'Sposta nel Cestino',
      destructive: true,
      onConfirm: () => {
        if (!projectEntryCanMutate(entryId, entryKind)) return
        const finishIdentityMutation = beginProjectIdentityMutation(entryId, entryKind)
        void Promise.resolve().then(() => window.vincodeLab.files.trash(entryId, entryKind)).then(async () => {
          for (const tab of affectedWorkspaceTabs(entryId, entryKind)) closeTabConfirmed(tab.id)
          setTree((current) => removeProjectTreeEntry(current, entryId))
          setExpanded((current) => new Set([...current].filter((id) => !projectEntryContainsPath(entryId, entryKind, id))))
          setSelectedDirectoryId((current) => current && projectEntryContainsPath(entryId, entryKind, current) ? null : current)
          toast.success(entryKind === 'file' ? 'File spostato nel Cestino.' : 'Cartella spostata nel Cestino.', { description: entryId })
          try { await refreshGitStatus() } catch (error) {
            showGitStatusWarning(error, {
              operation: 'refresh-git-status-after-trash',
              title: 'Elemento nel Cestino, stato Git non disponibile',
              fallbackDescription: 'Lo spostamento nel Cestino è riuscito. Gli indicatori Git potrebbero essere obsoleti.',
            }, refreshGitStatusFromWarning)
          }
        }).catch((error) => {
          setExplorerFailure({
            error: reportEditorFailure(error, {
              category: 'filesystem',
              operation: 'trash-project-entry',
              title: 'Elemento non spostato nel Cestino',
              fallbackDescription: 'Il file, i tab e le modifiche sono rimasti invariati. Verifica i permessi e riprova.',
            }),
          })
        }).finally(finishIdentityMutation)
      },
    })
  }, [affectedWorkspaceTabs, beginProjectIdentityMutation, closeTabConfirmed, projectEntryCanMutate, refreshGitStatus, refreshGitStatusFromWarning])

  const requestCloseEditorTabs = useCallback((fileIds: string[]) => {
    const ids = new Set(fileIds)
    const targets = tabsRef.current.filter((tab) => ids.has(tab.id))
    if (!targets.length) return
    if (targets.some((tab) => savingCounts.current.has(tab.id))) {
      toast.info('Attendi la conclusione dei salvataggi prima di chiudere i tab.')
      return
    }
    const close = () => targets.forEach((tab) => closeTabConfirmed(tab.id))
    const dirty = targets.filter((tab) => tab.content !== tab.savedContent)
    if (!dirty.length) { close(); return }
    setConfirmation({
      title: dirty.length === 1 ? 'Chiudi senza salvare' : `Chiudi ${dirty.length} file modificati`,
      detail: dirty.length === 1
        ? `Le modifiche a “${dirty[0].name}” verranno scartate.`
        : `Le modifiche non salvate in ${dirty.length} file verranno scartate. Gli altri tab selezionati verranno chiusi.`,
      confirmLabel: 'Scarta modifiche e chiudi',
      destructive: true,
      onConfirm: close,
    })
  }, [closeTabConfirmed])

  useEffect(() => window.vincodeLab.contextMenu?.onAction?.((action) => {
    const contextId = action.contextId ?? ''
    if (action.command === 'workspaceFile.open' && contextId) { void openFile(contextId); return }
    if (action.command === 'workspaceFile.rename' && contextId) { openRenameProjectEntry(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.rename' && contextId) { openRenameProjectEntry(contextId, 'directory'); return }
    if (action.command === 'workspaceFile.duplicate' && contextId) { void duplicateProjectEntryFromMenu(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.duplicate' && contextId) { void duplicateProjectEntryFromMenu(contextId, 'directory'); return }
    if (action.command === 'workspaceFile.trash' && contextId) { requestTrashProjectEntry(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.trash' && contextId) { requestTrashProjectEntry(contextId, 'directory'); return }
    if (action.command === 'workspaceDirectory.newFile') {
      if (!projectEntryCanMutate(contextId, 'directory')) return
      setExplorerQuery('')
      setSelectedDirectoryId(contextId || null)
      setNewFileName('')
      return
    }
    if (action.command === 'workspaceDirectory.newDirectory') { openNewProjectDirectory(contextId); return }
    if (action.command === 'workspaceDirectory.expand' && contextId) {
      setExpanded((current) => new Set(current).add(contextId))
      const directory = findProjectTreeEntry(tree, contextId)
      if (directory?.kind === 'directory' && directory.children === undefined) void loadDirectory(contextId, directory.name)
      return
    }
    if (action.command === 'workspaceDirectory.collapse' && contextId) {
      setExpanded((current) => { const next = new Set(current); next.delete(contextId); return next })
      setSelectedDirectoryId((current) => current === contextId ? null : current)
      return
    }
    if (action.command === 'workspaceExplorer.collapseAll') { setExpanded(new Set()); setSelectedDirectoryId(null); return }
    if (action.command === 'workspaceExplorer.refresh') { void refreshExplorer(); return }

    const tabId = action.contextKind === 'editor-remote-tab' ? `remote:${contextId}` : contextId
    const tabIndex = tabsRef.current.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) return
    const targetTab = tabsRef.current[tabIndex]
    if (action.command === 'editorTab.save') { void saveEditorTabById(tabId); return }
    if (action.command === 'editorTab.close') { requestCloseEditorTabs([tabId]); return }
    if (action.command === 'editorTab.closeOthers') { requestCloseEditorTabs(tabsRef.current.filter((tab) => tab.id !== tabId).map((tab) => tab.id)); return }
    if (action.command === 'editorTab.closeRight') { requestCloseEditorTabs(tabsRef.current.slice(tabIndex + 1).map((tab) => tab.id)); return }
    if (action.command === 'editorTab.closeAll') { requestCloseEditorTabs(tabsRef.current.map((tab) => tab.id)); return }
    if (targetTab.source !== 'remote' || !targetTab.remote) return
    activationIntent.current += 1
    activeIdRef.current = targetTab.id
    setActiveId(targetTab.id)
    if (action.command === 'editorRemote.compare' || action.command === 'editorRemote.upload') { void compareRemoteFile(); return }
    if (action.command === 'editorRemote.reveal') {
      void window.vincodeLab.remoteFiles.revealLocal(targetTab.remote.file.id).catch((error) => {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'filesystem',
            operation: 'reveal-remote-local-copy',
            title: 'Copia locale non mostrata',
            fallbackDescription: 'Il file è rimasto aperto nell’Editor. Verifica il Finder e riprova.',
          }),
          fileId: targetTab.id,
        })
      })
    }
  }) ?? (() => undefined), [compareRemoteFile, duplicateProjectEntryFromMenu, loadDirectory, openFile, openNewProjectDirectory, openRenameProjectEntry, projectEntryCanMutate, refreshExplorer, requestCloseEditorTabs, requestTrashProjectEntry, saveEditorTabById, tree])

  const restoredExpandedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!initialState || initialState.expandedDirectoryIds.length === 0 || tree.length === 0) return
    const restoreKey = initialState.expandedDirectoryIds.join('\0')
    if (restoredExpandedKey.current === restoreKey) return
    restoredExpandedKey.current = restoreKey
    let cancelled = false

    void (async () => {
      const directoryIds = [...initialState.expandedDirectoryIds]
        .sort((left, right) => left.split('/').length - right.split('/').length)
      for (const directoryId of directoryIds) {
        try {
          const result = await window.vincodeLab.files.listDirectory(directoryId)
          if (cancelled) return
          setTree((current) => replaceDirectoryChildren(current, directoryId, result.entries))
        } catch (error) {
          if (cancelled) return
          setExpanded((current) => {
            const next = new Set(current)
            next.delete(directoryId)
            return next
          })
          setExplorerFailure({
            error: reportEditorFailure(error, {
              category: 'filesystem',
              operation: 'restore-expanded-directory',
              severity: 'warning',
              title: 'Cartella non ripristinata',
              fallbackDescription: 'Una cartella salvata non è più disponibile. Gli altri file e tab sono stati ripristinati.',
            }),
            recovery: { kind: 'load-directory', directoryId, directoryName: directoryId.split('/').at(-1) ?? directoryId },
          })
        }
      }
    })()

    return () => { cancelled = true }
  }, [initialState, tree.length])

  const filteredTree = useMemo(() => filterEditorTree(tree, explorerQuery), [explorerQuery, tree])
  useApplicationMenuCommand('editor.save', () => { void saveActive() })
  useApplicationMenuCommand('editor.search', () => { if (editorView.current) openSearchPanel(editorView.current) })
  useApplicationMenuCommand('editor.focusExplorer', focusExplorer)
  useApplicationMenuCommand('editor.nextTab', () => cycleOpenTab(1))
  useApplicationMenuCommand('editor.previousTab', () => cycleOpenTab(-1))
  useApplicationMenuCommand('editor.close', () => { if (activeIdRef.current) closeTab(activeIdRef.current) })
  useApplicationMenuCommand('editor.refresh', () => { void refreshExplorer() })

  const recoveryActionFor = (failure: EditorFailure): ErrorNoticeAction | undefined => {
    const recovery = failure.recovery
    if (!recovery) return undefined
    switch (recovery.kind) {
      case 'refresh-explorer': return { label: 'Riprova', onClick: () => refreshExplorer(true) }
      case 'open-workspace-file': return { label: 'Riapri file', onClick: () => openFile(recovery.fileId) }
      case 'open-remote-file': return { label: 'Riapri file remoto', onClick: () => openRemoteFile(recovery.fileId) }
      case 'save-all': return { label: 'Salva i file', onClick: saveAll }
      case 'save-file': return { label: 'Riprova salvataggio', onClick: () => saveEditorTabById(recovery.fileId) }
      case 'compare-remote': return { label: 'Riprova confronto', onClick: compareRemoteFile }
      case 'upload-remote': return { label: 'Riprova caricamento', onClick: () => uploadRemoteFile(recovery.force) }
      case 'create-file': return { label: 'Riprova creazione', onClick: () => createFile(recovery.fileName) }
      case 'load-directory': return { label: 'Riprova apertura', onClick: () => loadDirectory(recovery.directoryId, recovery.directoryName) }
    }
  }

  const gitStatusByDirectory = useMemo(() => {
    const directories = new Map<string, number>()
    for (const [filePath, file] of gitStatusByPath) {
      if (file.previousPath === filePath) continue
      const segments = filePath.split('/').filter(Boolean)
      for (let index = 1; index < segments.length; index += 1) {
        const directoryId = segments.slice(0, index).join('/')
        directories.set(directoryId, (directories.get(directoryId) ?? 0) + 1)
      }
    }
    return directories
  }, [gitStatusByPath])

  const draftDirectoryId = newFileName === null ? undefined : selectedDirectoryId ?? ''
  const newFileNodeValue = draftDirectoryId === undefined ? null : `editor:new-file:${draftDirectoryId || 'root'}`
  const editorTreeCollection = useMemo(() => createTreeCollection<EditorTreeNode>({
    isNodeDisabled: (node) => (node.kind === 'file' && loadingFile !== null) || (node.kind === 'new-file' && creatingFile),
    nodeToChildren: (node) => 'children' in node ? node.children ?? [] : [],
    nodeToChildrenCount: (node) => node.kind === 'directory' ? node.loaded ? node.children?.length ?? 0 : 1 : undefined,
    nodeToString: (node) => node.name,
    nodeToValue: (node) => node.value,
    rootNode: {
      kind: 'root',
      value: 'editor:root',
      name: 'File del progetto',
      children: [
        ...(draftDirectoryId === '' ? [{ kind: 'new-file' as const, value: 'editor:new-file:root', name: newFileName ?? '', directoryId: '' }] : []),
        ...toEditorTreeNodes(filteredTree, draftDirectoryId, newFileName ?? ''),
      ],
    },
  }), [creatingFile, draftDirectoryId, filteredTree, loadingFile, newFileName])
  const editorExpandedValue = useMemo(() => [...expanded].filter((value) => editorTreeCollection.findNode(value)?.kind === 'directory'), [editorTreeCollection, expanded])
  const editorSelectedValue = useMemo(() => {
    const value = selectedDirectoryId ?? (activeTab?.source === 'workspace' ? activeTab.id : null)
    return value && editorTreeCollection.findNode(value) ? [value] : []
  }, [activeTab, editorTreeCollection, selectedDirectoryId])

  const renderEditorTreeNode = (node: EditorTreeNode, indexPath: number[]): ReactNode => <TreeView.NodeProvider indexPath={indexPath} key={node.value} node={node}>
    {node.kind === 'root' ? node.children.map((child, index) => renderEditorTreeNode(child, [index])) : node.kind === 'new-file' ? <TreeView.Item className={editorStyles.newFileForm}>
      {creatingFile ? <Spinner className={editorStyles.fileIcon} /> : <FilePlus2 aria-hidden="true" className={editorStyles.fileIcon} />}
      <TreeView.NodeContext>{({ renaming }) => <TreeView.ItemText className={editorStyles.treeLabel} hidden={renaming}>{creatingFile ? 'Creazione…' : node.name || 'Nuovo file'}</TreeView.ItemText>}</TreeView.NodeContext>
      <TreeView.Context>{({ cancelRenaming }) => <TreeView.NodeRenameInput aria-label="Nome del nuovo file" autoComplete="off" className={editorStyles.newFileInput} disabled={creatingFile} onBlurCapture={(event) => {
        if (event.currentTarget.value.trim()) return
        cancelRenaming()
        setNewFileName(null)
      }} onChange={(event) => {
        setNewFileName(event.currentTarget.value)
      }} onKeyDownCapture={(event) => {
        const cancelFromKeyboard = event.key === 'Escape' || (event.key === 'Enter' && !event.currentTarget.value.trim())
        if (!cancelFromKeyboard) return
        if (event.key === 'Enter') cancelRenaming()
        setNewFileName(null)
        window.setTimeout(() => newFileTrigger.current?.focus(), 0)
      }} placeholder="Nome file" value={newFileName ?? ''} />}</TreeView.Context>
      {!creatingFile && newFileNodeValue === node.value && <StartTreeNodeRename attempt={newFileRenameAttempt} value={node.value} />}
    </TreeView.Item> : node.kind === 'file' ? (() => {
      const gitFile = gitStatusByPath.get(node.id)
      const gitStatus = gitFile ? gitFileStatusLabel(gitFile) : null
      return <TreeView.Item className={activeId === node.id ? editorStyles.treeActive : editorStyles.treeFile} data-workspace-context-id={node.id} data-workspace-context-kind="workspace-file" title={node.id}>
        {loadingFile === node.id ? <Spinner size={14} /> : fileIconFor(node.name) ? <Icon icon={fileIconFor(node.name)!} aria-hidden="true" className={editorStyles.fileIcon} /> : <FileCode2 aria-hidden="true" size={14} />}<TreeView.ItemText className={editorStyles.treeLabel}>{node.name}</TreeView.ItemText>{gitFile && gitStatus && <small aria-label={gitFileStatusLabel(gitFile).description} className={gitFileStatusClass(gitFile)} title={gitStatus.description}>{gitStatus.code}</small>}
      </TreeView.Item>
    })() : (() => {
      const isExpanded = expanded.has(node.id)
      const changedFiles = gitStatusByDirectory.get(node.id)
      return <TreeView.Branch>
        <TreeView.BranchControl className={selectedDirectoryId === node.id ? editorStyles.treeDirectorySelected : editorStyles.treeDirectory} data-context-expanded={isExpanded ? 'true' : undefined} data-workspace-context-id={node.id} data-workspace-context-kind="workspace-directory" title={selectedDirectoryId === node.id ? 'Cartella selezionata per i nuovi file' : node.id}>
          <TreeView.BranchTrigger aria-label={`${node.name}: espandi o comprimi`}>{loadingDirectory === node.id ? <Spinner size={14} /> : <TreeView.BranchIndicator><ChevronRight aria-hidden="true" size={14} /></TreeView.BranchIndicator>}</TreeView.BranchTrigger>
          <TreeView.BranchText><Icon icon={folderIconFor(node.name) ?? (isExpanded ? defaultFolderOpenedIcon : defaultFolderIcon)} aria-hidden="true" className={editorStyles.fileIcon} /><span className={editorStyles.treeLabel}>{node.name}</span>{changedFiles && <small aria-label={`Git: ${changedFiles} file modificati nella cartella`} className={editorStyles.gitStatusModified} title={`Git: ${changedFiles} file modificati nella cartella`}>M</small>}</TreeView.BranchText>
        </TreeView.BranchControl>
        <TreeView.BranchContent>{node.children?.map((child, index) => renderEditorTreeNode(child, [...indexPath, index]))}</TreeView.BranchContent>
      </TreeView.Branch>
    })()}
  </TreeView.NodeProvider>

  return <Splitter.Root asChild defaultFixedSize={explorerWidth} panels={editorPanels} storageKey={`vincodelab.editor.explorer-width:${workspace}`}><section className={editorStyles.workbench} aria-label="Editor progetto">
    <Splitter.Panel asChild id="editor-explorer"><aside className={editorStyles.explorer}>
      <div className={editorStyles.explorerTitle}><span className={editorStyles.explorerTitleLabel}><FolderTree aria-hidden="true" size={14} /> Explorer</span><div className={editorStyles.explorerActions}><span className={editorStyles.explorerActionCount} aria-label={`${tree.length} elementi alla radice`}>{tree.length}</span><IconButton ref={newFileTrigger} tooltip="Nuovo file" className={editorStyles.explorerActionButton} aria-label="Nuovo file" disabled={newFileName !== null} onClick={() => { setExplorerQuery(''); setNewFileName('') }}><FilePlus2 aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Comprimi cartelle" className={editorStyles.explorerActionButton} aria-label="Comprimi cartelle" disabled={expanded.size === 0} onClick={() => { setExpanded(new Set()); setSelectedDirectoryId(null) }}><ChevronsUpDown aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Aggiorna explorer" className={editorStyles.explorerActionButton} aria-label="Aggiorna explorer" disabled={refreshingExplorer} onClick={() => void refreshExplorer()}>{refreshingExplorer ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" size={14} />}</IconButton></div></div>
      <Field.Root className={editorStyles.explorerSearch}><Search aria-hidden="true" size={14} /><Field.Input className={editorStyles.explorerSearchInput} aria-label="Filtra file nell’explorer" value={explorerQuery} onChange={(event) => setExplorerQuery(event.target.value)} placeholder="Filtra file…" type="search" /></Field.Root>
      {explorerFailure && <ErrorNotice action={recoveryActionFor(explorerFailure)} className={editorStyles.failure} error={explorerFailure.error} />}
      <TreeView.Root canRename={(node) => node.kind === 'new-file' && !creatingFile} collection={editorTreeCollection} data-workspace-context-id="" data-workspace-context-kind="workspace-root" expandedValue={editorExpandedValue} selectedValue={editorSelectedValue} selectionMode="single" translations={{ renameInputLabel: 'Nome del nuovo file', treeLabel: 'File del progetto' }} typeahead onExpandedChange={({ expandedNodes, expandedValue }) => {
        const nextExpanded = new Set(expandedValue)
        setExpanded(nextExpanded)
        if (selectedDirectoryId && expanded.has(selectedDirectoryId) && !nextExpanded.has(selectedDirectoryId)) setSelectedDirectoryId(null)
        for (const node of expandedNodes) if (node.kind === 'directory' && !node.loaded) void loadDirectory(node.id, node.name)
      }} onRenameComplete={({ label, value }) => {
        if (value !== newFileNodeValue) return
        setNewFileName(label)
        void createFile(label)
      }} onSelectionChange={({ selectedNodes }) => {
        const node = selectedNodes.at(-1)
        if (node?.kind === 'directory') setSelectedDirectoryId(node.id)
        if (node?.kind === 'file' && loadingFile === null) { setSelectedDirectoryId(null); void openFile(node.id) }
      }} className={editorStyles.tree}>
        <TreeView.Tree ref={explorerTree}>{editorTreeCollection.getNodeChildren(editorTreeCollection.rootNode).map((node, index) => renderEditorTreeNode(node, [index]))}</TreeView.Tree>
        {filteredTree.length === 0 && newFileName === null && <p className={editorStyles.treeMessage}>{explorerQuery ? 'Nessun file corrispondente.' : 'Nessun file modificabile.'}</p>}
        {truncated && <p className={editorStyles.treeWarning}>Elenco limitato a 2.000 elementi.</p>}
      </TreeView.Root>
    </aside></Splitter.Panel>
    <Splitter.ResizeTrigger aria-label="Ridimensiona Explorer" id="editor-explorer:editor-document" title="Trascina per ridimensionare l’Explorer. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
    <Splitter.Panel id="editor-document"><Tabs.Root className={editorStyles.document} value={activeId ?? ''} onValueChange={({ value }) => {
      activationIntent.current += 1
      activeIdRef.current = value || null
      setActiveId(value || null)
    }}>
      <Tabs.List className={editorStyles.tabs} aria-label="File aperti">{tabs.map((tab) => {
        const contextId = tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id
        return <div className={activeId === tab.id ? editorStyles.tabSelected : editorStyles.tab} data-context-dirty={tab.content !== tab.savedContent ? 'true' : undefined} data-context-has-other-tabs={tabs.length > 1 ? 'true' : undefined} data-context-has-right-tabs={tabs.indexOf(tab) < tabs.length - 1 ? 'true' : undefined} data-workspace-context-id={contextId} data-workspace-context-kind={tab.source === 'remote' ? 'editor-remote-tab' : 'editor-workspace-tab'} key={tab.id}><Tabs.Trigger className={editorStyles.tabTrigger} value={tab.id}>{fileIconFor(tab.name) ? <Icon icon={fileIconFor(tab.name)!} aria-hidden="true" className={editorStyles.fileIcon} /> : <FileText aria-hidden="true" size={13} />}{tab.name}{tab.content !== tab.savedContent && <i className={editorStyles.tabModified} aria-label="Modificato" />}</Tabs.Trigger><IconButton tooltip={`Chiudi ${tab.name}`} size="icon-xs" className={editorStyles.tabClose} aria-label={`Chiudi ${tab.name}`} disabled={savingFileIds.has(tab.id)} onClick={() => closeTab(tab.id)}><X aria-hidden="true" size={13} /></IconButton></div>
      })}<Tabs.Indicator /></Tabs.List>
      <Tabs.Content className={editorStyles.filePanel} value={activeId ?? ''}>
        {documentFailure && <ErrorNotice action={recoveryActionFor(documentFailure)} className={editorStyles.failure} error={documentFailure.error} />}
        {activeTab ? <>
          <div className={editorStyles.toolbar}>
            <div className={editorStyles.fileMeta}>
              <span className={editorStyles.fileBreadcrumb} title={activeTab.remote?.file.remotePath ?? activeTab.id}>{activeTab.remote?.file.remotePath ?? activeTab.id}</span>
              <span className={editorStyles.languageBadge}><Braces aria-hidden="true" size={13} />{previewLabelFor(activeTab.preview, activeTab.name)}</span>
              {activeTab.remote
                ? <span className={remoteStatusClass(activeTab.remote.file.localState)} title={activeTab.remote.connectionTitle}>{remoteStateLabel(activeTab.remote.file.localState)}</span>
                : <span className={activeTab.content === activeTab.savedContent ? editorStyles.savedStatus : editorStyles.saveStatus}>{activeTab.preview ? 'Anteprima' : saving ? 'Salvataggio…' : activeTab.content === activeTab.savedContent ? 'Salvato' : 'Modifiche non salvate'}</span>}
            </div>
            {activeTab.source === 'workspace' && <div className={editorStyles.toolbarActions} aria-label="Azioni contestuali del file">
              {onOpenGitDiff && <Button size="sm" variant="plain" onClick={() => onOpenGitDiff(activeTab.id)} title="Apri il diff Git del file corrente"><FileDiff aria-hidden="true" /> Diff</Button>}
              {onSendContextToAi && <Button size="sm" variant="subtle" onClick={() => onSendContextToAi(Boolean(selection))} title={selection ? 'Invia file e righe selezionate a Pi' : 'Invia il file corrente a Pi'}><Sparkles aria-hidden="true" /> {selection ? 'Pi · selezione' : 'Chiedi a Pi'}</Button>}
            </div>}
            {canToggleTextPreview && <div className={editorStyles.toolbarActions}><Button aria-label={activeTab.preview ? 'Mostra sorgente' : 'Mostra anteprima'} title={activeTab.preview ? 'Mostra sorgente Markdown o CSV' : 'Mostra anteprima Markdown o CSV'} variant="outline" size="sm" onClick={toggleTextPreview}>{activeTab.preview ? 'Mostra sorgente' : 'Mostra anteprima'}</Button></div>}
            {!activeTab.preview && !activeTab.remote?.binary && <><span className={editorStyles.shortcuts}>⌘S salva · ⌘F cerca</span><div className={editorStyles.toolbarActions}><IconButton tooltip="Cerca nel file (⌘F)" aria-label="Cerca nel file" variant="outline" onClick={() => editorView.current && openSearchPanel(editorView.current)}><Search aria-hidden="true" /></IconButton><IconButton tooltip={activeFileConflict ? 'Risolvi il conflitto prima di salvare' : activeTab.remote ? 'Salva nella cache locale (⌘S)' : 'Salva file (⌘S)'} aria-label={activeTab.remote ? 'Salva copia locale' : 'Salva file'} variant="solid" onClick={() => void saveActive()} disabled={saving || Boolean(activeFileConflict) || activeTab.content === activeTab.savedContent}><Save aria-hidden="true" /></IconButton></div></>}
            {activeTab.remote && <div className={cx(editorStyles.toolbarActions, editorStyles.remoteActions)}><Button aria-label="Confronta con il server" title="Confronta la copia locale con il server" variant="outline" size="sm" onClick={() => void compareRemoteFile()} disabled={activeTab.content !== activeTab.savedContent}><FileDiff aria-hidden="true" /> Confronta</Button><Button aria-label="Carica sul server" title={activeTab.content !== activeTab.savedContent ? 'Salva prima la copia locale' : 'Controlla le differenze prima del caricamento'} size="sm" onClick={() => void compareRemoteFile()} disabled={activeTab.content !== activeTab.savedContent}><CloudUpload aria-hidden="true" /> Carica</Button></div>}
          </div>
          {activeFileConflict?.instance === activeTab.instance && <ErrorNotice
            action={{ label: 'Ricarica dal disco', onClick: () => requestReloadWorkspaceFile(activeFileConflict) }}
            error={activeFileConflict.error}
            secondaryAction={{ label: 'Sovrascrivi file', onClick: () => requestOverwriteWorkspaceFile(activeFileConflict) }}
          />}
          {activeTab.remote?.binary && <EmptyState className={editorStyles.remoteBinary} eyebrow="File remoto binario" icon={<FileCode2 size={30} />} title="Anteprima non disponibile" description="Puoi confrontare gli hash e caricare una nuova versione dal pannello di confronto." />}
        </> : <EmptyState className={editorStyles.empty} eyebrow="Explorer" icon={<FileCode2 size={30} />} title="Apri un file" description="Seleziona un file testuale dall’explorer per iniziare a modificarlo." />}
        <div className={cx('codemirror-host', editorStyles.codeMirrorHost)} hidden={!activeTab || Boolean(activeTab.remote?.binary)} ref={editorHost} />
      </Tabs.Content>
    </Tabs.Root></Splitter.Panel>
    <Dialog.Root
      finalFocusEl={() => projectEntryDialogOpener.current}
      ids={{ title: 'project-entry-dialog-title' }}
      initialFocusEl={() => projectEntryDialogInput.current}
      lazyMount
      open={projectEntryDialog !== null}
      unmountOnExit
      onOpenChange={({ open }) => { if (!open && !projectEntryDialog?.busy) setProjectEntryDialog(null) }}
    >
      <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={confirmationDialogStyles.content}>
        <p className={confirmationDialogStyles.eyebrow}>{projectEntryDialog?.mode === 'rename' ? 'Elemento del workspace' : 'Explorer'}</p>
        <Dialog.Title id="project-entry-dialog-title">{projectEntryDialog?.mode === 'rename' ? 'Rinomina elemento' : 'Nuova cartella'}</Dialog.Title>
        <Field.Root invalid={Boolean(projectEntryDialog?.error)}>
          <Field.Label>{projectEntryDialog?.mode === 'rename' ? 'Nuovo nome' : 'Nome cartella'}</Field.Label>
          <Field.Input ref={projectEntryDialogInput} autoComplete="off" disabled={projectEntryDialog?.busy} value={projectEntryDialog?.value ?? ''} onChange={(event) => setProjectEntryDialog((current) => current ? { ...current, error: null, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitProjectEntryDialog() } }} />
        </Field.Root>
        {projectEntryDialog?.error && <ErrorNotice action={{ label: 'Riprova', onClick: submitProjectEntryDialog }} error={projectEntryDialog.error} />}
        <div className={confirmationDialogStyles.actions}><Dialog.CloseTrigger asChild unstyled><Button disabled={projectEntryDialog?.busy} variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={projectEntryDialog?.busy || !projectEntryDialog?.value.trim()} onClick={() => void submitProjectEntryDialog()}>{projectEntryDialog?.busy ? <Spinner size={14} /> : null}{projectEntryDialog?.mode === 'rename' ? 'Rinomina' : 'Crea cartella'}</Button></div>
      </Dialog.Content></Dialog.Positioner></Dialog.Portal>
    </Dialog.Root>
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    {remoteDiffFile && remoteComparison && <RemoteDiffDialog file={remoteDiffFile} comparison={remoteComparison} busy={uploadingRemote} onClose={() => { setRemoteDiffFile(null); setRemoteComparison(null) }} onUpload={() => requestRemoteUpload(false)} onForceUpload={() => requestRemoteUpload(true)} />}
  </section></Splitter.Root>
}
