import type { ArtifactManifestRecord, PromptUniquenessResult } from './types.js'

function isSimilarRun(currentParams: Record<string, string>, record: ArtifactManifestRecord): boolean {
  const previousParams = record.manifest.params
  let matches = 0

  for (const [key, value] of Object.entries(currentParams)) {
    if (previousParams[key] === value) {
      matches += 1
    }
  }

  if (matches >= Math.min(2, Object.keys(currentParams).length)) {
    return true
  }

  return Object.entries(currentParams).every(([key, value]) => previousParams[key] === value)
}

export function buildPromptUniqueness(input: {
  enabled: boolean
  lookback: number
  currentParams: Record<string, string>
  manifests: ArtifactManifestRecord[]
}): PromptUniquenessResult {
  const lookback = Math.max(0, input.lookback)
  if (!input.enabled || lookback === 0) {
    return { applied: false, lookback, sources: [] }
  }

  const similar = input.manifests.filter(record => isSimilarRun(input.currentParams, record)).slice(0, lookback)

  if (similar.length === 0) {
    return { applied: false, lookback, sources: [] }
  }

  const listedPrompts = similar
    .slice(0, 3)
    .map((record, index) => `${index + 1}. ${record.manifest.resolvedPrompt}`)
    .join('\n')

  return {
    applied: true,
    lookback,
    sources: similar.map(record => record.directoryName),
    augmentation: [
      'Additional runtime uniqueness rule:',
      'Avoid closely repeating the concrete visual solutions used in the previous similar prompts below.',
      'Preserve the same creative direction and subject, but change at least 6 visual dimensions such as setting, geometry, materials, appearance, wardrobe, action, lighting, palette emphasis, camera angle, weather, or object placement.',
      'Previous similar prompts:',
      listedPrompts,
    ].join('\n'),
  }
}
