import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { parseCsvPreview } from '../model/editor-document'
import type { EditorPreview } from '../model/editor.types'

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

export function mediaPreviewExtension(preview: EditorPreview, content: string) {
  const widget = new MediaPreviewWidget(preview, content)
  const decoration = (preview === 'csv' || preview === 'markdown') && content.length > 0
    ? Decoration.replace({ widget, block: true }).range(0, content.length)
    : Decoration.widget({ widget, block: true }).range(0)
  return EditorView.decorations.of(Decoration.set([decoration]))
}
