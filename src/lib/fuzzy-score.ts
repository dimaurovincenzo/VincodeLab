export type FuzzyMatchKind =
  | 'none'
  | 'exact'
  | 'prefix'
  | 'basename-exact'
  | 'basename-prefix'
  | 'word-boundary'
  | 'substring'
  | 'subsequence'

export type FuzzyUsageSignal = Readonly<{
  lastUsedAt?: number
  frequency?: number
}>

export type FuzzySearchCandidate = Readonly<{
  id: string
  label: string
  category?: string
  path?: string
  keywords?: readonly string[]
}>

export type FuzzyScore = Readonly<{
  score: number
  match: FuzzyMatchKind
  usageBoost: number
}>

export type RankedFuzzyCandidate<T> = FuzzyScore & Readonly<{
  item: T
}>

export type RankFuzzyOptions<T extends FuzzySearchCandidate> = Readonly<{
  getUsage?: (candidate: T) => FuzzyUsageSignal | undefined
  maxResults?: number
  now?: number
}>

type TextMatch = Readonly<{
  score: number
  match: FuzzyMatchKind
}>

type PreparedCandidate = Readonly<{
  labelSource: string
  pathSource?: string
  categorySource?: string
  keywordsSource?: readonly string[]
  label: string
  basename?: string
  path?: string
  category?: string
  keywords: readonly string[]
}>

const dayMs = 24 * 60 * 60 * 1_000
const preparedCandidates = new WeakMap<object, PreparedCandidate>()

function hasNonAscii(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7F) return true
  }
  return false
}

export function normalizeFuzzyText(value: string) {
  const comparable = hasNonAscii(value)
    ? value.normalize('NFKD').replace(/\p{M}/gu, '')
    : value
  return comparable
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[\\/_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fuzzyBasename(path: string) {
  const normalizedPath = path.replaceAll('\\', '/')
  const end = normalizedPath.endsWith('/') ? normalizedPath.length - 1 : normalizedPath.length
  const start = normalizedPath.lastIndexOf('/', end - 1) + 1
  return normalizedPath.slice(start, end)
}

function isWordBoundary(value: string, index: number) {
  if (index === 0) return true
  const previous = value[index - 1] ?? ''
  const current = value[index] ?? ''
  return /[^a-z0-9]/i.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(current))
}

function scoreSubsequence(query: string, value: string): TextMatch | null {
  let queryIndex = 0
  let previousIndex = -2
  let firstIndex = -1
  let gaps = 0
  let consecutive = 0
  let boundaries = 0

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) continue
    if (firstIndex < 0) firstIndex = valueIndex
    if (valueIndex === previousIndex + 1) consecutive += 1
    else if (previousIndex >= 0) gaps += valueIndex - previousIndex - 1
    if (isWordBoundary(value, valueIndex)) boundaries += 1
    previousIndex = valueIndex
    queryIndex += 1
  }

  if (queryIndex !== query.length) return null
  return {
    match: 'subsequence',
    score: 420 + (consecutive * 14) + (boundaries * 24) - (gaps * 4) - (firstIndex * 2),
  }
}

function scoreText(query: string, value: string): TextMatch | null {
  if (!value) return null
  if (value === query) return { match: 'exact', score: 1_200 }
  if (value.startsWith(query)) return { match: 'prefix', score: 950 - Math.min(value.length - query.length, 120) }

  const substringIndex = value.indexOf(query)
  if (substringIndex >= 0) {
    if (isWordBoundary(value, substringIndex)) {
      return { match: 'word-boundary', score: 780 - Math.min(substringIndex, 100) }
    }
    return { match: 'substring', score: 650 - Math.min(substringIndex, 120) }
  }

  return scoreSubsequence(query, value)
}

function scoreUsage(signal: FuzzyUsageSignal | undefined, now: number) {
  if (!signal) return 0
  const frequency = Number.isFinite(signal.frequency) ? Math.max(0, signal.frequency ?? 0) : 0
  const frequencyBoost = Math.min(90, Math.log2(frequency + 1) * 18)

  const lastUsedAt = signal.lastUsedAt
  if (!Number.isFinite(lastUsedAt)) return frequencyBoost
  const age = Math.max(0, now - (lastUsedAt ?? now))
  const recencyBoost = 120 / (1 + (age / dayMs))
  return frequencyBoost + recencyBoost
}

