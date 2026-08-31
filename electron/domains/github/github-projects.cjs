const LINKED_PROJECTS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 100) {
      totalCount
      pageInfo { hasNextPage }
      nodes { id number title shortDescription closed url }
    }
  }
}`

const ITEM_FIELD_VALUES_QUERY = `query($itemId: ID!) {
  node(id: $itemId) {
    ... on ProjectV2Item {
      id
      fieldValues(first: 100) {
        nodes {
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { id } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { id } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id } } }
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { id } } }
          ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2IterationField { id } } }
        }
      }
    }
  }
}`

const PROJECT_FIELDS_QUERY = `query($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      id
      fields(first: 100) {
        totalCount
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name color } }
          ... on ProjectV2IterationField {
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`

const PROJECT_ITEM_COUNT_QUERY = `query($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      id
      items { totalCount }
    }
  }
}`

const MAX_PARENT_QUERY_CONCURRENCY = 4
const MAX_LINKED_PROJECTS = 100
const MAX_PROJECT_FIELDS = 50
const MAX_PROJECT_FIELD_OPTIONS = 100
const MAX_PROJECT_FIELD_VALUE_CHARS = 96
const MAX_PROJECT_FIELDS_BYTES = 250_000
const MAX_PROJECT_ITEMS = 200
const MAX_PROJECT_ITEMS_BYTES = 1_250_000
function isCommandInterruption(error) {
  return error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR'
    || error?.code === 'GIT_COMMAND_CANCELLED'
    || error?.code === 'GITHUB_COMMAND_CANCELLED'
    || error?.code === 'GIT_COMMAND_TIMEOUT'
    || error?.code === 'GITHUB_COMMAND_TIMEOUT'
}

function buildIssueParentsQuery(issueNumbers) {
  const aliases = issueNumbers.map((number) => `issue_${number}: issue(number: ${number}) { number parent { number title url repository { nameWithOwner } } }`).join('\n')
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`
}

function assertProjectNumber(projectNumber) {
  if (!Number.isInteger(projectNumber) || projectNumber < 1) throw new Error('Project non valido.')
  return projectNumber
}

function parseLinkedProjectsPage(output) {
  const payload = JSON.parse(output)
  const connection = payload?.data?.repository?.projectsV2
  const projects = connection?.nodes
  if (!Array.isArray(projects)) return { projects: [], hasMore: false }
  const validProjects = projects.filter((project) => (
    typeof project?.id === 'string'
    && Number.isInteger(project.number)
    && typeof project.title === 'string'
    && typeof project.url === 'string'
  )).map((project) => ({
    id: project.id,
    number: project.number,
    title: project.title,
    shortDescription: typeof project.shortDescription === 'string' ? project.shortDescription : '',
    closed: Boolean(project.closed),
    url: project.url,
  }))
  const hasMore = connection?.pageInfo?.hasNextPage === true
    || (Number.isInteger(connection?.totalCount) && connection.totalCount > validProjects.length)
    || validProjects.length > MAX_LINKED_PROJECTS
  return { projects: validProjects.slice(0, MAX_LINKED_PROJECTS), hasMore }
}

function parseLinkedProjects(output) {
  return parseLinkedProjectsPage(output).projects
}

function splitRepositoryName(nameWithOwner) {
  const [owner, name, ...extra] = String(nameWithOwner).split('/')
  if (!owner || !name || extra.length > 0) throw new Error('Repository GitHub non riconosciuto.')
  return { owner, name }
}

async function listLinkedProjectsPage(run, workspacePath, repository) {
  const { owner, name } = splitRepositoryName(repository.nameWithOwner)
  const output = await run('gh', ['api', 'graphql', '-f', `query=${LINKED_PROJECTS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`], workspacePath)
  return parseLinkedProjectsPage(output)
}

async function listLinkedProjects(run, workspacePath, repository) {
  return (await listLinkedProjectsPage(run, workspacePath, repository)).projects
}

function parseProjectList(output, property) {
  const payload = JSON.parse(output)
  const values = payload?.[property]
  return Array.isArray(values) ? values : []
}

function projectFieldKey(name) {
  return typeof name === 'string' ? name.trim().toLocaleLowerCase('it-IT') : ''
}

