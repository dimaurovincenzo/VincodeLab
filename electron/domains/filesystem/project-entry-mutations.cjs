const { createFileRevision } = require('./project-file-revision.cjs')
const {
  PROJECT_ENTRY_DUPLICATE_RESULTS,
  assertProjectEntryMutationsHostPort,
} = require('./project-entry-mutations-host.port.cjs')
const {
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
} = require('./project-access-policy.cjs')

const MAX_DIRECTORY_DUPLICATE_ENTRIES = 5_000
const MAX_DIRECTORY_DUPLICATE_BYTES = 64 * 1024 * 1024
const MAX_DUPLICATE_NAME_ATTEMPTS = 1_000

function destinationIdFor(entryId, entryName) {
  const parentId = entryId.split('/').slice(0, -1).join('/')
  return parentId ? `${parentId}/${entryName}` : entryName
}

function extensionForEntryName(entryName) {
  const lastDot = entryName.lastIndexOf('.')
  return lastDot > 0 ? entryName.slice(lastDot) : ''
}

function duplicateEntryName(entryName, expectedKind, attempt) {
  const extension = expectedKind === 'file' ? extensionForEntryName(entryName) : ''
  const stem = extension ? entryName.slice(0, -extension.length) : entryName
  const suffix = attempt === 1 ? ' copia' : ` copia ${attempt}`
  return validateProjectEntryName(`${stem}${suffix}${extension}`)
}

async function inspectDirectoryForDuplicate(directoryEntries) {
  let entries = 0
  let bytes = 0
  for await (const entry of directoryEntries) {
    if (entry.kind === 'symbolic-link') throw new Error('Le cartelle contenenti link simbolici non possono essere duplicate.')
    if (entry.kind === 'directory') {
      if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) throw new Error('Le cartelle contenenti node_modules non possono essere duplicate.')
    } else if (entry.kind === 'file') bytes += entry.size
    else throw new Error('La cartella contiene un elemento non supportato e non può essere duplicata.')
    entries += 1
    if (entries > MAX_DIRECTORY_DUPLICATE_ENTRIES || bytes > MAX_DIRECTORY_DUPLICATE_BYTES) {
      throw new Error('La cartella supera il limite di 5.000 elementi o 64 MiB e non può essere duplicata.')
    }
  }
  return { bytes, entries }
}

function validateDirectoryCopyEntry(entry) {
  if (entry.kind === 'symbolic-link') throw new Error('Le cartelle contenenti link simbolici non possono essere duplicate.')
  if (!entry.isRoot && entry.kind === 'directory' && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) {
    throw new Error('Le cartelle contenenti node_modules non possono essere duplicate.')
  }
}

function assertMutationHandle(handle) {
  if (!handle || typeof handle !== 'object') throw new TypeError('Bersaglio mutazione progetto non valido.')
  return handle
}

function assertPreparedDuplicate(prepared) {
  if (!prepared || typeof prepared !== 'object' || prepared.status !== PROJECT_ENTRY_DUPLICATE_RESULTS.ready
    || !prepared.handle || typeof prepared.handle !== 'object' || typeof prepared.name !== 'string' || !prepared.name) {
    throw new TypeError('Bersaglio duplicazione progetto non valido.')
  }
  return prepared
}

