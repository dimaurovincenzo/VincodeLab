import { describe, expect, it } from 'vitest'
import { formatRemoteFileSize, remoteLocalStateLabel } from '@/features/remote-files/model/remote-files-format'

describe('modello presentazionale Remote Files', () => {
  it('formatta dimensioni bounded con la stessa grammatica della vista', () => {
    expect(formatRemoteFileSize(null)).toBe('—')
    expect(formatRemoteFileSize(512)).toBe('512 B')
    expect(formatRemoteFileSize(1_536)).toBe('1.5 KB')
    expect(formatRemoteFileSize(1_572_864)).toBe('1.5 MB')
  })

  it('traduce tutti gli stati locali senza esporre valori tecnici', () => {
    expect(remoteLocalStateLabel('synced')).toBe('Sincronizzato')
    expect(remoteLocalStateLabel('modified')).toBe('Modificato')
    expect(remoteLocalStateLabel('conflict')).toBe('Conflitto')
    expect(remoteLocalStateLabel('offline')).toBe('Offline')
  })
})