function buildProjectItemListJq(fields) {
  const fieldKeys = [...new Set((Array.isArray(fields) ? fields : []).map((field) => projectFieldKey(field?.name)).filter(Boolean))]
    .filter((key) => !['title', 'assignees', 'status', 'stato'].includes(key))
    .slice(0, MAX_PROJECT_FIELDS)
  return `.items |= map(. as $item | reduce ${JSON.stringify(fieldKeys)}[] as $key ({
    id: (if ($item.id | type) == "string" then $item.id[:256] else null end),
    type: (if ($item.type | type) == "string" then $item.type[:64] else "UNKNOWN" end),
    assignees: [($item.assignees // [])[:10][] | select(type == "string") | .[:64]],
    status: (if ($item.status | type) == "string" then $item.status[:${MAX_PROJECT_FIELD_VALUE_CHARS}] else null end),
    content: (if ($item.content | type) == "object" then {
      title: (if ($item.content.title | type) == "string" then $item.content.title[:256] else null end),
      url: (if ($item.content.url | type) == "string" then $item.content.url[:512] else null end),
      number: (if ($item.content.number | type) == "number" then $item.content.number else null end),
      repository: (if ($item.content.repository | type) == "string" then $item.content.repository[:256] else null end)
    } else null end),
    valuesTruncated: (($item.assignees // []) | length > 10)
  }; if (($item[$key] | type) == "string") then
    .[$key] = $item[$key][0:${MAX_PROJECT_FIELD_VALUE_CHARS}]
    | if ($item[$key] | length) > ${MAX_PROJECT_FIELD_VALUE_CHARS} then .valuesTruncated = true else . end
  elif (($item[$key] | type) == "number") then .[$key] = $item[$key]
  elif (($item[$key] | type) == "boolean") then .[$key] = ($item[$key] | tostring)
  elif (($item[$key] | type) == "array") then
    .[$key] = ([$item[$key][] | if type == "string" or type == "number" or type == "boolean" then tostring elif type == "object" then (.name // .title // .login // .number // empty | tostring) else empty end] | join(", ") | .[0:${MAX_PROJECT_FIELD_VALUE_CHARS}])
    | if (($item[$key] | tostring | length) > ${MAX_PROJECT_FIELD_VALUE_CHARS}) then .valuesTruncated = true else . end
  else . end))`
}

function parseProjectFields(output, projectId) {
  const project = JSON.parse(output)?.data?.node
  const connection = project?.fields
  if (!project || project.id !== projectId || !Array.isArray(connection?.nodes)) throw new Error('Campi Project non disponibili.')
  const fields = connection.nodes.flatMap((field) => {
    if (typeof field?.id !== 'string' || typeof field?.name !== 'string' || typeof field?.dataType !== 'string') return []
    const rawOptions = field.__typename === 'ProjectV2IterationField'
      ? [...(field.configuration?.iterations ?? []), ...(field.configuration?.completedIterations ?? [])]
      : field.options ?? []
    const options = rawOptions.slice(0, MAX_PROJECT_FIELD_OPTIONS).flatMap((option) => {
      const name = option?.name ?? option?.title
      if (typeof option?.id !== 'string' || typeof name !== 'string') return []
      return [{
        id: option.id.slice(0, 256),
        name: name.slice(0, 256),
        ...(typeof option.color === 'string' ? { color: option.color.slice(0, 64) } : {}),
        ...(typeof option.startDate === 'string' ? { startDate: option.startDate } : {}),
        ...(Number.isInteger(option.duration) ? { duration: option.duration } : {}),
      }]
    })
    return [{
      id: field.id.slice(0, 256),
      name: field.name.slice(0, 256),
      dataType: field.dataType.slice(0, 64),
      ...(options.length ? { options } : {}),
      ...(rawOptions.length > options.length ? { optionsHasMore: true } : {}),
    }]
  })
  const hasMore = connection.pageInfo?.hasNextPage === true
    || (Number.isInteger(connection.totalCount) && connection.totalCount > fields.length)
    || fields.length > MAX_PROJECT_FIELDS
  return { fields: fields.slice(0, MAX_PROJECT_FIELDS), hasMore }
}

