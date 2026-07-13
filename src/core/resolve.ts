export interface ResolvableEntity {
  id: string
  name: string
}

export type ResolutionMethod = "exact_id" | "exact_name" | "id_prefix" | "name_prefix" | "fuzzy"

export interface ResolutionMatch<T extends ResolvableEntity> {
  ok: true
  value: T
  method: ResolutionMethod
}

export type ResolutionFailureCode = "not_found" | "ambiguous" | "prefix_too_short"

export interface ResolutionFailure<T extends ResolvableEntity> {
  ok: false
  code: ResolutionFailureCode
  query: string
  candidates: readonly T[]
}

export type ResolutionResult<T extends ResolvableEntity> = ResolutionMatch<T> | ResolutionFailure<T>

export interface ResolveOptions {
  minimumPrefixLength?: number
  /** Fuzzy selection is a human convenience and remains off unless explicitly enabled. */
  allowFuzzy?: boolean
  /** Machine/non-interactive callers must leave this false. */
  interactive?: boolean
  maximumFuzzyDistance?: number
}

export class ResolutionError<T extends ResolvableEntity = ResolvableEntity> extends Error {
  readonly code: ResolutionFailureCode
  readonly query: string
  readonly candidates: readonly T[]

  constructor(failure: ResolutionFailure<T>) {
    const suffix = failure.candidates.length
      ? `: ${failure.candidates.map((candidate) => candidate.id).join(", ")}`
      : ""
    super(`${failure.code.replaceAll("_", " ")}: ${failure.query}${suffix}`)
    this.name = "ResolutionError"
    this.code = failure.code
    this.query = failure.query
    this.candidates = failure.candidates
  }
}

export function normalizeEntityName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}

function uniqueEntities<T extends ResolvableEntity>(values: readonly T[]): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value.id)) return false
    seen.add(value.id)
    return true
  })
}

function matchOrAmbiguous<T extends ResolvableEntity>(
  query: string,
  matches: readonly T[],
  method: ResolutionMethod,
): ResolutionResult<T> | undefined {
  const candidates = uniqueEntities(matches)
  if (candidates.length === 1) return { ok: true, value: candidates[0] as T, method }
  if (candidates.length > 1) return { ok: false, code: "ambiguous", query, candidates }
  return undefined
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0
  if (!left) return right.length
  if (!right) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1]
    const leftCharacter = left[leftIndex]
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitution =
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) +
        (leftCharacter === right[rightIndex] ? 0 : 1)
      const insertion = (current[rightIndex] ?? Number.POSITIVE_INFINITY) + 1
      const deletion = (previous[rightIndex + 1] ?? Number.POSITIVE_INFINITY) + 1
      current.push(Math.min(substitution, insertion, deletion))
    }
    previous = current
  }
  return previous[right.length] ?? Math.max(left.length, right.length)
}

export function resolveEntity<T extends ResolvableEntity>(
  queryValue: string,
  entities: readonly T[],
  options: ResolveOptions = {},
): ResolutionResult<T> {
  const query = queryValue.trim()
  const normalizedQuery = normalizeEntityName(query)
  const minimumPrefixLength = options.minimumPrefixLength ?? 4

  const exactId = matchOrAmbiguous(
    query,
    entities.filter((entity) => entity.id === query),
    "exact_id",
  )
  if (exactId) return exactId

  const exactName = matchOrAmbiguous(
    query,
    entities.filter((entity) => normalizeEntityName(entity.name) === normalizedQuery),
    "exact_name",
  )
  if (exactName) return exactName

  if (query.length < minimumPrefixLength) {
    return { ok: false, code: "prefix_too_short", query, candidates: [] }
  }

  const idPrefixMatches = entities.filter((entity) => entity.id.startsWith(query))
  const idPrefix = matchOrAmbiguous(query, idPrefixMatches, "id_prefix")
  if (idPrefix) return idPrefix

  const namePrefixMatches = entities.filter((entity) =>
    normalizeEntityName(entity.name).startsWith(normalizedQuery),
  )
  const namePrefix = matchOrAmbiguous(query, namePrefixMatches, "name_prefix")
  if (namePrefix) return namePrefix

  if (options.allowFuzzy && options.interactive) {
    const maximumDistance =
      options.maximumFuzzyDistance ?? Math.max(1, Math.floor(normalizedQuery.length / 4))
    const ranked = entities
      .map((entity) => ({
        entity,
        distance: levenshteinDistance(normalizedQuery, normalizeEntityName(entity.name)),
      }))
      .filter(({ distance }) => distance <= maximumDistance)
      .sort(
        (left, right) =>
          left.distance - right.distance || left.entity.id.localeCompare(right.entity.id),
      )

    const best = ranked[0]
    if (best) {
      const tied = ranked
        .filter(({ distance }) => distance === best.distance)
        .map(({ entity }) => entity)
      if (tied.length === 1) return { ok: true, value: best.entity, method: "fuzzy" }
      return { ok: false, code: "ambiguous", query, candidates: tied }
    }
  }

  return { ok: false, code: "not_found", query, candidates: [] }
}

export function requireResolved<T extends ResolvableEntity>(
  query: string,
  entities: readonly T[],
  options?: ResolveOptions,
): ResolutionMatch<T> {
  const result = resolveEntity(query, entities, options)
  if (!result.ok) throw new ResolutionError(result)
  return result
}
