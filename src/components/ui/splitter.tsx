import { Splitter as ArkSplitter, useSplitterContext, type SplitterPanelProps, type SplitterResizeDetails, type SplitterResizeEndDetails, type SplitterResizeTriggerProps, type SplitterRootProps as ArkSplitterRootProps } from '@ark-ui/react/splitter'
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEventHandler, type MutableRefObject, type ReactNode, type Ref } from 'react'
import { createStyleContext } from '../../../styled-system/jsx'
import { splitter } from '../../../styled-system/recipes'

type FixedPanel = 'start' | 'end'

type PersistentSplitterContextValue = {
  resetToDefault: () => void
}

export type SplitterRootProps = Omit<ArkSplitterRootProps, 'defaultSize' | 'onResize' | 'onResizeEnd' | 'size'> & {
  defaultFixedSize: number
  fixedPanel?: FixedPanel
  onResize?: (details: SplitterResizeDetails) => void
  onResizeEnd?: (details: SplitterResizeEndDetails) => void
  storageKey: string
}

const PersistentSplitterContext = createContext<PersistentSplitterContextValue | null>(null)
const { withProvider, withContext } = createStyleContext(splitter)
const StyledRoot = withProvider(ArkSplitter.Root, 'root')
const StyledPanel = withContext(ArkSplitter.Panel, 'panel')
const StyledResizeTrigger = withContext(ArkSplitter.ResizeTrigger, 'resizeTrigger')
const StyledResizeTriggerIndicator = withContext(ArkSplitter.ResizeTriggerIndicator, 'resizeTriggerIndicator')

function cssPanelSize(size: number | string | undefined, fallback: string) {
  if (size === undefined) return fallback
  return typeof size === 'number' ? `${size}%` : size
}

function readStorageSize(storage: Storage, storageKey: string) {
  const stored = Number(storage.getItem(storageKey))
  return Number.isFinite(stored) && stored > 0 ? stored : null
}

function writeStorageSize(storage: Storage, storageKey: string, size: number) {
  const roundedSize = Math.round(size)
  if (roundedSize <= 0) return false
  storage.setItem(storageKey, String(roundedSize))
  return true
}

function readStoredSize(storageKey: string, fallback: number) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = readStorageSize(window.localStorage, storageKey)
    if (stored !== null) return stored
  } catch {
    // Una webview che blocca lo storage durevole può ancora usare il fallback di sessione.
  }

  let legacySize: number | null = null
  try {
    legacySize = readStorageSize(window.sessionStorage, storageKey)
  } catch {
    return fallback
  }
  if (legacySize === null) return fallback

  try {
    if (writeStorageSize(window.localStorage, storageKey, legacySize)) window.sessionStorage.removeItem(storageKey)
  } catch {
    // La misura legacy resta disponibile per la durata della sessione corrente.
  }
  return legacySize
}

function writeStoredSize(storageKey: string, size: number) {
  if (typeof window === 'undefined' || !Number.isFinite(size) || size <= 0) return
  try {
    if (writeStorageSize(window.localStorage, storageKey, size)) {
      window.sessionStorage.removeItem(storageKey)
      return
    }
  } catch {
    // Il fallback di sessione mantiene il layout stabile se localStorage non è disponibile.
  }
  try {
    writeStorageSize(window.sessionStorage, storageKey, size)
  } catch {
    // Il layout resta utilizzabile anche quando entrambi gli storage sono bloccati.
  }
}

function fixedPanelLayout(panelCount: number, fixedPanel: FixedPanel, size: number) {
  const layout = Array<number | string | undefined>(panelCount).fill(undefined)
  layout[fixedPanel === 'start' ? 0 : panelCount - 1] = `${size}px`
  return layout as Array<number | string>
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as MutableRefObject<T | null>).current = value
}