function parseProjectBoardList(output, fields) {
  const fieldEntries = Array.isArray(fields) ? fields.filter((field) => typeof field?.id === 'string' && projectFieldKey(field.name)) : []
  const statusField = fieldEntries.find((field) => ['status', 'stato'].includes(projectFieldKey(field.name)))
  return parseProjectList(output, 'items').filter((item) => typeof item?.id === 'string').map((item) => {
    const fieldValues = fieldEntries.reduce((values, field) => {
      const key = projectFieldKey(field.name)
      const value = key === 'title' ? item.content?.title ?? item.title
        : key === 'assignees' ? (Array.isArray(item.assignees) ? item.assignees.join(', ') : '')
          : ['status', 'stato'].includes(key) ? item.status
            : item[key]
      if (typeof value === 'string' || typeof value === 'number') values[field.id] = String(value)
      return values
    }, {})
    const content = item.content && typeof item.content.title === 'string'
      ? { title: item.content.title, ...(typeof item.content.url === 'string' ? { url: item.content.url } : {}), ...(Number.isInteger(item.content.number) ? { number: item.content.number } : {}), ...(typeof item.content.repository === 'string' ? { repository: item.content.repository } : {}) }
      : undefined
    const assignees = Array.isArray(item.assignees) ? item.assignees.filter((assignee) => typeof assignee === 'string') : []
    const status = typeof item.status === 'string' ? item.status : statusField ? fieldValues[statusField.id] : undefined
    return { id: item.id, type: typeof item.type === 'string' ? item.type : 'UNKNOWN', ...(assignees.length ? { assignees } : {}), ...(status ? { status } : {}), ...(content ? { title: content.title, content } : {}), ...(item.valuesTruncated === true ? { valuesTruncated: true } : {}), fieldValues }
  })
}

function limitProjectItems(items) {
  const limited = []
  let bytes = 2
  for (const item of items) {
    if (limited.length >= MAX_PROJECT_ITEMS) break
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + (limited.length > 0 ? 1 : 0)
    if (bytes + itemBytes > MAX_PROJECT_ITEMS_BYTES) break
    limited.push(item)
    bytes += itemBytes
  }
  return { items: limited, hasMore: limited.length < items.length, bytes }
}

function limitProjectFields(fields) {
  const limited = []
  let bytes = 2
  for (const field of fields) {
    if (limited.length >= MAX_PROJECT_FIELDS) break
    const fieldBytes = Buffer.byteLength(JSON.stringify(field), 'utf8') + (limited.length > 0 ? 1 : 0)
    if (bytes + fieldBytes > MAX_PROJECT_FIELDS_BYTES) break
    limited.push(field)
    bytes += fieldBytes
  }
  return { fields: limited, hasMore: limited.length < fields.length, bytes }
}

function parseIssueParents(output) {
  const issues = Object.values(JSON.parse(output)?.data?.repository ?? {})
  return issues.flatMap((issue) => {
    const parent = issue?.parent
    if (!Number.isInteger(issue?.number) || !parent || !Number.isInteger(parent.number) || typeof parent.title !== 'string' || typeof parent.url !== 'string') return []
    return [{ number: issue.number, parent: { number: parent.number, title: parent.title, url: parent.url, ...(typeof parent.repository?.nameWithOwner === 'string' ? { repository: parent.repository.nameWithOwner } : {}) } }]
  })
}

function applyIssueParents(items, relations) {
  const parentByIssue = new Map(relations.map((relation) => [`${relation.repository ?? '*'}/${relation.number}`, relation.parent]))
  return items.map((item) => {
    const number = item.content?.number
    const repository = item.content?.repository
    const parent = Number.isInteger(number) && typeof repository === 'string' ? parentByIssue.get(`${repository}/${number}`) ?? parentByIssue.get(`*/${number}`) : undefined
    return parent ? { ...item, parent } : item
  })
}

