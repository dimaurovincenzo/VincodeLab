// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type {
  ManagedSshConnection,
  RemoteEntry,
  RemoteTrackedFile,
  RemoteTransfer,
  VincodeLabBridge,
  WorkspaceCommand,
} from '@/bridge'
import { RemoteFiles } from '@/features/remote-files'

const connection: ManagedSshConnection = {
  commandId: 'profile-1',
  destination: 'example.test',
  id: 'connection-1',
  remoteRoot: '/srv/project',
  state: 'connected',
  title: 'Server test',
}

const profile: WorkspaceCommand = {
  categoryId: 'category-1',
  command: 'ssh example.test',
  id: 'profile-1',
  kind: 'ssh',
  note: '',
  remoteRoot: '/srv/project',
  sshDestination: 'example.test',
  title: 'Server test',
}

const remoteEntry: RemoteEntry = {
  destructiveAllowed: true,
  displayPath: '/srv/project/report.md',
  id: 'entry-1',
  kind: 'file',
  mode: 0o644,
  modifiedAt: 1,
  name: 'report.md',
  size: 42,
}

const trackedFile: RemoteTrackedFile = {
  baselineHash: 'baseline',
  cacheSize: 42,
  connectionId: connection.id,
  id: 'tracked-1',
  lastError: null,
  localHash: 'local',
  localState: 'synced',
  mode: 0o644,
  modifiedAt: 1,
  name: remoteEntry.name,
  remotePath: remoteEntry.displayPath,
  size: 42,
  updatedAt: 1,
}

type BridgeControls = {
  browse: ReturnType<typeof vi.fn>
  cancelTransfer: ReturnType<typeof vi.fn>
  discard: ReturnType<typeof vi.fn>
  downloadAndTrack: ReturnType<typeof vi.fn>
  emitContextAction: (action: { command: string; contextId: string; contextKind: 'remote-file' | 'remote-directory' | 'remote-local-file' | 'remote-transfer' }) => void
  emitStatus: (status: ManagedSshConnection) => void
  emitTransfer: (transfer: RemoteTransfer) => void
  revealLocal: ReturnType<typeof vi.fn>
}

