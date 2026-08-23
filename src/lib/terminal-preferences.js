const DEFAULT_PREFERENCES = Object.freeze({ fontSize: 11, followOutput: true })
const MIN_FONT_SIZE = 11
const MAX_FONT_SIZE = 20

function preferenceKey(workspace) {
  return `vincodelab:terminal:${workspace}`
}

export function nextTerminalFontSize(current, delta) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + delta))
}

export function readTerminalPreferences(workspace, options = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(preferenceKey(workspace)) ?? '{}')
    return {
      fontSize: Number.isInteger(parsed.fontSize) ? nextTerminalFontSize(parsed.fontSize, 0) : DEFAULT_PREFERENCES.fontSize,
      followOutput: typeof parsed.followOutput === 'boolean' ? parsed.followOutput : DEFAULT_PREFERENCES.followOutput,
    }
  } catch (error) {
    options.onError?.(error)
    return { ...DEFAULT_PREFERENCES }
  }
}

export function writeTerminalPreferences(workspace, preferences, options = {}) {
  try {
    localStorage.setItem(preferenceKey(workspace), JSON.stringify({
      fontSize: nextTerminalFontSize(preferences.fontSize, 0),
      followOutput: preferences.followOutput === true,
    }))
    return true
  } catch (error) {
    options.onError?.(error)
    return false
  }
}
