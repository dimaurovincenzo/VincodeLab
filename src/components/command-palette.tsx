import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Combobox, createListCollection, Dialog } from '@/components/ui'
import { rankFuzzyCandidates, type FuzzyUsageSignal } from '@/lib/fuzzy-score'
import { commandPaletteStyles as styles } from '@/theme/styles/command-palette'

export type CommandPaletteMode = 'commands' | 'files' | 'workspaces'

export type CommandPaletteItem = Readonly<{
  id: string
  label: string
  description?: string
  category?: string
  path?: string
  keywords?: readonly string[]
  shortcut?: string
  disabled?: boolean
  usage?: FuzzyUsageSignal
}>

export type CommandPaletteSelectionResult = void | boolean

export type CommandPaletteProps = Readonly<{
  open: boolean
  mode: CommandPaletteMode
  items: readonly CommandPaletteItem[]
  onOpenChange: (open: boolean) => void
  onSelect: (
    item: CommandPaletteItem,
  ) => CommandPaletteSelectionResult | Promise<CommandPaletteSelectionResult>
  onSelectionError?: (error: unknown, item: CommandPaletteItem) => void
  onQueryChange?: (query: string) => void
  finalFocusEl?: () => HTMLElement | null
  initialQuery?: string
  title?: string
  placeholder?: string
  emptyLabel?: string
  shortcutHint?: string
  maxResults?: number
}>

const modeCopy: Record<CommandPaletteMode, Readonly<{
  title: string
  modeLabel: string
  placeholder: string
  emptyLabel: string
  shortcut: string
}>> = {
  commands: {
    title: 'Palette comandi',
    modeLabel: 'Comandi',
    placeholder: 'Cerca un comando…',
    emptyLabel: 'Nessun comando corrispondente.',
    shortcut: '⌘⇧P',
  },
  files: {
    title: 'Apertura rapida',
    modeLabel: 'File',
    placeholder: 'Cerca un file per nome o percorso…',
    emptyLabel: 'Nessun file corrispondente.',
    shortcut: '⌘P',
  },
  workspaces: {
    title: 'Cambia workspace',
    modeLabel: 'Workspace',
    placeholder: 'Cerca un workspace…',
    emptyLabel: 'Nessun workspace corrispondente.',
    shortcut: '⌘P',
  },
}

function getActiveElement() {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

function assertUniqueItems(items: readonly CommandPaletteItem[]) {
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id.trim()) throw new Error('Command palette items require a non-empty id.')
    if (ids.has(item.id)) throw new Error(`Command palette item id "${item.id}" is duplicated.`)
    ids.add(item.id)
  }
  return items
}

function rankPaletteItems(
  query: string,
  items: readonly CommandPaletteItem[],
  maxResults: number,
) {
  return rankFuzzyCandidates(query, items, {
    getUsage: (item) => item.usage,
    maxResults,
  }).map(({ item }) => item)
}

