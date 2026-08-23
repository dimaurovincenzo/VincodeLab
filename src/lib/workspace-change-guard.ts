export type WorkspaceChangeGuard = {
  hasUnsavedChanges(): boolean
  saveAll(): Promise<void>
  discardAll(): void | Promise<void>
}
