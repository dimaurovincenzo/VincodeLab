export type TerminalPreferences = { fontSize: number; followOutput: boolean }
export type TerminalPreferencesErrorOptions = { onError?: (error: unknown) => void }
export function nextTerminalFontSize(current: number, delta: number): number
export function readTerminalPreferences(workspace: string, options?: TerminalPreferencesErrorOptions): TerminalPreferences
export function writeTerminalPreferences(workspace: string, preferences: TerminalPreferences, options?: TerminalPreferencesErrorOptions): boolean
