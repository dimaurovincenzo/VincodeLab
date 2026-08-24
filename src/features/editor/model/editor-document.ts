import type { RemoteTrackedFile, WorkspaceSessionFileRef } from '@/bridge'
import type { VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import type { EditorPreview, EditorTab } from './editor.types'

export function remoteStateLabel(state: RemoteTrackedFile['localState']) {
  switch (state) {
    case 'synced': return 'Remoto · Sincronizzato'
    case 'modified': return 'Remoto · Modificato'
    case 'conflict': return 'Remoto · Conflitto'
    case 'offline': return 'Remoto · Offline'
  }
}

export function previewKindForFile(fileName: string): EditorPreview | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension ?? '')) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'csv') return 'csv'
  if (extension === 'md') return 'markdown'
  return undefined
}

export function parseCsvPreview(content: string) {
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

export function languageLabelFor(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const labels: Record<string, string> = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', json: 'JSON', md: 'Markdown', mdx: 'MDX', html: 'HTML', css: 'CSS', scss: 'SCSS', yml: 'YAML', yaml: 'YAML', sh: 'Shell', sql: 'SQL', py: 'Python' }
  return labels[extension ?? ''] ?? 'Testo'
}

export function previewLabelFor(preview: EditorPreview | undefined, fileName: string) {
  if (preview === 'image') return 'Immagine'
  if (preview === 'pdf') return 'PDF'
  if (preview === 'csv') return 'Tabella CSV'
  if (preview === 'markdown') return 'Markdown'
  return languageLabelFor(fileName)
}

export function editorStateKey(tab: EditorTab) {
  return `${tab.id}::${tab.preview ? `preview:${tab.preview}` : 'source'}`
}

export function editorDraftIdentity(workspace: string, source: EditorTab['source'], tabId: string): VolatileDraftIdentity {
  return { scope: 'project-editor', workspace, resource: JSON.stringify([source, tabId]) }
}

export function sessionFileRef(tab: EditorTab): WorkspaceSessionFileRef {
  return {
    source: tab.source,
    id: tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id,
    mode: tab.preview ? 'preview' : 'source',
  }
}

export function editorDocumentForTab(tab: EditorTab) {
  return tab.preview === 'image' || tab.preview === 'pdf' ? '' : tab.content
}
