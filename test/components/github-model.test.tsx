import { describe, expect, it } from 'vitest'
import type { GitHubIssue, GitHubProjectBoard, GitHubProjectField, GitHubProjectItem } from '@/bridge'
import { formatCacheState, formatDate, formatRelativeDate } from '@/features/github/model/github-display'
import { issueStateCounts, matchesIssueSearch, visibleGitHubIssues } from '@/features/github/model/github-issues'
import {
  groupProjectItems,
  matchesGitHubProjectSearch,
  matchesProjectItemSearch,
  orderProjectItemsByHierarchy,
  projectBoardLimitMessages,
  projectFieldDataType,
  projectFieldName,
  projectItemTypeLabel,
  projectIssueKey,
  projectStatusCounts,
} from '@/features/github/model/github-projects'

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: 'Correggi sincronizzazione',
    body: 'Mantieni lo stato locale',
    state: 'OPEN',
    author: { login: 'dev' },
    createdAt: '2026-08-24T09:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
    url: 'https://example.test/issues/42',
    labels: [{ name: 'affidabilità' }],
    ...overrides,
  }
}

function projectItem(id: string, number: number, overrides: Partial<GitHubProjectItem> = {}): GitHubProjectItem {
  return {
    id,
    type: 'ISSUE',
    content: { number, repository: 'owner/repo', title: `Issue ${number}` },
    ...overrides,
  }
}

function projectBoard(overrides: Partial<GitHubProjectBoard> = {}): GitHubProjectBoard {
  return {
    project: { id: 'project-1', number: 1, title: 'Roadmap', shortDescription: '', closed: false, url: 'https://example.test/projects/1' },
    fields: [],
    fieldsHasMore: false,
    fieldsTruncated: false,
    fieldOptionsTruncated: false,
    fieldsResultBytes: 0,
    items: [],
    itemsHasMore: false,
    itemsTruncated: false,
    itemValuesTruncated: false,
    itemsResultBytes: 0,
    hasMore: false,
    truncated: false,
    ...overrides,
  }
}

describe('GitHub display model', () => {
  it('formatta cache e date senza dipendere dal componente React', () => {
    const now = Date.parse('2026-08-24T12:10:00.000Z')
    expect(formatCacheState(null, now)).toBeNull()
    expect(formatCacheState({ fetchedAt: now - 30_000, expiresAt: now, stale: false }, now)).toBe('Aggiornato ora')
    expect(formatCacheState({ fetchedAt: now - 5 * 60_000, expiresAt: now, stale: false }, now)).toBe('Aggiornato 5 min fa')
    expect(formatCacheState({ fetchedAt: now, expiresAt: now, stale: true }, now)).toBe('Dati non aggiornati')
    expect(formatDate('2026-08-24T10:00:00.000Z')).toContain('2026')
    expect(formatRelativeDate('2026-08-24T10:10:00.000Z', now)).toBe('2 ore fa')
    expect(formatRelativeDate('2026-08-23T12:10:00.000Z', now)).toBe('ieri')
  })
})

describe('GitHub issue model', () => {
  it('cerca per numero, testo ed etichetta e applica lo stato', () => {
    const open = issue()
    const closed = issue({ number: 7, title: 'Documentazione', body: '', state: 'CLOSED', labels: [{ name: 'docs' }] })

    expect(matchesIssueSearch(open, '#42')).toBe(true)
    expect(matchesIssueSearch(open, 'STATO LOCALE')).toBe(true)
    expect(matchesIssueSearch(open, 'AFFIDABILITÀ')).toBe(true)
    expect(matchesIssueSearch(open, '#7')).toBe(false)
    expect(issueStateCounts([open, closed, issue({ number: 8 })])).toEqual({ OPEN: 2, CLOSED: 1 })
    expect(visibleGitHubIssues([open, closed], 'doc', 'CLOSED')).toEqual([closed])
    expect(visibleGitHubIssues([open, closed], '', 'OPEN')).toEqual([open])
  })
})

