export { editorBridge } from './api/editor.bridge'
export { ProjectEditor } from './components/project-editor'
export { editorTabCloseTargets, editorWorkbenchCycleDirection } from './model/editor.commands'
export type { EditorTabCloseCommand } from './model/editor.commands'
export {
  editorDocumentForTab,
  editorDraftIdentity,
  editorStateKey,
  languageLabelFor,
  parseCsvPreview,
  previewKindForFile,
  previewLabelFor,
  remoteStateLabel,
  sessionFileRef,
} from './model/editor-document'
export { clearCachedEditorStateForFile } from './model/editor-state'
export { gitStatusMap } from './model/editor-git'
export {
  filterEditorTree,
  findProjectTreeEntry,
  mergeRefreshedProjectEntries,
  projectEntriesOverlap,
  projectEntryContainsPath,
  remapProjectPath,
  removeProjectTreeEntry,
  renameProjectTreeEntry,
  replaceDirectoryChildren,
  toEditorTreeNodes,
} from './model/editor-tree'
export type {
  EditorPreview,
  EditorTab,
  EditorTreeNode,
  EditorWorkbenchContext,
  EditorWorkbenchRequest,
  ProjectEditorProps,
  RemoteEditorFile,
  RemoteOpenRequest,
} from './model/editor.types'