export function CommandPalette({
  open,
  mode,
  items,
  onOpenChange,
  onSelect,
  onSelectionError,
  onQueryChange,
  finalFocusEl,
  initialQuery = '',
  title,
  placeholder,
  emptyLabel,
  shortcutHint,
  maxResults = 80,
}: CommandPaletteProps) {
  const id = useId()
  const copy = modeCopy[mode]
  const inputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectionPendingRef = useRef(false)
  const selectionFocusTargetRef = useRef<HTMLElement | null>(null)
  const focusListenerRef = useRef<((event: FocusEvent) => void) | null>(null)
  const [paletteState, setPaletteState] = useState(() => ({
    initialQuery,
    mode,
    open,
    opener: open ? getActiveElement() : null,
    query: initialQuery,
  }))
  const [selecting, setSelecting] = useState(false)

  if (
    paletteState.open !== open
    || paletteState.mode !== mode
    || paletteState.initialQuery !== initialQuery
  ) {
    setPaletteState({
      initialQuery,
      mode,
      open,
      opener: open && !paletteState.open ? getActiveElement() : paletteState.opener,
      query: open ? initialQuery : paletteState.query,
    })
  }

  const query = paletteState.query
  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  }, [query])
  const deferredQuery = useDeferredValue(query)

  const safeItems = useMemo(() => assertUniqueItems(items), [items])
  const rankedItems = useMemo(
    () => rankPaletteItems(deferredQuery, safeItems, maxResults),
    [deferredQuery, maxResults, safeItems],
  )
  const collection = useMemo(() => createListCollection({
    items: rankedItems,
    itemToValue: (item) => item.id,
    itemToString: (item) => item.label,
    isItemDisabled: (item) => Boolean(item.disabled),
  }), [rankedItems])

  const countLabel = `${rankedItems.length} ${rankedItems.length === 1 ? 'risultato' : 'risultati'}`
  const dialogTitle = title ?? copy.title
  const inputPlaceholder = placeholder ?? copy.placeholder
  const noResultsLabel = emptyLabel ?? copy.emptyLabel
  const displayedShortcut = shortcutHint ?? copy.shortcut
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const countId = `${id}-count`
  const stopTrackingExternalFocus = () => {
    if (focusListenerRef.current && typeof window !== 'undefined') {
      window.removeEventListener('focusin', focusListenerRef.current, true)
    }
    focusListenerRef.current = null
  }

  const startTrackingExternalFocus = () => {
    stopTrackingExternalFocus()
    selectionFocusTargetRef.current = null
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const listener = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target === document.body || contentRef.current?.contains(target)) return
      // Ark ripristina temporaneamente l'opener mentre completa l'uscita. Non
      // deve sovrascrivere il focus assegnato dal comando appena eseguito.
      if (target === paletteState.opener) return
      selectionFocusTargetRef.current = target
    }
    focusListenerRef.current = listener
    window.addEventListener('focusin', listener, true)
  }

  const resolveFinalFocus = () => {
    const explicitTarget = finalFocusEl?.()
    if (explicitTarget?.isConnected) return explicitTarget
    if (selectionFocusTargetRef.current?.isConnected) return selectionFocusTargetRef.current
    return paletteState.opener?.isConnected ? paletteState.opener : null
  }

  useEffect(() => () => stopTrackingExternalFocus(), [])

  const handleInputChange = (inputValue: string) => {
    queryRef.current = inputValue
    flushSync(() => setPaletteState((current) => ({ ...current, query: inputValue })))
    onQueryChange?.(inputValue)
  }

  const resolveSelectedItem = (selectedItem: CommandPaletteItem | undefined) => {
    if (queryRef.current === deferredQuery) return selectedItem
    return rankPaletteItems(queryRef.current, safeItems, maxResults)
      .find((item) => !item.disabled)
  }

  const handleSelection = async (item: CommandPaletteItem | undefined) => {
    if (!item || item.disabled || selectionPendingRef.current) return
    selectionPendingRef.current = true
    startTrackingExternalFocus()
    setSelecting(true)
    let closing = false
    try {
      const result = await onSelect(item)
      if (result !== false) {
        closing = true
        onOpenChange(false)
      }
    } catch (error) {
      onSelectionError?.(error, item)
    } finally {
      if (!closing) {
        stopTrackingExternalFocus()
        selectionFocusTargetRef.current = null
      }
      selectionPendingRef.current = false
      setSelecting(false)
    }
  }

  return <Dialog.Root
    closeOnEscape
    finalFocusEl={resolveFinalFocus}
    ids={{ description: descriptionId, title: titleId }}
    initialFocusEl={() => inputRef.current}
    lazyMount
    open={open}
    unmountOnExit
    onExitComplete={() => {
      const target = resolveFinalFocus()
      stopTrackingExternalFocus()
      selectionFocusTargetRef.current = null
      if (target?.isConnected) target.focus({ preventScroll: true })
    }}
    onOpenChange={({ open: nextOpen }) => {
      if (nextOpen !== open) onOpenChange(nextOpen)
    }}
  >
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Positioner className={styles.positioner}>
        <Dialog.Content ref={contentRef} className={styles.content} unstyled>
          <header className={styles.header}>
            <div className={styles.heading}>
              <Dialog.Title className={styles.title}>{dialogTitle}</Dialog.Title>
              <span className={styles.mode}>{copy.modeLabel}</span>
            </div>
            <kbd aria-label={`Scorciatoia ${displayedShortcut}`} className={styles.shortcut}>{displayedShortcut}</kbd>
          </header>

          <Dialog.Description className={styles.srOnly}>
            Digita per filtrare, usa le frecce per navigare, Invio per scegliere ed Esc per chiudere.
          </Dialog.Description>

          <Combobox.Root
            aria-busy={query !== deferredQuery}
            autoFocus
            className={styles.body}
            closeOnSelect={false}
            collection={collection}
            defaultHighlightedValue={rankedItems[0]?.id ?? null}
            disabled={selecting}
            inputBehavior="autohighlight"
            inputValue={query}
            loopFocus
            open={open}
            selectionBehavior="preserve"
            value={[]}
            onInputValueChange={({ inputValue, reason }) => {
              if (reason === 'input-change' || reason === 'clear-trigger') handleInputChange(inputValue)
            }}
            onValueChange={({ items: selectedItems }) => {
              void handleSelection(resolveSelectedItem(selectedItems[0]))
            }}
          >
            <Combobox.Label className={styles.srOnly}>{dialogTitle}</Combobox.Label>
            <Combobox.Control className={styles.control}>
              <Combobox.Input
                ref={inputRef}
                aria-describedby={`${descriptionId} ${countId}`}
                className={styles.input}
                placeholder={inputPlaceholder}
              />
            </Combobox.Control>
            <Combobox.Content className={styles.results}>
              <Combobox.List className={styles.list}>
                {rankedItems.map((item) => <Combobox.Item className={styles.item} item={item} key={item.id}>
                  <span className={styles.itemMain}>
                    <Combobox.ItemText className={styles.itemTitle}>{item.label}</Combobox.ItemText>
                    {(item.description || item.path) && <span className={styles.itemDescription}>{item.description ?? item.path}</span>}
                  </span>
                  <span aria-hidden="true" className={styles.itemMeta}>
                    {item.category && <span className={styles.itemCategory}>{item.category}</span>}
                    {item.shortcut && <kbd className={styles.itemShortcut}>{item.shortcut}</kbd>}
                  </span>
                </Combobox.Item>)}
                {rankedItems.length === 0 && <Combobox.Empty className={styles.empty}>{noResultsLabel}</Combobox.Empty>}
              </Combobox.List>
            </Combobox.Content>
          </Combobox.Root>

          <footer className={styles.footer}>
            <span aria-live="polite" id={countId} role="status">{countLabel}</span>
            <span aria-hidden="true" className={styles.instructions}>
              <span><kbd className={styles.instructionKey}>↑↓</kbd> naviga</span>
              <span><kbd className={styles.instructionKey}>↵</kbd> apri</span>
              <span><kbd className={styles.instructionKey}>esc</kbd> chiudi</span>
            </span>
          </footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
