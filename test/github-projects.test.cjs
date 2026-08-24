const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_PROJECT_ITEMS, PROJECT_FIELD_LIST_JQ, applyIssueParents, assertProjectDetails, assertProjectNumber, assertNodeId, buildItemEditArgs, buildProjectItemListJq, getProjectBoard, limitProjectItems, parseIssueParents, parseLinkedProjects, parseLinkedProjectsPage, parseProjectBoardList, parseProjectBoardItems, parseProjectItemFieldValues } = require('../electron/domains/github/github-projects.cjs')

test('keeps only the Projects linked to the repository returned by GraphQL', () => {
  const projects = parseLinkedProjects(JSON.stringify({
    data: {
      repository: {
        projectsV2: {
          nodes: [
            { id: 'PVT_kwDOA', number: 7, title: 'Workspace board', shortDescription: 'Attività', closed: false, url: 'https://github.com/orgs/acme/projects/7' },
          ],
        },
      },
    },
  }))

  assert.deepEqual(projects, [{
    id: 'PVT_kwDOA', number: 7, title: 'Workspace board', shortDescription: 'Attività', closed: false, url: 'https://github.com/orgs/acme/projects/7',
  }])
})

test('returns an empty list when the repository has no linked Projects', () => {
  assert.deepEqual(parseLinkedProjects(JSON.stringify({ data: { repository: { projectsV2: { nodes: [] } } } })), [])
})

test('espone hasMore quando GitHub segnala altri Project collegati', () => {
  const page = parseLinkedProjectsPage(JSON.stringify({
    data: { repository: { projectsV2: {
      totalCount: 101,
      pageInfo: { hasNextPage: true },
      nodes: [{ id: 'PVT_kwDOA', number: 7, title: 'Workspace board', shortDescription: '', closed: false, url: 'https://github.test/7' }],
    } } },
  }))

  assert.equal(page.projects.length, 1)
  assert.equal(page.hasMore, true)
})

test('limita la board e richiede una riga sentinella invece di caricare tutto', async () => {
  let fieldListArgs = []
  let itemListArgs = []
  const run = async (_command, args) => {
    if (args[0] === 'api' && args[1] === 'graphql' && args.some((value) => String(value).includes('projectsV2(first: 100)'))) {
      return JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_board', number: 5, title: 'Board', shortDescription: '', closed: false, url: 'https://github.com/users/acme/projects/5' }] } } } })
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      return JSON.stringify({ data: { node: { id: 'PVT_board', items: { totalCount: 638 } } } })
    }
    if (args[0] === 'project' && args[1] === 'field-list') {
      fieldListArgs = args
      return JSON.stringify({ fields: [] })
    }
    if (args[0] === 'project' && args[1] === 'item-list') {
      itemListArgs = args
      return JSON.stringify({ items: [] })
    }
    throw new Error(`Comando inatteso: ${args.join(' ')}`)
  }

  const board = await getProjectBoard(run, '/workspace', { owner: 'acme', nameWithOwner: 'acme/repo' }, 5)

  assert.equal(fieldListArgs[fieldListArgs.indexOf('--jq') + 1], PROJECT_FIELD_LIST_JQ)
  assert.equal(itemListArgs[itemListArgs.indexOf('--limit') + 1], String(MAX_PROJECT_ITEMS + 1))
  assert.match(itemListArgs[itemListArgs.indexOf('--jq') + 1], /^\.items \|= map/)
  assert.doesNotMatch(itemListArgs[itemListArgs.indexOf('--jq') + 1], /body/)
  assert.equal(board.itemsHasMore, true)
  assert.equal(board.itemsTruncated, true)
})

