export interface RuntimeCapability {
  id: string
  kind: 'included' | 'optional'
  label: string
  state: 'ready' | 'missing' | 'broken'
  code?: string
  detail: string
}

export interface RuntimeCapabilitiesSnapshot {
  checkedAt: string
  items: RuntimeCapability[]
}

export type RuntimeCapabilitiesApi = {
  capabilities: () => Promise<RuntimeCapabilitiesSnapshot>
}