async function getIssueParents(run, workspacePath, items, fallbackRepository) {
  const groupedNumbers = new Map()
  for (const item of items) {
    const number = item.content?.number
    const repository = item.content?.repository ?? fallbackRepository
    if (!Number.isInteger(number) || typeof repository !== 'string') continue
    const numbers = groupedNumbers.get(repository) ?? new Set()
    numbers.add(number)
    groupedNumbers.set(repository, numbers)
  }
  const batches = [...groupedNumbers.entries()].flatMap(([repository, uniqueNumbers]) => [...uniqueNumbers].reduce((groups, number, index) => {
    const groupIndex = Math.floor(index / 50)
    groups[groupIndex] = [...(groups[groupIndex] ?? []), number]
    return groups
  }, []).map((numbers) => ({ repository, numbers })))
  const results = new Array(batches.length)
  let nextBatchIndex = 0
  // GitHub può richiedere molti batch: un pool fisso evita picchi di processi e richieste GraphQL.
  const workers = Array.from({ length: Math.min(MAX_PARENT_QUERY_CONCURRENCY, batches.length) }, async () => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex
      nextBatchIndex += 1
      const { repository, numbers } = batches[batchIndex]
      const { owner, name } = splitRepositoryName(repository)
      const output = await run('gh', ['api', 'graphql', '-f', `query=${buildIssueParentsQuery(numbers)}`, '-F', `owner=${owner}`, '-F', `name=${name}`], workspacePath)
      results[batchIndex] = parseIssueParents(output).map((relation) => ({ ...relation, repository }))
    }
  })
  await Promise.all(workers)
  return results.flat()
}

function parseProjectItemFieldValues(output, itemId) {
  const item = JSON.parse(output)?.data?.node
  if (!item || item.id !== itemId || !Array.isArray(item.fieldValues?.nodes)) throw new Error('Attività Project non trovata.')
  return item.fieldValues.nodes.reduce((values, fieldValue) => {
    const fieldId = fieldValue?.field?.id
    const value = fieldValue?.name ?? fieldValue?.title ?? fieldValue?.text ?? fieldValue?.number ?? fieldValue?.date
    if (typeof fieldId === 'string' && (typeof value === 'string' || typeof value === 'number')) values[fieldId] = String(value)
    return values
  }, {})
}

function parseProjectBoardItems(output, statusFieldId = '') {
  const page = JSON.parse(output)?.data?.node?.items
  if (!page || !Array.isArray(page.nodes)) throw new Error('Attività Project non trovate.')
  const items = page.nodes.filter((item) => typeof item?.id === 'string').map((item) => {
    const fieldValues = (item.fieldValues?.nodes ?? []).reduce((values, fieldValue) => {
      const fieldId = fieldValue?.field?.id
      const value = fieldValue?.name ?? fieldValue?.text ?? fieldValue?.number ?? fieldValue?.date
      if (typeof fieldId === 'string' && (typeof value === 'string' || typeof value === 'number')) values[fieldId] = String(value)
      return values
    }, {})
    const assignees = Array.isArray(item.content?.assignees?.nodes)
      ? item.content.assignees.nodes.map((assignee) => assignee?.login).filter((login) => typeof login === 'string')
      : []
    const content = item.content && typeof item.content.title === 'string'
      ? { title: item.content.title, ...(typeof item.content.url === 'string' ? { url: item.content.url } : {}), ...(Number.isInteger(item.content.number) ? { number: item.content.number } : {}) }
      : undefined
    return {
      id: item.id,
      type: typeof item.type === 'string' ? item.type : 'UNKNOWN',
      ...(content ? { title: content.title, content } : {}),
      ...(assignees.length ? { assignees } : {}),
      ...(statusFieldId && fieldValues[statusFieldId] ? { status: fieldValues[statusFieldId] } : {}),
      fieldValues,
    }
  })
  return { items, hasNextPage: page.pageInfo?.hasNextPage === true, endCursor: typeof page.pageInfo?.endCursor === 'string' ? page.pageInfo.endCursor : null }
}

function parseProjectItemCount(output, projectId) {
  const project = JSON.parse(output)?.data?.node
  const count = project?.items?.totalCount
  if (project?.id !== projectId || !Number.isInteger(count) || count < 0) throw new Error('Conteggio attività Project non disponibile.')
  return count
}

function assertNodeId(value) {
  if (typeof value !== 'string' || value.startsWith('-') || !/^[A-Za-z0-9_-]{3,256}$/.test(value)) throw new Error('Dati Project non validi.')
  return value
}