test('proietta prima della lettura solo campi Project bounded e propaga i troncamenti additivi', async () => {
  const fields = [{ id: 'PVTF_status', name: 'Status' }]
  const itemJq = buildProjectItemListJq(fields)
  assert.match(PROJECT_FIELD_LIST_JQ, /\.fields\[:13\]/)
  assert.match(PROJECT_FIELD_LIST_JQ, /\.options \/\/ \[\]\)\[:20\]/)
  assert.doesNotMatch(itemJq, /content\.body|\$item\.body/)
  assert.match(itemJq, /\.assignees \/\/ \[\]\)\[:10\]/)

  const run = async (_command, args) => {
    const query = args.find((value) => typeof value === 'string' && value.startsWith('query=')) ?? ''
    if (query.includes('projectsV2(first: 100)')) {
      return JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_board', number: 5, title: 'Board', shortDescription: '', closed: false, url: 'https://github.test/5' }] } } } })
    }
    if (query.includes('items { totalCount }')) return JSON.stringify({ data: { node: { id: 'PVT_board', items: { totalCount: 1 } } } })
    if (args[0] === 'project' && args[1] === 'field-list') {
      assert.equal(args[args.indexOf('--jq') + 1], PROJECT_FIELD_LIST_JQ)
      return JSON.stringify({ fields: [{ ...fields[0], dataType: 'SINGLE_SELECT', optionsHasMore: true, options: [] }] })
    }
    if (args[0] === 'project' && args[1] === 'item-list') {
      assert.equal(args[args.indexOf('--jq') + 1], itemJq)
      return JSON.stringify({ items: [{ id: 'PVTI_1', type: 'DraftIssue', status: 'Todo', valuesTruncated: true, content: { title: 'Attività' } }] })
    }
    throw new Error(`Comando inatteso: ${args.join(' ')}`)
  }

  const board = await getProjectBoard(run, '/workspace', { owner: 'acme', nameWithOwner: 'acme/repo' }, 5)

  assert.equal(board.hasMore, false)
  assert.equal(board.fieldOptionsTruncated, true)
  assert.equal(board.itemValuesTruncated, true)
  assert.equal(board.fieldsTruncated, true)
  assert.equal(board.itemsTruncated, true)
  assert.equal(board.truncated, true)
})

test('applica un budget byte deterministico a listing Project sintetici grandi', () => {
  const items = Array.from({ length: 1_000 }, (_, index) => ({
    id: `PVTI_${index}`,
    title: `Attività ${index}`,
    fieldValues: { description: 'x'.repeat(8_000) },
  }))

  const page = limitProjectItems(items)

  assert.ok(page.items.length < MAX_PROJECT_ITEMS)
  assert.ok(page.bytes <= 1_250_000)
  assert.equal(page.hasMore, true)
})

test('riapplica il budget al DTO finale dopo avere aggiunto le relazioni padre', async () => {
  const itemCount = 100
  const fields = [{ id: 'PVTF_note', name: 'Note', dataType: 'TEXT' }]
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `PVTI_${index + 1}`,
    type: 'Issue',
    note: 'x'.repeat(8_000),
    content: { title: `Issue ${index + 1}`, number: index + 1, repository: 'acme/repo' },
  }))
  const run = async (_command, args) => {
    const query = args.find((value) => typeof value === 'string' && value.startsWith('query=')) ?? ''
    if (query.includes('projectsV2(first: 100)')) {
      return JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_board', number: 5, title: 'Board', shortDescription: '', closed: false, url: 'https://github.test/5' }] } } } })
    }
    if (query.includes('items { totalCount }')) return JSON.stringify({ data: { node: { id: 'PVT_board', items: { totalCount: itemCount } } } })
    if (query.includes('issue_')) {
      const repository = {}
      for (const match of query.matchAll(/issue_(\d+):/g)) {
        const number = Number(match[1])
        repository[`issue_${number}`] = { number, parent: { number: 1_000 + number, title: 'p'.repeat(6_000), url: `https://github.test/issues/${1_000 + number}`, repository: { nameWithOwner: 'acme/repo' } } }
      }
      return JSON.stringify({ data: { repository } })
    }
    if (args[0] === 'project' && args[1] === 'field-list') return JSON.stringify({ fields })
    if (args[0] === 'project' && args[1] === 'item-list') return JSON.stringify({ items })
    throw new Error(`Comando inatteso: ${args.join(' ')}`)
  }

  const board = await getProjectBoard(run, '/workspace', { owner: 'acme', nameWithOwner: 'acme/repo' }, 5)

  assert.ok(board.items.length < itemCount)
  assert.ok(board.items.every((item) => item.parent?.title.length === 6_000))
  assert.ok(board.itemsResultBytes <= 1_250_000)
  assert.equal(Buffer.byteLength(JSON.stringify(board.items), 'utf8'), board.itemsResultBytes)
  assert.equal(board.itemsHasMore, true)
  assert.equal(board.itemsTruncated, true)
})