const SplitterRoot = forwardRef<HTMLDivElement, SplitterRootProps>(function SplitterRoot({
  children,
  defaultFixedSize,
  fixedPanel = 'start',
  onResize,
  onResizeEnd,
  orientation = 'horizontal',
  panels,
  style,
  storageKey,
  ...props
}, forwardedRef) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const previousDefaults = useRef({ defaultFixedSize, storageKey })
  const [size, setSize] = useState(() => fixedPanelLayout(panels.length, fixedPanel, readStoredSize(storageKey, defaultFixedSize)))

  useEffect(() => {
    const previous = previousDefaults.current
    if (previous.defaultFixedSize === defaultFixedSize && previous.storageKey === storageKey) return
    previousDefaults.current = { defaultFixedSize, storageKey }
    const nextSize = previous.storageKey === storageKey ? defaultFixedSize : readStoredSize(storageKey, defaultFixedSize)
    setSize(fixedPanelLayout(panels.length, fixedPanel, nextSize))
    writeStoredSize(storageKey, nextSize)
  }, [defaultFixedSize, fixedPanel, panels.length, storageKey])

  const resetToDefault = useCallback(() => {
    setSize(fixedPanelLayout(panels.length, fixedPanel, defaultFixedSize))
    writeStoredSize(storageKey, defaultFixedSize)
  }, [defaultFixedSize, fixedPanel, panels.length, storageKey])

  const handleResize = useCallback((details: SplitterResizeDetails) => {
    setSize(details.size)
    onResize?.(details)
  }, [onResize])

  const handleResizeEnd = useCallback((details: SplitterResizeEndDetails) => {
    const fixedIndex = fixedPanel === 'start' ? 0 : panels.length - 1
    const collapsedSize = panels[fixedIndex]?.collapsedSize
    const collapsedPixels = typeof collapsedSize === 'string' && collapsedSize.endsWith('px') ? Number.parseFloat(collapsedSize) : null
    const panel = Array.from(rootRef.current?.children ?? []).find((element) => (
      element instanceof HTMLElement
      && element.dataset.scope === 'splitter'
      && element.dataset.part === 'panel'
      && Number(element.dataset.index) === fixedIndex
    ))
    const panelRect = panel instanceof HTMLElement ? panel.getBoundingClientRect() : null
    const rootRect = rootRef.current?.getBoundingClientRect()
    const measuredSize = panelRect ? (orientation === 'horizontal' ? panelRect.width : panelRect.height) : 0
    const rootSize = rootRect ? (orientation === 'horizontal' ? rootRect.width : rootRect.height) : 0
    const fallbackSize = (details.size[fixedIndex] ?? 0) * rootSize / 100
    const nextSize = measuredSize || fallbackSize
    if (collapsedPixels === null || Math.abs(nextSize - collapsedPixels) > 1) writeStoredSize(storageKey, nextSize)
    onResizeEnd?.(details)
  }, [fixedPanel, onResizeEnd, orientation, panels, storageKey])

  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    assignRef(forwardedRef, node)
  }, [forwardedRef])

  const persistence = useMemo(() => ({ resetToDefault }), [resetToDefault])

  return <PersistentSplitterContext.Provider value={persistence}>
    <StyledRoot {...props} onResize={handleResize} onResizeEnd={handleResizeEnd} orientation={orientation} panels={panels} ref={setRootRef} size={size} style={{
      display: 'var(--splitter-display, flex)',
      height: 'var(--splitter-height, 100%)',
      overflow: 'var(--splitter-overflow, hidden)',
      width: 'var(--splitter-width, 100%)',
      ...style,
    }}>{children as ReactNode}</StyledRoot>
  </PersistentSplitterContext.Provider>
})

const SplitterPanel = forwardRef<HTMLDivElement, SplitterPanelProps>(function SplitterPanel({ id, style, ...props }, ref) {
  const splitterApi = useSplitterContext()
  const panel = splitterApi.getPanelById(id)
  const collapsed = panel.collapsible && splitterApi.isPanelCollapsed(id)
  const minSize = collapsed ? panel.collapsedSize ?? 0 : panel.minSize
  const axisStyle = splitterApi.orientation === 'horizontal' ? {
    minWidth: `var(--splitter-panel-min-size, ${cssPanelSize(minSize, '0px')})`,
    maxWidth: `var(--splitter-panel-max-size, ${cssPanelSize(panel.maxSize, 'none')})`,
  } : {
    minHeight: `var(--splitter-panel-min-size, ${cssPanelSize(minSize, '0px')})`,
    maxHeight: `var(--splitter-panel-max-size, ${cssPanelSize(panel.maxSize, 'none')})`,
  }

  return <StyledPanel {...props} id={id} ref={ref} style={{ ...axisStyle, ...style }} />
})

const SplitterResizeTrigger = forwardRef<HTMLButtonElement, SplitterResizeTriggerProps>(function SplitterResizeTrigger({ onDoubleClick, ...props }, ref) {
  const persistence = useContext(PersistentSplitterContext)
  const handleDoubleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    onDoubleClick?.(event)
    if (event.defaultPrevented || !persistence) return
    // La root Ark è controllata tramite `size`: aggiornare quella singola fonte di
    // verità evita che un callback di resize misuri e ripersisti la geometria stale.
    persistence.resetToDefault()
  }

  return <StyledResizeTrigger {...props} onDoubleClick={handleDoubleClick} ref={ref} />
})

const Splitter = {
  Root: SplitterRoot,
  Panel: SplitterPanel,
  ResizeTrigger: SplitterResizeTrigger,
  ResizeTriggerIndicator: StyledResizeTriggerIndicator,
  Context: ArkSplitter.Context,
}

export { Splitter }
export type { SplitterPanelData, SplitterResizeDetails, SplitterResizeEndDetails } from '@ark-ui/react/splitter'
