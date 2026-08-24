import { Splitter as ArkSplitter, useSplitterContext, type SplitterPanelProps, type SplitterResizeDetails, type SplitterResizeEndDetails, type SplitterResizeTriggerProps, type SplitterRootProps as ArkSplitterRootProps } from '@ark-ui/react/splitter'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEventHandler, type MutableRefObject, type ReactNode, type Ref } from 'react'
import { createStyleContext } from '../../../styled-system/jsx'
import { splitter } from '../../../styled-system/recipes'
import { IconButton, type IconButtonProps } from './icon-button'

type FixedPanel = 'start' | 'end'

type PersistentSplitterContextValue = {
  collapsePanel: (panelId: string) => void
  collapsed: boolean
  expandPanel: (panelId: string) => void
  fixedPanelId: string
  resetToDefault: () => void
}

type SplitterCollapseTriggerProps = Omit<IconButtonProps, 'aria-label' | 'children' | 'onClick' | 'tooltip'> & {
  collapseLabel: string
  expandLabel: string
  panelId: string
  side?: FixedPanel
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

function collapseStorageKey(storageKey: string) {
  return `${storageKey}:collapsed`
}

function readStoredCollapsed(storageKey: string) {
  if (typeof window === 'undefined') return false
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const value = storage.getItem(collapseStorageKey(storageKey))
      if (value === 'true') return true
      if (value === 'false') return false
    } catch {
      // Lo stato resta disponibile nella root controllata anche senza persistenza.
    }
  }
  return false
}

function writeStoredCollapsed(storageKey: string, collapsed: boolean) {
  if (typeof window === 'undefined') return
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.setItem(collapseStorageKey(storageKey), String(collapsed))
      if (storage === window.localStorage) {
        window.sessionStorage.removeItem(collapseStorageKey(storageKey))
        return
      }
    } catch {
      // Il fallback successivo mantiene il controllo utilizzabile in webview restrittive.
    }
  }
}

function fixedPanelLayout(panelCount: number, fixedPanel: FixedPanel, size: number | string) {
  const layout = Array<number | string | undefined>(panelCount).fill(undefined)
  layout[fixedPanel === 'start' ? 0 : panelCount - 1] = typeof size === 'number' ? `${size}px` : size
  return layout as Array<number | string>
}

function initialPanelLayout(panels: SplitterRootProps['panels'], fixedPanel: FixedPanel, storageKey: string, defaultFixedSize: number) {
  const fixedIndex = fixedPanel === 'start' ? 0 : panels.length - 1
  const panel = panels[fixedIndex]
  const fixedSize = panel?.collapsible && readStoredCollapsed(storageKey)
    ? panel.collapsedSize ?? '0px'
    : readStoredSize(storageKey, defaultFixedSize)
  return fixedPanelLayout(panels.length, fixedPanel, fixedSize)
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as MutableRefObject<T | null>).current = value
}