test('limita le query concorrenti usate per arricchire le relazioni padre', async () => {
  const itemCount = 300
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `PVTI_${index}`,
    type: 'Issue',
    content: { title: `Issue ${index + 1}`, number: index + 1, repository: 'acme/repo' },
  }))
  let activeParentQueries = 0
  let maxConcurrentParentQueries = 0

  const run = async (_command, args) => {
    const query = args.find((value) => typeof value === 'string' && value.startsWith('query=')) ?? ''
    if (query.includes('projectsV2(first: 100)')) {
      return JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_board', number: 5, title: 'Board', shortDescription: '', closed: false, url: 'https://github.test/5' }] } } } })
    }
    if (query.includes('items { totalCount }')) return JSON.stringify({ data: { node: { id: 'PVT_board', items: { totalCount: itemCount } } } })
    if (query.includes('issue_')) {
      activeParentQueries += 1
      maxConcurrentParentQueries = Math.max(maxConcurrentParentQueries, activeParentQueries)
      await new Promise((resolve) => setImmediate(resolve))
      activeParentQueries -= 1
      return JSON.stringify({ data: { repository: {} } })
    }
    if (args[0] === 'project' && args[1] === 'field-list') return JSON.stringify({ fields: [] })
    if (args[0] === 'project' && args[1] === 'item-list') return JSON.stringify({ items })
    throw new Error(`Comando inatteso: ${args.join(' ')}`)
  }

  await getProjectBoard(run, '/workspace', { owner: 'acme', nameWithOwner: 'acme/repo' }, 5)

  assert.equal(maxConcurrentParentQueries, 4)
})

test('accepts only positive GitHub Project numbers', () => {
  assert.equal(assertProjectNumber(3), 3)
  assert.throws(() => assertProjectNumber('3'), /Project non valido/)
  assert.throws(() => assertProjectNumber(0), /Project non valido/)
})

test('validates Project title and description before editing metadata', () => {
  assert.deepEqual(assertProjectDetails(' Board roadmap ', 'Prossimi rilasci'), { title: 'Board roadmap', description: 'Prossimi rilasci' })
  assert.throws(() => assertProjectDetails('', 'descrizione'), /Dati Project non validi/)
  assert.throws(() => assertProjectDetails('Titolo', 'x'.repeat(1_025)), /Dati Project non validi/)
})

test('builds a constrained Project field update command', () => {
  assert.deepEqual(buildItemEditArgs('PVT_4', 'PVTITEM_a1', 'PVTSSF_a2', { type: 'singleSelect', optionId: 'opt_done' }, 'octo'), [
    'project', 'item-edit', '--project-id', 'PVT_4', '--id', 'PVTITEM_a1', '--field-id', 'PVTSSF_a2', '--single-select-option-id', 'opt_done',
  ])
  assert.throws(() => buildItemEditArgs('PVT_4', 'invalid id with spaces', 'PVTSSF_a2', { type: 'text' }, 'ciao'), /Dati Project non validi/)
})

test('rejects project item identifiers that can alter command arguments', () => {
  assert.equal(assertNodeId('PVTI_abc-123'), 'PVTI_abc-123')
  assert.throws(() => assertNodeId('--owner'), /Dati Project non validi/)
})

test('reads text, numeric and date fields from the selected Project item', () => {
  const values = parseProjectItemFieldValues(JSON.stringify({
    data: { node: { id: 'PVTI_abc', fieldValues: { nodes: [
      { text: 'MVP', field: { id: 'PVTF_text' } },
      { number: 8, field: { id: 'PVTF_points' } },
      { date: '2026-08-19', field: { id: 'PVTF_due' } },
    ] } } },
  }), 'PVTI_abc')
  assert.deepEqual(values, { PVTF_text: 'MVP', PVTF_points: '8', PVTF_due: '2026-08-19' })
})