function createProjectEntryMutations(host) {
  const mutationHost = assertProjectEntryMutationsHostPort(host)

  function createProjectFile(workspacePath, directoryId, fileName) {
    validateProjectDirectoryId(directoryId)
    validateProjectEntryName(fileName)

    let directoryHandle
    try {
      directoryHandle = assertMutationHandle(mutationHost.prepareDirectory(workspacePath, directoryId))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error('Cartella non trovata.')
      throw error
    }

    const fileId = directoryId ? `${directoryId}/${fileName}` : fileName
    assertEditorAccessiblePath(fileId)
    const created = mutationHost.createFileExclusive(directoryHandle, fileName, 0o644)
    if (!created) throw new Error('Un file con questo nome esiste già.')
    return {
      id: fileId,
      name: fileName,
      content: '',
      revision: createFileRevision(Buffer.alloc(0), created),
      size: 0,
    }
  }

  function createProjectDirectory(workspacePath, parentId, directoryName) {
    validateProjectDirectoryId(parentId)
    validateProjectEntryName(directoryName)
    const parentHandle = assertMutationHandle(mutationHost.prepareDirectory(workspacePath, parentId))
    const id = parentId ? `${parentId}/${directoryName}` : directoryName
    assertEditorAccessiblePath(id)
    if (!mutationHost.createDirectoryExclusive(parentHandle, directoryName, 0o755)) {
      throw new Error('Un elemento con questo nome esiste già.')
    }
    return { id, kind: 'directory', name: directoryName }
  }

  function renameProjectEntry(workspacePath, entryId, entryName, expectedKind) {
    validateProjectEntryKind(expectedKind)
    validateProjectEntryId(entryId)
    validateProjectEntryName(entryName)
    const sourceHandle = assertMutationHandle(mutationHost.prepareRename(workspacePath, entryId, expectedKind))
    const destinationId = destinationIdFor(entryId, entryName)
    assertEditorAccessiblePath(destinationId)
    if (destinationId === entryId) {
      return { id: entryId, kind: expectedKind, name: entryName, previousId: entryId, renamed: false }
    }
    if (!mutationHost.rename(sourceHandle, entryName)) throw new Error('Un elemento con questo nome esiste già.')
    return { id: destinationId, kind: expectedKind, name: entryName, previousId: entryId, renamed: true }
  }

  async function duplicateProjectEntry(workspacePath, entryId, expectedKind) {
    validateProjectEntryKind(expectedKind)
    validateProjectEntryId(entryId)
    const result = await mutationHost.prepareDuplicate(workspacePath, entryId, expectedKind, {
      inspectDirectory: inspectDirectoryForDuplicate,
      validateCopyEntry: validateDirectoryCopyEntry,
    })
    if (result?.status === PROJECT_ENTRY_DUPLICATE_RESULTS.symbolicLink) {
      throw new Error('I link simbolici non sono accessibili dall’editor.')
    }
    if (result?.status === PROJECT_ENTRY_DUPLICATE_RESULTS.notRegular) {
      throw new Error('Il file da duplicare non è un file regolare.')
    }
    const prepared = assertPreparedDuplicate(result)

    try {
      for (let attempt = 1; attempt <= MAX_DUPLICATE_NAME_ATTEMPTS; attempt += 1) {
        const name = duplicateEntryName(prepared.name, expectedKind, attempt)
        const duplicateResult = await mutationHost.tryDuplicate(prepared.handle, name)
        if (duplicateResult === PROJECT_ENTRY_DUPLICATE_RESULTS.collision) continue
        if (duplicateResult === PROJECT_ENTRY_DUPLICATE_RESULTS.sourceChanged) {
          throw new Error('Il file è cambiato durante la duplicazione. Riprova.')
        }
        if (duplicateResult === PROJECT_ENTRY_DUPLICATE_RESULTS.copyIncomplete) {
          throw new Error('La copia del file non è stata completata.')
        }
        if (duplicateResult !== PROJECT_ENTRY_DUPLICATE_RESULTS.created) {
          throw new TypeError('Risultato duplicazione progetto non valido.')
        }
        return { id: destinationIdFor(entryId, name), kind: expectedKind, name, sourceId: entryId }
      }
      throw new Error('Impossibile trovare un nome disponibile per la copia.')
    } finally {
      await mutationHost.disposeDuplicate(prepared.handle)
    }
  }

  return Object.freeze({
    createProjectDirectory,
    createProjectFile,
    duplicateProjectEntry,
    renameProjectEntry,
  })
}

module.exports = { createProjectEntryMutations }
