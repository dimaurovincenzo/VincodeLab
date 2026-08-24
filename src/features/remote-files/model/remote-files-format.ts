export function formatRemoteFileSize(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function remoteLocalStateLabel(state: RemoteTrackedFile['localState']) {
  return state === 'synced' ? 'Sincronizzato' : state === 'modified' ? 'Modificato' : state === 'conflict' ? 'Conflitto' : 'Offline'
}
