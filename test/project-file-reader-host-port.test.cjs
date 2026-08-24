const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  PROJECT_FILE_READER_HOST_METHODS,
  createProjectFileReaderHostPort,
} = require('../electron/domains/filesystem/project-file-reader-host.port.cjs')
const { createProjectFileReader } = require('../electron/domains/filesystem/project-file-reader.cjs')
const { createFileRevision } = require('../electron/domains/filesystem/project-file-revision.cjs')
const {
  createProjectFileReaderFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-file-reader-filesystem.adapter.cjs')
const projectFileContent = require('../electron/domains/filesystem/project-file-content.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')

test('la porta reader espone solo prepare e bounded read, preserva il receiver ed è immutabile', async () => {
  const implementation = {
    prefix: 'src',
    prepareRead(_workspacePath, fileId) {
      return { extension: 'txt', handle: {}, name: `${this.prefix}-${fileId}` }
    },
    async readBounded(_handle, maxSize) {
      return { buffer: Buffer.from(this.prefix), mtimeMs: 1, size: maxSize }
    },
  }
  const port = createProjectFileReaderHostPort(implementation)

  assert.deepEqual(PROJECT_FILE_READER_HOST_METHODS, ['prepareRead', 'readBounded'])
  assert.deepEqual(Object.keys(port), PROJECT_FILE_READER_HOST_METHODS)
  assert.equal(Object.isFrozen(port), true)
  assert.equal(port.prepareRead('/workspace', 'file.txt').name, 'src-file.txt')
  assert.equal((await port.readBounded({}, 7, 'troppo grande')).buffer.toString(), 'src')
  assert.throws(() => createProjectFileReaderHostPort({}), /incompleta: prepareRead/)
  assert.throws(() => createProjectFileReaderHostPort(null), /non valida/)
  assert.throws(() => createProjectFileReader({}), /non valida/)
})

test('la revisione pura conserva esattamente formato, prefisso e arrotondamento storico', () => {
  assert.equal(
    createFileRevision(Buffer.from('ciao\n'), { size: 5, mtimeMs: 1234.56789 }),
    'v1-nc08ttjLSMAtzh22ZabZsrgULk2QcdUddJL1Rv8jOew',
  )
  assert.equal(
    createFileRevision(Buffer.alloc(0), { size: 0, mtimeMs: 0 }),
    'v1-3NSRhVJc3OCnAR8eXdAcpzQ6WqUeyBAw442LDTjmNMo',
  )
  assert.equal(projectFileContent.createFileRevision, createFileRevision)
})

test('il dominio conserva ordine, limiti, MIME, testo binario, revisione e DTO', async () => {
  const events = []
  const snapshots = new Map([
    ['file.txt', { buffer: Buffer.from('ciao\n'), mtimeMs: 1234.56789, size: 5 }],
    ['binary.bin', { buffer: Buffer.from([0, 1, 2]), mtimeMs: 2, size: 3 }],
    ['diagram.png', { buffer: Buffer.from([0x89, 0x50]), mtimeMs: 3, size: 2 }],
    ['manual.pdf', { buffer: Buffer.from('%PDF'), mtimeMs: 4, size: 4 }],
  ])
  const reader = createProjectFileReader(createProjectFileReaderHostPort({
    prepareRead(workspacePath, fileId) {
      events.push(['prepare', workspacePath, fileId])
      if (fileId === 'missing.txt') throw new Error('File non trovato.')
      const name = fileId.split('/').at(-1)
      const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : ''
      return { extension, handle: { name }, name }
    },
    async readBounded(handle, maxSize, tooLargeMessage) {
      events.push(['read', handle.name, maxSize, tooLargeMessage])
      return snapshots.get(handle.name) ?? { buffer: Buffer.alloc(0), mtimeMs: 0, size: 0 }
    },
  }))

  assert.equal(Object.isFrozen(reader), true)
  assert.deepEqual(Object.keys(reader), ['readProjectFile', 'readProjectPreview'])
  assert.equal(reader.readProjectFile.length, 2)
  assert.equal(reader.readProjectPreview.length, 2)

  assert.deepEqual(await reader.readProjectFile('/workspace', 'src/file.txt'), {
    id: 'src/file.txt',
    name: 'file.txt',
    content: 'ciao\n',
    revision: 'v1-nc08ttjLSMAtzh22ZabZsrgULk2QcdUddJL1Rv8jOew',
    size: 5,
  })
  assert.deepEqual(events, [
    ['prepare', '/workspace', 'src/file.txt'],
    ['read', 'file.txt', 1_000_000, 'Il file supera 1 MiB e non può essere aperto nell’editor.'],
  ])

  events.length = 0
  assert.deepEqual(await reader.readProjectPreview('/workspace', 'diagram.png'), {
    id: 'diagram.png',
    name: 'diagram.png',
    kind: 'image',
    content: 'data:image/png;base64,iVA=',
    size: 2,
  })
  assert.deepEqual(events, [
    ['prepare', '/workspace', 'diagram.png'],
    ['read', 'diagram.png', 8 * 1024 * 1024, 'Il file supera 8 MiB e non può essere visualizzato in anteprima.'],
  ])
  assert.equal((await reader.readProjectPreview('/workspace', 'manual.pdf')).kind, 'pdf')

  events.length = 0
  await assert.rejects(() => reader.readProjectPreview('/workspace', 'missing.txt'), /File non trovato/)
  assert.deepEqual(events, [['prepare', '/workspace', 'missing.txt']])

  events.length = 0
  await assert.rejects(() => reader.readProjectPreview('/workspace', 'existing.txt'), /formato non supporta/)
  assert.deepEqual(events, [['prepare', '/workspace', 'existing.txt']])

  events.length = 0
  await assert.rejects(() => reader.readProjectFile('/workspace', 'binary.bin'), /sembra binario/)
  assert.deepEqual(events.map((event) => event[0]), ['prepare', 'read'])

  events.length = 0
  await assert.rejects(() => reader.readProjectFile('/workspace', '../outside.txt'), /Percorso file non valido/)
  assert.deepEqual(events, [])
})

test('l adapter usa handle opachi confinati alla propria istanza e mantiene O_NOFOLLOW', async () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-reader-'))
  const workspace = path.join(container, 'workspace')
  const alias = path.join(container, 'workspace-alias')
  const external = path.join(container, 'external.txt')
  try {
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(workspace, 'note.TXT'), 'contenuto\n')
    fs.writeFileSync(path.join(workspace, 'large.txt'), '1234')
    fs.writeFileSync(path.join(workspace, 'replace.txt'), 'interno\n')
    fs.writeFileSync(external, 'esterno\n')
    fs.symlinkSync(workspace, alias)
    fs.symlinkSync(external, path.join(workspace, 'outside.txt'))

    const host = createProjectFileReaderFilesystemAdapter()
    const prepared = host.prepareRead(alias, 'note.TXT')
    assert.equal(prepared.name, 'note.TXT')
    assert.equal(prepared.extension, 'txt')
    assert.equal(Object.isFrozen(prepared), true)
    assert.equal(Object.isFrozen(prepared.handle), true)
    assert.deepEqual(Object.keys(prepared.handle), [])
    assert.equal('absolutePath' in prepared.handle, false)

    const read = await host.readBounded(prepared.handle, 1_000_000, 'troppo grande')
    assert.equal(read.buffer.toString(), 'contenuto\n')
    assert.equal(read.size, Buffer.byteLength('contenuto\n'))
    assert.equal(typeof read.mtimeMs, 'number')

    await assert.rejects(() => host.readBounded({}, 1_000_000, 'troppo grande'), /Handle lettura file progetto non valido/)
    const otherHost = createProjectFileReaderFilesystemAdapter()
    await assert.rejects(() => otherHost.readBounded(prepared.handle, 1_000_000, 'troppo grande'), /Handle lettura file progetto non valido/)

    const large = host.prepareRead(workspace, 'large.txt')
    await assert.rejects(() => host.readBounded(large.handle, 3, 'limite test'), /limite test/)
    assert.throws(() => host.prepareRead(workspace, 'outside.txt'), /link simbolici/)

    const replaced = host.prepareRead(workspace, 'replace.txt')
    fs.unlinkSync(path.join(workspace, 'replace.txt'))
    fs.symlinkSync(external, path.join(workspace, 'replace.txt'))
    await assert.rejects(
      () => host.readBounded(replaced.handle, 1_000_000, 'troppo grande'),
      (error) => error?.code === 'ELOOP',
    )
  } finally {
    fs.rmSync(container, { recursive: true, force: true })
  }
})

