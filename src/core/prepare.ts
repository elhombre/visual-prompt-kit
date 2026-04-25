import { listArtifactManifests } from './artifacts.js'
import { loadProject } from './config.js'
import { extractPlaceholderNames, resolveParameters } from './params.js'
import { buildPromptProviderInput, hydrateMetaPrompt } from './prompt.js'
import type { PreparedPromptGeneration, PreparePromptGenerationInput } from './types.js'
import { buildPromptUniqueness } from './uniqueness.js'

function findUnresolvedPlaceholders(value: string): string[] {
  return [...new Set(value.match(/{{\s*[A-Za-z][A-Za-z0-9_]*\s*}}/g) ?? [])]
}

export async function preparePromptGeneration(input: PreparePromptGenerationInput): Promise<PreparedPromptGeneration> {
  const project = await loadProject(input.projectPath)
  const placeholderNames = extractPlaceholderNames(project.metaPrompt)
  const resolved = resolveParameters({
    project,
    overrides: input.overrides,
    placeholderNames,
  })

  const hydratedMetaPrompt = hydrateMetaPrompt(project.metaPrompt, resolved.params)
  const unresolvedPlaceholders = findUnresolvedPlaceholders(hydratedMetaPrompt)

  if (unresolvedPlaceholders.length > 0) {
    throw new Error(`Missing values for placeholders: ${unresolvedPlaceholders.join(', ')}`)
  }

  const uniquenessEnabled = input.unique ?? project.config.uniqueness?.enabled ?? false
  const uniquenessLookback = input.uniqueLookback ?? project.config.uniqueness?.lookback ?? 20
  const manifests = uniquenessEnabled ? await listArtifactManifests(project.artifactsDir) : []
  const uniqueness = buildPromptUniqueness({
    enabled: uniquenessEnabled,
    lookback: uniquenessLookback,
    currentParams: resolved.params,
    manifests,
  })

  return {
    project,
    resolved,
    hydratedMetaPrompt,
    uniqueness,
    providerInput: buildPromptProviderInput(hydratedMetaPrompt, uniqueness),
  }
}
