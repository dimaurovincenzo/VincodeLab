export type RendererDraftScope =
  | 'project-editor'
  | 'project-instructions'
  | 'project-skill'
  | 'settings-package-source'
  | 'settings-new-skill'
  | 'settings-system-skill'
  | 'database-sql'
  | 'database-connection'
  | 'database-grid'

export interface RendererDraftIdentity {
  scope: RendererDraftScope
  workspace: string
  resource: string
}

export interface RendererDraftSnapshot extends RendererDraftIdentity {
  content: string
  baseline: string
}

export type VolatileDraftsApi = {
  list: () => Promise<RendererDraftSnapshot[]>
  write: (draft: RendererDraftSnapshot) => Promise<{ stored: boolean }>
  discard: (identity: RendererDraftIdentity) => Promise<{ discarded: boolean }>
}