test('l adapter esegue stat prima e dopo, usa flag no-follow e chiude anche sul cambiamento concorrente', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-reader-close-'))
  const filePath = path.join(workspace, 'file.txt')
  const originalOpen = fs.promises.open
  let closeCalls = 0
  let capturedFlags
  let statCalls = 0
  try {
    fs.writeFileSync(filePath, 'abc')
    const host = createProjectFileReaderFilesystemAdapter()
    const prepared = host.prepareRead(workspace, 'file.txt')

    fs.promises.open = async (_target, flags) => {
      capturedFlags = flags
      let reads = 0
      return {
        async close() { closeCalls += 1 },
        async read(buffer) {
          if (reads > 0) return { bytesRead: 0 }
          reads += 1
          buffer.set(Buffer.from('abc'))
          return { bytesRead: 3 }
        },
        async stat() {
          statCalls += 1
          return statCalls === 1
            ? { ctimeMs: 1, isFile: () => true, mtimeMs: 1, size: 3 }
            : { ctimeMs: 2, isFile: () => true, mtimeMs: 1, size: 3 }
        },
      }
    }

    await assert.rejects(() => host.readBounded(prepared.handle, 10, 'troppo grande'), /cambiato durante la lettura/)
    assert.equal(capturedFlags, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    assert.equal(statCalls, 2)
    assert.equal(closeCalls, 1)
  } finally {
    fs.promises.open = originalOpen
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('file mancante precede formato non supportato anche con l adapter reale', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-reader-order-'))
  try {
    const reader = createProjectFileReader(createProjectFileReaderFilesystemAdapter())
    await assert.rejects(
      () => reader.readProjectPreview(workspace, 'missing.txt'),
      (error) => error?.code === 'ENOENT' && !/formato non supporta/u.test(error.message),
    )
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('facade e main compongono il reader mantenendo le firme consegnate all IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal(projectFiles.createProjectFileReader, createProjectFileReader)
  assert.match(main, /createProjectFileReaderFilesystemAdapter/)
  assert.match(main, /\} = createProjectFileReader\(createProjectFileReaderFilesystemAdapter\(\)\)/)
  assert.match(main, /registerFilesystemIpc\(\{[\s\S]*?readProjectFile,[\s\S]*?readProjectPreview,/)
})
