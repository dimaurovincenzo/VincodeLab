import { closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

export function createEditorSearchPanel(view: EditorView) {
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