function buildItemEditArgs(projectId, itemId, fieldId, update) {
  const base = ['project', 'item-edit', '--project-id', assertNodeId(projectId), '--id', assertNodeId(itemId), '--field-id', assertNodeId(fieldId)]
  if (!update || typeof update !== 'object') throw new Error('Dati Project non validi.')
  if (update.type === 'singleSelect') return [...base, '--single-select-option-id', assertNodeId(update.optionId)]
  if (update.type === 'iteration') return [...base, '--iteration-id', assertNodeId(update.iterationId)]
  if (update.type === 'text' && typeof update.value === 'string' && update.value.length <= 65_536) return [...base, '--text', update.value]
  if (update.type === 'number' && typeof update.value === 'number' && Number.isFinite(update.value)) return [...base, '--number', String(update.value)]
  if (update.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(update.value ?? '')) return [...base, '--date', update.value]
  if (update.type === 'clear') return [...base, '--clear']
  throw new Error('Dati Project non validi.')
}

function assertProjectDetails(title, description) {
  if (typeof title !== 'string' || !title.trim() || title.length > 256 || typeof description !== 'string' || description.length > 1_024) {
    throw new Error('Dati Project non validi.')
  }
  return { title: title.trim(), description }
}

async function getProjectBoard(run, workspacePath, repository, projectNumber) {
  const number = assertProjectNumber(projectNumber)
  const projects = await listLinkedProjects(run, workspacePath, repository)
  const project = projects.find((candidate) => candidate.number === number)
  if (!project) throw new Error('Questo Project non è collegato al repository del workspace.')
  const [fieldsOutput, countOutput] = await Promise.all([
    run('gh', ['api', 'graphql', '-f', `query=${PROJECT_FIELDS_QUERY}`, '-F', `projectId=${project.id}`], workspacePath),
    run('gh', ['api', 'graphql', '-f', `query=${PROJECT_ITEM_COUNT_QUERY}`, '-F', `projectId=${project.id}`], workspacePath),
  ])
  const sourceFieldPage = parseProjectFields(fieldsOutput, project.id)
  const fieldPage = limitProjectFields(sourceFieldPage.fields)
  const fields = fieldPage.fields
  const fieldsHasMore = sourceFieldPage.hasMore || fieldPage.hasMore
  const fieldOptionsTruncated = fields.some((field) => field?.optionsHasMore === true)
  const itemCount = parseProjectItemCount(countOutput, project.id)
  const requestedItems = Math.max(1, Math.min(itemCount, MAX_PROJECT_ITEMS + 1))
  const itemsOutput = await run('gh', ['project', 'item-list', String(number), '--owner', repository.owner, '--limit', String(requestedItems), '--format', 'json', '--jq', buildProjectItemListJq(fields)], workspacePath)
  const sourceItemPage = limitProjectItems(parseProjectBoardList(itemsOutput, fields))
  // La gerarchia è un arricchimento: un permesso GitHub mancante non deve impedire l'uso della board.
  const parents = await getIssueParents(run, workspacePath, sourceItemPage.items, repository.nameWithOwner).catch((error) => {
    if (isCommandInterruption(error)) throw error
    return []
  })
  // I metadati padre fanno parte del DTO renderer e possono aumentare il payload:
  // il budget va quindi riapplicato dopo l'arricchimento, non soltanto all'output di gh.
  const itemPage = limitProjectItems(applyIssueParents(sourceItemPage.items, parents))
  const itemsHasMore = sourceItemPage.hasMore || itemPage.hasMore || itemCount > itemPage.items.length
  const itemValuesTruncated = itemPage.items.some((item) => item.valuesTruncated === true)
  const hasMore = fieldsHasMore || itemsHasMore
  const truncated = hasMore || fieldOptionsTruncated || itemValuesTruncated
  return {
    project,
    fields,
    fieldsHasMore,
    fieldsTruncated: fieldsHasMore || fieldOptionsTruncated,
    fieldOptionsTruncated,
    fieldsResultBytes: fieldPage.bytes,
    items: itemPage.items,
    itemsHasMore,
    itemsTruncated: itemsHasMore || itemValuesTruncated,
    itemValuesTruncated,
    itemsResultBytes: itemPage.bytes,
    hasMore,
    truncated,
  }
}

async function addIssueToProject(run, workspacePath, repository, projectNumber, issueUrl) {
  const number = assertProjectNumber(projectNumber)
  if (typeof issueUrl !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/i.test(issueUrl)) throw new Error('Issue o pull request non valida.')
  await run('gh', ['project', 'item-add', String(number), '--owner', repository.owner, '--url', issueUrl], workspacePath)
  return getProjectBoard(run, workspacePath, repository, number)
}