describe('GitHub Projects model', () => {
  it('cerca i Project e distingue i tipi di attività', () => {
    const roadmap = { id: 'p1', number: 12, title: 'Roadmap Frontend', shortDescription: 'Esperienza developer', closed: false, url: 'https://example.test/projects/12' }

    expect(matchesGitHubProjectSearch(roadmap, 'frontend')).toBe(true)
    expect(matchesGitHubProjectSearch(roadmap, 'developer')).toBe(true)
    expect(matchesGitHubProjectSearch(roadmap, '12')).toBe(true)
    expect(matchesGitHubProjectSearch(roadmap, 'backend')).toBe(false)
    expect(projectItemTypeLabel(projectItem('issue', 1))).toBe('Issue')
    expect(projectItemTypeLabel(projectItem('draft', 2, { type: 'DRAFT_ISSUE' }))).toBe('Bozza')
    expect(projectItemTypeLabel(projectItem('pr', 3, { type: 'PULL_REQUEST' }))).toBe('Pull request')
  })

  it('cerca attività per issue, titolo, assegnatario e valori dei campi', () => {
    const item = projectItem('item-42', 42, {
      assignees: ['Vincenzo'],
      fieldValues: { priority: 'Urgente' },
      status: 'In corso',
    })

    expect(matchesProjectItemSearch(item, '#42')).toBe(true)
    expect(matchesProjectItemSearch(item, 'issue 42')).toBe(true)
    expect(matchesProjectItemSearch(item, 'vincenzo')).toBe(true)
    expect(matchesProjectItemSearch(item, 'urgente')).toBe(true)
    expect(matchesProjectItemSearch(item, 'chiusa')).toBe(false)
  })

  it('ordina le sub-issue dopo il padre senza perdere elementi orfani', () => {
    const child = projectItem('child', 43, { parent: { title: 'Issue 42', url: 'https://example.test/issues/42', number: 42, repository: 'owner/repo' } })
    const parent = projectItem('parent', 42)
    const orphan = projectItem('orphan', 99, { parent: { title: 'Assente', url: 'https://example.test/issues/98', number: 98, repository: 'owner/repo' } })

    expect(projectIssueKey(parent)).toBe('owner/repo#42')
    expect(orderProjectItemsByHierarchy([child, orphan, parent])).toEqual([
      { item: orphan, depth: 0 },
      { item: parent, depth: 0 },
      { item: child, depth: 1 },
    ])
  })

  it('raggruppa, conta gli stati e normalizza i metadati dei campi', () => {
    const statusField: GitHubProjectField = { id: 'status', name: 'Stato', dataType: 'SINGLE_SELECT' }
    const groupField: GitHubProjectField = { id: 'area', name: 'Area', dataType: 'TEXT' }
    const backend = projectItem('backend', 1, { fieldValues: { area: 'Backend' }, status: 'Aperto' })
    const ungrouped = projectItem('ungrouped', 2, { fieldValues: { area: '' }, status: 'Aperto' })
    const closed = projectItem('closed', 3, { status: 'Chiuso' })

    expect([...groupProjectItems([backend, ungrouped], 'area', groupField, statusField)]).toEqual([
      ['Backend', [backend]],
      ['Senza gruppo', [ungrouped]],
    ])
    expect([...groupProjectItems([backend, closed], 'status', statusField, statusField)]).toEqual([
      ['Aperto', [backend]],
      ['Chiuso', [closed]],
    ])
    expect([...projectStatusCounts([backend, ungrouped, closed])]).toEqual([['Aperto', 2], ['Chiuso', 1]])
    expect(projectFieldName(statusField)).toBe('stato')
    expect(projectFieldDataType(statusField)).toBe('single_select')
  })

  it('spiega in modo stabile ogni limite noto della board', () => {
    expect(projectBoardLimitMessages(projectBoard({ fieldsHasMore: true, itemValuesTruncated: true }))).toEqual([
      'Sono mostrati solo i primi campi disponibili.',
      'Alcuni valori delle attività sono stati abbreviati.',
    ])
    expect(projectBoardLimitMessages(projectBoard({ hasMore: true }))).toEqual([
      'La board contiene altri dati non inclusi in questa vista.',
    ])
    expect(projectBoardLimitMessages(null)).toEqual([])
  })
})