const SplitterRoot = forwardRef<HTMLDivElement, SplitterRootProps>(function SplitterRoot({
  children,
  defaultFixedSize,
  fixedPanel = 'start',
  ids,
  onCollapse,
  onExpand,
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
  const fixedIndex = fixedPanel === 'start' ? 0 : panels.length - 1
  const fixedPanelId = panels[fixedIndex]?.id ?? ''
  const [collapsed, setCollapsed] = useState(() => Boolean(panels[fixedIndex]?.collapsible && readStoredCollapsed(storageKey)))
  const [size, setSize] = useState(() => initialPanelLayout(panels, fixedPanel, storageKey, defaultFixedSize))

  useEffect(() => {
    const previous = previousDefaults.current
    if (previous.defaultFixedSize === defaultFixedSize && previous.storageKey === storageKey) return
    previousDefaults.current = { defaultFixedSize, storageKey }
    const nextSize = previous.storageKey === storageKey ? defaultFixedSize : readStoredSize(storageKey, defaultFixedSize)
    const nextCollapsed = previous.storageKey === storageKey ? false : Boolean(panels[fixedIndex]?.collapsible && readStoredCollapsed(storageKey))
    setCollapsed(nextCollapsed)
    setSize(previous.storageKey === storageKey
      ? fixedPanelLayout(panels.length, fixedPanel, nextSize)
      : initialPanelLayout(panels, fixedPanel, storageKey, defaultFixedSize))
    writeStoredSize(storageKey, nextSize)
  }, [defaultFixedSize, fixedIndex, fixedPanel, panels, storageKey])

  const resetToDefault = useCallback(() => {
    setSize(fixedPanelLayout(panels.length, fixedPanel, defaultFixedSize))
    setCollapsed(false)
    writeStoredSize(storageKey, defaultFixedSize)
    writeStoredCollapsed(storageKey, false)
  }, [defaultFixedSize, fixedPanel, panels.length, storageKey])

  const handleCollapse = useCallback((details: Parameters<NonNullable<ArkSplitterRootProps['onCollapse']>>[0]) => {
    setCollapsed(details.panelId === fixedPanelId)
    writeStoredCollapsed(storageKey, true)
    onCollapse?.(details)
  }, [fixedPanelId, onCollapse, storageKey])

  const handleExpand = useCallback((details: Parameters<NonNullable<ArkSplitterRootProps['onExpand']>>[0]) => {
    if (details.panelId === fixedPanelId) setCollapsed(false)
    writeStoredCollapsed(storageKey, false)
    onExpand?.(details)
  }, [fixedPanelId, onExpand, storageKey])

  const collapsePanel = useCallback((panelId: string) => {
    if (panelId !== fixedPanelId || !panels[fixedIndex]?.collapsible) return
    const collapsedSize = panels[fixedIndex]?.collapsedSize ?? '0px'
    setSize(fixedPanelLayout(panels.length, fixedPanel, collapsedSize))
    setCollapsed(true)
    writeStoredCollapsed(storageKey, true)
    const numericSize = typeof collapsedSize === 'number' ? collapsedSize : Number.parseFloat(collapsedSize)
    onCollapse?.({ panelId, size: Number.isFinite(numericSize) ? numericSize : 0 })
  }, [fixedIndex, fixedPanel, fixedPanelId, onCollapse, panels, storageKey])

  const expandPanel = useCallback((panelId: string) => {
    if (panelId !== fixedPanelId) return
    const expandedSize = readStoredSize(storageKey, defaultFixedSize)
    setSize(fixedPanelLayout(panels.length, fixedPanel, expandedSize))
    setCollapsed(false)
    writeStoredCollapsed(storageKey, false)
    onExpand?.({ panelId, size: expandedSize })
  }, [defaultFixedSize, fixedPanel, fixedPanelId, onExpand, panels.length, storageKey])

  useEffect(() => {
    if (!collapsed || !fixedPanelId) return
    const collapsedSize = panels[fixedIndex]?.collapsedSize ?? 0
    const numericSize = typeof collapsedSize === 'number' ? collapsedSize : Number.parseFloat(collapsedSize)
    onCollapse?.({ panelId: fixedPanelId, size: Number.isFinite(numericSize) ? numericSize : 0 })
  // Il cambio di storage identifica una nuova vista da sincronizzare una sola volta.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

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

  const persistence = useMemo(() => ({ collapsePanel, collapsed, expandPanel, fixedPanelId, resetToDefault }), [collapsePanel, collapsed, expandPanel, fixedPanelId, resetToDefault])

  return <PersistentSplitterContext.Provider value={persistence}>
    <StyledRoot {...props} data-fixed-panel-collapsed={collapsed ? 'true' : undefined} ids={{ ...ids, panel: ids?.panel ?? ((id) => String(id)) }} onCollapse={handleCollapse} onExpand={handleExpand} onResize={handleResize} onResizeEnd={handleResizeEnd} orientation={orientation} panels={panels} ref={setRootRef} size={size} style={{
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
  const persistence = useContext(PersistentSplitterContext)
  const panel = splitterApi.getPanelById(id)
  const collapsed = panel.collapsible && (persistence?.fixedPanelId === id ? persistence.collapsed : splitterApi.isPanelCollapsed(id))
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

function SplitterCollapseTrigger({ collapseLabel, expandLabel, panelId, side = 'start', ...props }: SplitterCollapseTriggerProps) {
  const splitterApi = useSplitterContext()
  const persistence = useContext(PersistentSplitterContext)
  const panel = splitterApi.getPanelById(panelId)
  const controlsPersistentPanel = persistence?.fixedPanelId === panelId
  const collapsed = Boolean(panel.collapsible && (controlsPersistentPanel ? persistence.collapsed : splitterApi.isPanelCollapsed(panelId)))
  const label = collapsed ? expandLabel : collapseLabel
  const Icon = side === 'start'
    ? collapsed ? PanelLeftOpen : PanelLeftClose
    : collapsed ? PanelRightOpen : PanelRightClose

  return <IconButton
    {...props}
    aria-controls={panelId}
    aria-expanded={!collapsed}
    tooltip={label}
    onClick={() => {
      if (controlsPersistentPanel) {
        if (collapsed) persistence.expandPanel(panelId)
        else persistence.collapsePanel(panelId)
      } else if (collapsed) splitterApi.expandPanel(panelId)
      else splitterApi.collapsePanel(panelId)
    }}
  ><Icon aria-hidden="true" /></IconButton>
}

const Splitter = {
  Root: SplitterRoot,
  Panel: SplitterPanel,
  CollapseTrigger: SplitterCollapseTrigger,
  ResizeTrigger: SplitterResizeTrigger,
  ResizeTriggerIndicator: StyledResizeTriggerIndicator,
  Context: ArkSplitter.Context,
}

export { Splitter }
export type { SplitterCollapseTriggerProps }
export type { SplitterPanelData, SplitterResizeDetails, SplitterResizeEndDetails } from '@ark-ui/react/splitter'
