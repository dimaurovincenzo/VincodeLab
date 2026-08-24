export type WorkspaceCommandKind = 'shell' | 'ssh'

export interface WorkspaceCommand {
  id: string
  categoryId: string
  title: string
  kind: WorkspaceCommandKind
  command: string
  note: string
  sshDestination: string
  remoteRoot: string
}

export interface WorkspaceCommandCategory {
  id: string
  name: string
  commands: WorkspaceCommand[]
}

export interface WorkspaceCommandInput {
  categoryId: string
  title: string
  kind: WorkspaceCommandKind
  command: string
  note: string
  sshDestination: string
  remoteRoot: string
}

export type WorkspaceCommandsApi = {
  list: () => Promise<{ categories: WorkspaceCommandCategory[] }>
  createCategory: (name: string) => Promise<{ id: string; name: string }>
  updateCategory: (categoryId: string, name: string) => Promise<{ id: string; name: string }>
  deleteCategory: (categoryId: string) => Promise<{ deleted: true }>
  create: (input: WorkspaceCommandInput) => Promise<WorkspaceCommand>
  update: (commandId: string, input: WorkspaceCommandInput) => Promise<WorkspaceCommand>
  move: (commandId: string, categoryId: string) => Promise<{ moved: true }>
  delete: (commandId: string) => Promise<{ deleted: true }>
  run: (commandId: string) => Promise<{ executed: true; managedConnectionId?: string }>
}