test('rejects field values returned for a different Project item', () => {
  assert.throws(() => parseProjectItemFieldValues(JSON.stringify({ data: { node: { id: 'PVTI_other', fieldValues: { nodes: [] } } } }), 'PVTI_expected'), /Attività Project non trovata/)
})

test('reads Project rows with custom fields and assignees in one GraphQL page', () => {
  const page = parseProjectBoardItems(JSON.stringify({
    data: { node: { items: { nodes: [{
      id: 'PVTI_abc',
      type: 'ISSUE',
      content: { title: 'Correggere il flusso', url: 'https://github.com/acme/repo/issues/12', number: 12, assignees: { nodes: [{ login: 'mario' }, { login: 'anna' }] } },
      fieldValues: { nodes: [
        { name: 'In corso', field: { id: 'PVTF_status' } },
        { name: 'P1 - Alta', field: { id: 'PVTF_priority' } },
        { text: 'Middleware', field: { id: 'PVTF_area' } },
      ] },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } },
  }), 'PVTF_status')

  assert.deepEqual(page, {
    items: [{
      id: 'PVTI_abc',
      type: 'ISSUE',
      title: 'Correggere il flusso',
      content: { title: 'Correggere il flusso', url: 'https://github.com/acme/repo/issues/12', number: 12 },
      assignees: ['mario', 'anna'],
      status: 'In corso',
      fieldValues: { PVTF_status: 'In corso', PVTF_priority: 'P1 - Alta', PVTF_area: 'Middleware' },
    }],
    hasNextPage: false,
    endCursor: null,
  })
})

test('maps gh project item-list field labels to Project field ids for grouping', () => {
  const items = parseProjectBoardList(JSON.stringify({ items: [{
    id: 'PVTI_abc', type: 'Issue', assignees: ['mario', 'anna'], status: 'Completato', prodotto: 'Middleware', priorità: 'P1 - Alta',
    content: { title: 'Correggere il flusso', url: 'https://github.com/acme/repo/issues/12', number: 12 },
  }] }), [
    { id: 'PVTSSF_status', name: 'Status', type: 'ProjectV2SingleSelectField' },
    { id: 'PVTSSF_product', name: 'Prodotto', type: 'ProjectV2SingleSelectField' },
    { id: 'PVTSSF_priority', name: 'Priorità', type: 'ProjectV2SingleSelectField' },
  ])

  assert.deepEqual(items, [{
    id: 'PVTI_abc', type: 'Issue', assignees: ['mario', 'anna'], status: 'Completato',
    title: 'Correggere il flusso', content: { title: 'Correggere il flusso', url: 'https://github.com/acme/repo/issues/12', number: 12 },
    fieldValues: { PVTSSF_status: 'Completato', PVTSSF_product: 'Middleware', PVTSSF_priority: 'P1 - Alta' },
  }])
})

test('collega la relazione padre alle sub-issue del Project senza alterare le altre attività', () => {
  const parents = parseIssueParents(JSON.stringify({
    data: { repository: {
      issue_18: { number: 18, parent: { number: 7, title: 'Epic di riferimento', url: 'https://github.com/acme/repo/issues/7', repository: { nameWithOwner: 'acme/repo' } } },
      issue_19: { number: 19, parent: null },
    } },
  }))
  const items = applyIssueParents([
    { id: 'PVTI_child', content: { number: 18, title: 'Task figlio', url: 'https://github.com/acme/repo/issues/18', repository: 'acme/repo' } },
    { id: 'PVTI_parent', content: { number: 7, title: 'Epic di riferimento', url: 'https://github.com/acme/repo/issues/7', repository: 'acme/repo' } },
    { id: 'PVTI_other', content: { number: 19, title: 'Attività indipendente', url: 'https://github.com/acme/repo/issues/19', repository: 'acme/repo' } },
  ], parents)

  assert.deepEqual(items[0].parent, { number: 7, title: 'Epic di riferimento', url: 'https://github.com/acme/repo/issues/7', repository: 'acme/repo' })
  assert.equal(items[1].parent, undefined)
  assert.equal(items[2].parent, undefined)
})