async function updateProjectItem(run, workspacePath, repository, projectNumber, itemId, fieldId, update) {
  const board = await getProjectBoard(run, workspacePath, repository, projectNumber)
  await run('gh', buildItemEditArgs(board.project.id, itemId, fieldId, update), workspacePath)
  return getProjectBoard(run, workspacePath, repository, projectNumber)
}

async function getProjectItemFields(run, workspacePath, repository, projectNumber, itemId) {
  const safeItemId = assertNodeId(itemId)
  const board = await getProjectBoard(run, workspacePath, repository, projectNumber)
  if (!board.items.some((item) => item.id === safeItemId)) throw new Error('Questa attività non appartiene al Project del workspace.')
  const output = await run('gh', ['api', 'graphql', '-f', `query=${ITEM_FIELD_VALUES_QUERY}`, '-F', `itemId=${safeItemId}`], workspacePath)
  return parseProjectItemFieldValues(output, safeItemId)
}

async function createProjectDraft(run, workspacePath, repository, projectNumber, title, body) {
  const number = assertProjectNumber(projectNumber)
  if (typeof title !== 'string' || !title.trim() || title.length > 256 || typeof body !== 'string' || body.length > 65_536) throw new Error('Bozza Project non valida.')
  await run('gh', ['project', 'item-create', String(number), '--owner', repository.owner, '--title', title.trim(), '--body', body], workspacePath)
  return getProjectBoard(run, workspacePath, repository, number)
}

async function archiveProjectItem(run, workspacePath, repository, projectNumber, itemId, undo = false) {
  const number = assertProjectNumber(projectNumber)
  const args = ['project', 'item-archive', String(number), '--owner', repository.owner, '--id', assertNodeId(itemId)]
  if (undo === true) args.push('--undo')
  await run('gh', args, workspacePath)
  return getProjectBoard(run, workspacePath, repository, number)
}

async function createLinkedProject(run, workspacePath, repository, title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 256) throw new Error('Inserisci un titolo Project valido.')
  const output = await run('gh', ['project', 'create', '--owner', repository.owner, '--title', title.trim(), '--format', 'json'], workspacePath)
  const created = JSON.parse(output)
  const number = assertProjectNumber(created.number)
  await run('gh', ['project', 'link', String(number), '--owner', repository.owner, '--repo', repository.nameWithOwner], workspacePath)
  return listLinkedProjects(run, workspacePath, repository)
}

async function editLinkedProject(run, workspacePath, repository, projectNumber, title, description) {
  const number = assertProjectNumber(projectNumber)
  const project = (await listLinkedProjects(run, workspacePath, repository)).find((candidate) => candidate.number === number)
  if (!project) throw new Error('Questo Project non è collegato al repository del workspace.')
  const details = assertProjectDetails(title, description)
  await run('gh', ['project', 'edit', String(number), '--owner', repository.owner, '--title', details.title, '--description', details.description], workspacePath)
  return listLinkedProjects(run, workspacePath, repository)
}

async function closeLinkedProject(run, workspacePath, repository, projectNumber, undo = false) {
  const number = assertProjectNumber(projectNumber)
  const project = (await listLinkedProjects(run, workspacePath, repository)).find((candidate) => candidate.number === number)
  if (!project) throw new Error('Questo Project non è collegato al repository del workspace.')
  const args = ['project', 'close', String(number), '--owner', repository.owner]
  if (undo === true) args.push('--undo')
  await run('gh', args, workspacePath)
  return listLinkedProjects(run, workspacePath, repository)
}

module.exports = { MAX_PROJECT_FIELDS, MAX_PROJECT_ITEMS, PROJECT_FIELDS_QUERY, addIssueToProject, applyIssueParents, archiveProjectItem, assertNodeId, assertProjectDetails, assertProjectNumber, buildItemEditArgs, buildIssueParentsQuery, buildProjectItemListJq, closeLinkedProject, createLinkedProject, createProjectDraft, editLinkedProject, getProjectBoard, getProjectItemFields, limitProjectFields, limitProjectItems, listLinkedProjects, listLinkedProjectsPage, parseIssueParents, parseLinkedProjects, parseLinkedProjectsPage, parseProjectBoardItems, parseProjectBoardList, parseProjectFields, parseProjectItemCount, parseProjectItemFieldValues, updateProjectItem }