function installBridge({ browse, downloadAndTrack, trackedFiles = [] }: Pick<BridgeControls, 'browse' | 'downloadAndTrack'> & { trackedFiles?: RemoteTrackedFile[] }): BridgeControls {
  let contextActionListener: ((action: { command: string; contextId: string; contextKind: 'remote-file' | 'remote-directory' | 'remote-local-file' | 'remote-transfer' }) => void) | undefined
  let statusListener: ((status: ManagedSshConnection) => void) | undefined
  let transferListener: ((transfer: RemoteTransfer) => void) | undefined
  const cancelTransfer = vi.fn(async () => ({ cancelled: true }))
  const discard = vi.fn(async () => ({ removed: true as const }))
  const revealLocal = vi.fn(async () => ({ revealed: true as const }))
  const bridge = {
    contextMenu: {
      onAction: vi.fn((listener: (action: { command: string; contextId: string }) => void) => {
        contextActionListener = listener
        return vi.fn()
      }),
      open: vi.fn(async () => ({ opened: true as const })),
    },
    managedSsh: {
      check: vi.fn(async () => true),
      disconnect: vi.fn(async () => ({ disconnected: true as const })),
      list: vi.fn(async () => [connection]),
      onStatus: vi.fn((listener: (status: ManagedSshConnection) => void) => {
        statusListener = listener
        return vi.fn()
      }),
    },
    remoteFiles: {
      browse,
      cancelTransfer,
      chooseAndUpload: vi.fn(async () => []),
      cleanup: vi.fn(async () => ({ removed: 0 })),
      compare: vi.fn(),
      createDirectory: vi.fn(async () => ({ created: true as const })),
      discard,
      downloadAndTrack,
      downloadAs: vi.fn(async () => ({ saved: false })),
      listTracked: vi.fn(async () => trackedFiles),
      onTransfer: vi.fn((listener: (transfer: RemoteTransfer) => void) => {
        transferListener = listener
        return vi.fn()
      }),
      preview: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(async () => ({ removed: true as const })),
      rename: vi.fn(async () => ({ renamed: true as const })),
      revealLocal,
      saveLocal: vi.fn(),
      upload: vi.fn(),
    },
    workspaceCommands: {
      list: vi.fn(async () => ({ categories: [{ commands: [profile], id: 'category-1', name: 'Server' }] })),
    },
  }
  Object.defineProperty(window, 'vincodeLab', { configurable: true, value: bridge as unknown as VincodeLabBridge })
  return {
    browse,
    cancelTransfer,
    discard,
    downloadAndTrack,
    emitContextAction: (action) => {
      if (!contextActionListener) throw new Error('Listener menu contestuale non installato.')
      act(() => contextActionListener?.(action))
    },
    emitStatus: (status) => {
      if (!statusListener) throw new Error('Listener stato SSH non installato.')
      act(() => statusListener?.(status))
    },
    emitTransfer: (transfer) => {
      if (!transferListener) throw new Error('Listener trasferimento non installato.')
      act(() => transferListener?.(transfer))
    },
    revealLocal,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

it('termina il caricamento del browse quando la connessione si interrompe e mostra Riconnetti', async () => {
  const browse = vi.fn(() => new Promise<{ path: string; entries: RemoteEntry[] }>(() => undefined))
  const controls = installBridge({ browse, downloadAndTrack: vi.fn() })
  render(<RemoteFiles active preferredConnectionId={connection.id} workspace="/tmp/remote-loading" onConnectProfile={vi.fn()} onCreateSshProfile={vi.fn()} onOpenRemoteFile={vi.fn()} />)

  expect(await screen.findByText('Caricamento file remoti…')).toBeVisible()
  controls.emitStatus({ ...connection, error: 'Connection lost', state: 'error' })

  expect(await screen.findByText('Connessione SSH non attiva')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Riconnetti' })).toBeVisible()
  expect(screen.queryByText('Caricamento file remoti…')).not.toBeInTheDocument()
})

it('mantiene un solo errore di trasferimento e la recovery con ID quando evento e rejection descrivono lo stesso failure', async () => {
  const user = userEvent.setup()
  const onOpenRemoteFile = vi.fn()
  let controls!: BridgeControls
  let attempt = 0
  const downloadAndTrack = vi.fn(async () => {
    attempt += 1
    if (attempt === 1) {
      controls.emitTransfer({ bytes: 0, direction: 'download', error: 'Network interrupted', id: 'transfer-1', name: remoteEntry.name, state: 'running', total: 42 })
      controls.emitTransfer({ bytes: 10, direction: 'download', error: 'Network interrupted', id: 'transfer-1', name: remoteEntry.name, state: 'error', total: 42 })
      throw new Error('Network interrupted')
    }
    return trackedFile
  })
  controls = installBridge({
    browse: vi.fn(async () => ({ entries: [remoteEntry], path: '/srv/project' })),
    downloadAndTrack,
  })
  render(<RemoteFiles active preferredConnectionId={connection.id} workspace="/tmp/remote-transfer" onConnectProfile={vi.fn()} onCreateSshProfile={vi.fn()} onOpenRemoteFile={onOpenRemoteFile} />)

  await user.click(await screen.findByRole('button', { name: /report\.md/u }))
  expect(await screen.findByRole('heading', { name: 'Download interrotto' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Riprova trasferimento' })).toBeVisible()
  const failedTransferRow = screen.getByText('Interrotto').closest('article')
  expect(failedTransferRow).toHaveAttribute('data-remote-context-kind', 'remote-transfer')
  expect(failedTransferRow).toHaveAttribute('data-context-retryable', 'true')
  expect(failedTransferRow).not.toHaveAttribute('data-context-cancellable')
  expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1)

  controls.emitContextAction({ command: 'remoteTransfer.retry', contextId: 'transfer-1', contextKind: 'remote-transfer' })
  await waitFor(() => expect(downloadAndTrack).toHaveBeenCalledTimes(2))
  expect(onOpenRemoteFile).toHaveBeenCalledWith(trackedFile.id)
  expect(screen.queryByRole('heading', { name: 'Download interrotto' })).not.toBeInTheDocument()
})

it('collega il menu contestuale delle copie locali alle azioni esistenti e conserva la conferma distruttiva', async () => {
  const user = userEvent.setup()
  const onOpenRemoteFile = vi.fn()
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const controls = installBridge({
    browse: vi.fn(async () => ({ entries: [], path: '/srv/project' })),
    downloadAndTrack: vi.fn(),
    trackedFiles: [trackedFile],
  })
  render(<RemoteFiles active preferredConnectionId={connection.id} workspace="/tmp/remote-local-context" onConnectProfile={vi.fn()} onCreateSshProfile={vi.fn()} onOpenRemoteFile={onOpenRemoteFile} />)

  await user.click(await screen.findByRole('tab', { name: /Copie locali/u }))
  const row = (await screen.findByText(trackedFile.remotePath)).closest('article')
  expect(row).toHaveAttribute('data-remote-context-id', trackedFile.id)
  expect(row).toHaveAttribute('data-remote-context-kind', 'remote-local-file')

  controls.emitContextAction({ command: 'remoteLocal.open', contextId: trackedFile.id, contextKind: 'remote-local-file' })
  expect(onOpenRemoteFile).toHaveBeenCalledWith(trackedFile.id)
  controls.emitContextAction({ command: 'remoteLocal.reveal', contextId: trackedFile.id, contextKind: 'remote-local-file' })
  await waitFor(() => expect(controls.revealLocal).toHaveBeenCalledWith(trackedFile.id))
  controls.emitContextAction({ command: 'remoteLocal.copyPath', contextId: trackedFile.id, contextKind: 'remote-local-file' })
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(trackedFile.remotePath))

  controls.emitContextAction({ command: 'remoteLocal.discard', contextId: trackedFile.id, contextKind: 'remote-local-file' })
  await user.click(await screen.findByRole('button', { name: /^Scarta copia$/u }))
  await waitFor(() => expect(controls.discard).toHaveBeenCalledWith(trackedFile.id, { force: false }))
})

it('annulla dal menu contestuale soltanto un trasferimento ancora attivo', async () => {
  const controls = installBridge({ browse: vi.fn(async () => ({ entries: [], path: '/srv/project' })), downloadAndTrack: vi.fn() })
  render(<RemoteFiles active preferredConnectionId={connection.id} workspace="/tmp/remote-transfer-context" onConnectProfile={vi.fn()} onCreateSshProfile={vi.fn()} onOpenRemoteFile={vi.fn()} />)

  controls.emitTransfer({ bytes: 10, direction: 'upload', id: 'transfer-running', name: 'asset.zip', state: 'running', total: 100 })
  const row = (await screen.findByText('asset.zip')).closest('article')
  expect(row).toHaveAttribute('data-remote-context-id', 'transfer-running')
  expect(row).toHaveAttribute('data-remote-context-kind', 'remote-transfer')
  expect(row).toHaveAttribute('data-context-cancellable', 'true')
  expect(row).not.toHaveAttribute('data-context-retryable')

  controls.emitContextAction({ command: 'remoteTransfer.cancel', contextId: 'transfer-running', contextKind: 'remote-transfer' })
  await waitFor(() => expect(controls.cancelTransfer).toHaveBeenCalledTimes(1))
  controls.emitTransfer({ bytes: 100, direction: 'upload', id: 'transfer-running', name: 'asset.zip', state: 'completed', total: 100 })
  await waitFor(() => expect(row).not.toHaveAttribute('data-context-cancellable'))
  expect(row).not.toHaveAttribute('data-context-retryable')
  controls.emitContextAction({ command: 'remoteTransfer.cancel', contextId: 'transfer-running', contextKind: 'remote-transfer' })
  expect(controls.cancelTransfer).toHaveBeenCalledTimes(1)
})
