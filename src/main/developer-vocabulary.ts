export const MAX_VOCABULARY_TERMS = 50
export const MAX_VOCABULARY_TERM_LENGTH = 64

// Groq caps transcription prompts at 224 tokens. A conservative character cap
// leaves room for identifiers that tokenize less efficiently than prose.
const MAX_GROQ_PROMPT_CHARACTERS = 400

export function normalizeVocabularyTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_VOCABULARY_TERM_LENGTH)
}

export function normalizeVocabulary(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const term = normalizeVocabularyTerm(candidate)
    const comparisonKey = term.toLocaleLowerCase('en-US')
    if (!term || seen.has(comparisonKey)) continue

    normalized.push(term)
    seen.add(comparisonKey)
    if (normalized.length === MAX_VOCABULARY_TERMS) break
  }

  return normalized
}

export function buildGroqVocabularyPrompt(vocabulary: readonly string[]): string | undefined {
  if (vocabulary.length === 0) return undefined

  const prefix = 'Preferred spellings for technical terms: '
  const suffix = '. Use these spellings only when the corresponding terms are spoken.'
  const included: string[] = []

  for (const term of vocabulary) {
    const candidate = `${prefix}${[...included, term].join(', ')}${suffix}`
    if (candidate.length > MAX_GROQ_PROMPT_CHARACTERS) break
    included.push(term)
  }

  return included.length > 0 ? `${prefix}${included.join(', ')}${suffix}` : undefined
}