function pickBest(current: TextMatch | null, candidate: TextMatch | null) {
  if (!candidate || (current && current.score >= candidate.score)) return current
  return candidate
}

function prepareCandidate(candidate: FuzzySearchCandidate) {
  const cached = preparedCandidates.get(candidate)
  if (
    cached
    && cached.labelSource === candidate.label
    && cached.pathSource === candidate.path
    && cached.categorySource === candidate.category
    && cached.keywordsSource === candidate.keywords
  ) return cached

  const prepared: PreparedCandidate = {
    labelSource: candidate.label,
    pathSource: candidate.path,
    categorySource: candidate.category,
    keywordsSource: candidate.keywords,
    label: normalizeFuzzyText(candidate.label),
    ...(candidate.path ? {
      basename: normalizeFuzzyText(fuzzyBasename(candidate.path)),
      path: normalizeFuzzyText(candidate.path),
    } : {}),
    ...(candidate.category ? { category: normalizeFuzzyText(candidate.category) } : {}),
    keywords: (candidate.keywords ?? []).map(normalizeFuzzyText),
  }
  preparedCandidates.set(candidate, prepared)
  return prepared
}

function scoreNormalizedCandidate(
  normalizedQuery: string,
  candidate: FuzzySearchCandidate,
  usage: FuzzyUsageSignal | undefined,
  now: number,
): FuzzyScore | null {
  const usageBoost = scoreUsage(usage, now)
  if (!normalizedQuery) return { score: usageBoost, match: 'none', usageBoost }

  const prepared = prepareCandidate(candidate)
  let best = scoreText(normalizedQuery, prepared.label)
  if (best) best = { ...best, score: best.score + 200 }

  if (prepared.basename && prepared.path) {
    const basenameMatch = scoreText(normalizedQuery, prepared.basename)
    if (basenameMatch) {
      const match = basenameMatch.match === 'exact'
        ? 'basename-exact'
        : basenameMatch.match === 'prefix' ? 'basename-prefix' : basenameMatch.match
      best = pickBest(best, { match, score: basenameMatch.score + 160 })
    }

    const pathMatch = scoreText(normalizedQuery, prepared.path)
    if (pathMatch) best = pickBest(best, { ...pathMatch, score: pathMatch.score - 80 })
  }

  if (prepared.category) {
    const categoryMatch = scoreText(normalizedQuery, prepared.category)
    if (categoryMatch) best = pickBest(best, { ...categoryMatch, score: categoryMatch.score + 40 })
  }

  for (const keyword of prepared.keywords) {
    const keywordMatch = scoreText(normalizedQuery, keyword)
    if (keywordMatch) best = pickBest(best, { ...keywordMatch, score: keywordMatch.score + 20 })
  }

  if (!best) return null
  return { score: best.score + usageBoost, match: best.match, usageBoost }
}

export function scoreFuzzyCandidate(
  query: string,
  candidate: FuzzySearchCandidate,
  usage?: FuzzyUsageSignal,
  now = Date.now(),
): FuzzyScore | null {
  const normalizedQuery = normalizeFuzzyText(query)
  return scoreNormalizedCandidate(normalizedQuery, candidate, usage, now)
}

export function rankFuzzyCandidates<T extends FuzzySearchCandidate>(
  query: string,
  candidates: readonly T[],
  options: RankFuzzyOptions<T> = {},
): RankedFuzzyCandidate<T>[] {
  const now = options.now ?? Date.now()
  const normalizedQuery = normalizeFuzzyText(query)
  const ranked = candidates.flatMap((item, index) => {
    const result = scoreNormalizedCandidate(normalizedQuery, item, options.getUsage?.(item), now)
    return result ? [{ ...result, item, index }] : []
  })

  ranked.sort((left, right) => right.score - left.score || left.index - right.index)
  const requestedMax = options.maxResults ?? ranked.length
  const maxResults = Number.isFinite(requestedMax)
    ? Math.max(0, Math.floor(requestedMax))
    : ranked.length
  return ranked.slice(0, maxResults).map(({ index: _index, ...result }) => result)
}
