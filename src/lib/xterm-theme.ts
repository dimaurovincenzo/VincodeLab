/**
 * xterm disegna su canvas e non può risolvere direttamente le variabili CSS.
 * Leggiamo quindi i token già calcolati dal browser, mantenendo una sola palette
 * nel design system e rispettando anche il cambio di aspetto dell'applicazione.
 */
function readColorToken(token: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!value) throw new Error(`Token del tema terminale non disponibile: ${token}`)
  return value
}

export function readXtermTheme() {
  const background = readColorToken('--code-surface')
  const foreground = readColorToken('--code-text')

  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground: readColorToken('--code-selection'),
    black: background,
    brightBlack: readColorToken('--code-muted'),
    white: foreground,
    brightWhite: foreground,
  }
}

export function observeXtermTheme(onThemeChange: (theme: ReturnType<typeof readXtermTheme>) => void) {
  const colorScheme = matchMedia('(prefers-color-scheme: dark)')
  const updateTheme = () => onThemeChange(readXtermTheme())
  const observer = new MutationObserver(updateTheme)

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  colorScheme.addEventListener('change', updateTheme)

  return () => {
    observer.disconnect()
    colorScheme.removeEventListener('change', updateTheme)
  }
}
