import type {
  GenerationProfile,
  GenerationProfileOverrides,
  ProjectConfig,
  ResolvedGenerationProvider,
  ResolvedGenerationProfile,
} from './types.js'

const DEFAULT_PROVIDER = 'gemini'
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
const DEFAULT_OPENAI_PROMPT_MODEL = 'gpt-5'
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1'

function profileDefaults(provider: string): { promptModel: string; imageModel: string; format: 'png' } {
  if (provider === 'openai') {
    return {
      promptModel: DEFAULT_OPENAI_PROMPT_MODEL,
      imageModel: DEFAULT_OPENAI_IMAGE_MODEL,
      format: 'png',
    }
  }

  return {
    promptModel: DEFAULT_GEMINI_IMAGE_MODEL,
    imageModel: DEFAULT_GEMINI_IMAGE_MODEL,
    format: 'png',
  }
}

function getProfiles(config: ProjectConfig): Record<string, GenerationProfile> {
  return config.generation?.profiles ?? {
    default: {
      prompt: {
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_GEMINI_IMAGE_MODEL,
      },
      image: {
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_GEMINI_IMAGE_MODEL,
      },
      format: 'png',
    },
  }
}

function profileUsesProvider(profile: GenerationProfile, provider: string): boolean {
  return profile.provider === provider || profile.prompt?.provider === provider || profile.image?.provider === provider
}

function selectProfileName(
  config: ProjectConfig,
  profiles: Record<string, GenerationProfile>,
  overrides?: GenerationProfileOverrides,
): string {
  if (overrides?.profileName) {
    if (!profiles[overrides.profileName]) {
      throw new Error(`Unknown generation profile "${overrides.profileName}".`)
    }
    return overrides.profileName
  }

  if (overrides?.provider) {
    const matchingProfileName = Object.entries(profiles).find(([, profile]) =>
      profileUsesProvider(profile, overrides.provider ?? ''),
    )?.[0]
    if (matchingProfileName) {
      return matchingProfileName
    }
  }

  const defaultProfile = config.generation?.defaultProfile
  if (defaultProfile) {
    if (!profiles[defaultProfile]) {
      throw new Error(`Default generation profile "${defaultProfile}" is not defined.`)
    }
    return defaultProfile
  }

  return Object.keys(profiles)[0] ?? 'gemini'
}

function mergeOptions(
  globalOptions: Record<string, unknown> | undefined,
  stageOptions: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...(globalOptions ?? {}),
    ...(stageOptions ?? {}),
  }
}

function resolveStage(input: {
  stage: 'prompt' | 'image'
  base: GenerationProfile
  providerOverride?: string
  sharedProviderOverride?: string
  modelOverride?: string
  sharedModelOverride?: string
}): ResolvedGenerationProvider {
  const stageProfile = input.base[input.stage]
  const legacyModel = input.stage === 'prompt' ? input.base.promptModel : input.base.imageModel
  const provider = input.providerOverride ?? input.sharedProviderOverride ?? stageProfile?.provider ?? input.base.provider ?? DEFAULT_PROVIDER
  const defaults = profileDefaults(provider)
  const defaultModel = input.stage === 'prompt' ? defaults.promptModel : defaults.imageModel

  return {
    provider,
    model: input.modelOverride ?? input.sharedModelOverride ?? stageProfile?.model ?? legacyModel ?? input.base.model ?? defaultModel,
    options: mergeOptions(input.base.options, stageProfile?.options),
  }
}

export function resolveGenerationProfile(
  config: ProjectConfig,
  overrides?: GenerationProfileOverrides,
): ResolvedGenerationProfile {
  const profiles = getProfiles(config)
  const profileName = selectProfileName(config, profiles, overrides)
  const base = profiles[profileName] ?? { provider: DEFAULT_PROVIDER }
  const prompt = resolveStage({
    stage: 'prompt',
    base,
    providerOverride: overrides?.promptProvider,
    sharedProviderOverride: overrides?.provider,
    modelOverride: overrides?.promptModel,
    sharedModelOverride: overrides?.model,
  })
  const image = resolveStage({
    stage: 'image',
    base,
    providerOverride: overrides?.imageProvider,
    sharedProviderOverride: overrides?.provider,
    modelOverride: overrides?.imageModel,
    sharedModelOverride: overrides?.model,
  })
  const provider = prompt.provider === image.provider ? prompt.provider : `${prompt.provider}/${image.provider}`
  const promptModel = prompt.model
  const imageModel = image.model
  const defaults = profileDefaults(image.provider)

  return {
    name: profileName,
    provider,
    prompt,
    image,
    promptModel,
    imageModel,
    format: overrides?.format ?? base.format ?? defaults.format,
    size: overrides?.size ?? base.size,
    background: overrides?.background ?? base.background,
    quality: overrides?.quality ?? base.quality,
    options: base.options ?? {},
  }
}
