const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]'
const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"]'

/**
 * Global terminal shortcuts may keep working from xterm's hidden textarea, but
 * must never leak through a palette, dialog, or regular text field.
 */
export function suppressGlobalTerminalShortcut(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-xterm-host]')) return false
  return Boolean(target.closest(`${TEXT_ENTRY_SELECTOR}, ${OVERLAY_SELECTOR}`))
}
