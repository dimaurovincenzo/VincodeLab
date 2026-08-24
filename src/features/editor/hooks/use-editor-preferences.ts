import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'

export function useEditorPreferences() {
  const { preferences } = useAppPreferences()

  return {
    editorAutoSave: effectivePreference(preferences, 'editor.autoSave', false),
    editorFontSize: effectivePreference(preferences, 'editor.fontSize', 13),
    editorTabSize: effectivePreference(preferences, 'editor.tabSize', 2),
    editorWordWrap: effectivePreference(preferences, 'editor.wordWrap', true),
    explorerWidth: effectivePreference(preferences, 'editor.explorerWidth', 320),
  }
}
