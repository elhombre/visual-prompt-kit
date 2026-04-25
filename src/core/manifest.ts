import type {
  ArtifactFileMap,
  ImageBackground,
  ImageFormat,
  PromptCommand,
  ResolvedGenerationProfile,
  RunManifest,
  RunStatus,
} from './types.js'

export function createRunManifest(input: {
  projectId: string
  command: PromptCommand
  createdAt: Date
  params: Record<string, string>
  randomlySelected: string[]
  resolvedPrompt: string
  profile: ResolvedGenerationProfile
  format?: ImageFormat
  size?: string
  background?: ImageBackground
  quality?: string
  uniquenessApplied: boolean
  uniquenessLookback: number
  uniquenessSources: string[]
  files: ArtifactFileMap
  requestedImages: number
  generatedImages: number
  status?: RunStatus
  errorMessage?: string
}): RunManifest {
  return {
    projectId: input.projectId,
    command: input.command,
    createdAt: input.createdAt.toISOString(),
    params: input.params,
    randomlySelected: input.randomlySelected,
    resolvedPrompt: input.resolvedPrompt,
    provider: {
      profile: input.profile.name,
      name: input.profile.provider,
      promptModel: input.profile.promptModel,
      imageModel: input.command === 'render' ? input.profile.imageModel : undefined,
      format: input.format,
      size: input.size,
      background: input.background,
      quality: input.quality,
    },
    uniqueness: {
      applied: input.uniquenessApplied,
      lookback: input.uniquenessLookback,
      sources: input.uniquenessSources,
    },
    files: input.files,
    requestedImages: input.requestedImages,
    generatedImages: input.generatedImages,
    status: input.status ?? 'success',
    error: input.errorMessage ? { message: input.errorMessage } : undefined,
  }
}
