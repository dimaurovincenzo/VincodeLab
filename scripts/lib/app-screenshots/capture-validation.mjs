import os from 'node:os'
import path from 'node:path'

export function assertCleanRendererText(text) {
  if (typeof text !== 'string') throw new Error('Testo renderer non disponibile per la verifica privacy.')
  const forbidden = [
    /\/Users\//u,
    /\b(?:access[_-]?token|api[_-]?key|password|secret)\s*[:=]/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  ]
  const match = forbidden.find((pattern) => pattern.test(text))
  if (match) throw new Error(`La vista contiene dati non ammessi per la pubblicazione (${match}).`)
  const privateMachineMarkers = new Set([
    os.userInfo().username,
    os.hostname(),
    path.basename(os.homedir()),
  ].filter((value) => typeof value === 'string' && value.length >= 3).map((value) => value.toLocaleLowerCase('en-US')))
  const normalizedText = text.toLocaleLowerCase('en-US')
  const privateMarker = [...privateMachineMarkers].find((marker) => normalizedText.includes(marker))
  if (privateMarker) throw new Error('La vista contiene un identificatore dell’account o del computer locale.')
}

export function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Screenshot PNG non valido.')
  }
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) }
}

export function shellGeometryExpression() {
  return `(() => {
    const viewport = {
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      width: window.innerWidth,
    }
    const root = document.querySelector('main')
    const navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
    if (!root || !navigation) throw new Error('Shell non disponibile per la verifica geometrica.')
    const serialize = (element) => {
      const rect = element.getBoundingClientRect()
      return { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width }
    }
    const rootBounds = serialize(root)
    const navigationBounds = serialize(navigation)
    const sectionBounds = [...navigation.querySelectorAll('[role="tab"]')].map((element) => ({ label: element.textContent?.trim() ?? '', ...serialize(element) }))
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1
    return {
      document: { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth },
      navigationBounds,
      rootBounds,
      sectionBounds,
      shellVisible: inside(rootBounds) && inside(navigationBounds) && sectionBounds.every(inside)
        && document.documentElement.scrollWidth <= viewport.width + 1
        && document.documentElement.scrollHeight <= viewport.height + 1,
      viewport,
    }
  })()`
}

export function cleanCaptureSurfaceExpression() {
  return `(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const alerts = [...document.querySelectorAll('[role="alert"]')]
      .filter(visible)
      .map((element) => element.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? '')
    const errorToasts = [...document.querySelectorAll('[data-scope="toast"], [data-part="root"]')]
      .filter((element) => visible(element) && /Azione interrotta|Operazione asincrona non completata|Ricarica interfaccia|Riferimento ERR-/u.test(element.textContent ?? ''))
      .map((element) => element.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? '')
    return {
      alerts: [...new Set(alerts)],
      invalidHiddenSelects: [...document.querySelectorAll('[id]')]
        .filter((element) => /(?::select|hidden-select)$/u.test(element.id) && (element.tagName !== 'SELECT' || typeof element.options?.[Symbol.iterator] !== 'function'))
        .map((element) => ({ id: element.id, optionsType: typeof element.options, tagName: element.tagName })),
      errorToasts: [...new Set(errorToasts)],
      rendererErrors: Array.isArray(globalThis.__vincodelabCaptureErrors) ? globalThis.__vincodelabCaptureErrors : [],
    }
  })()`
}
