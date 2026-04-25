import type {
  GenerationProfile,
  GenerationProfileOverrides,
  ProjectConfig,
  ResolvedGenerationProfile,
} from './types.js'

const DEFAULT_PROVIDER = 'gemini'
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
const DEFAULT_OPENAI_PROMPT_MODEL = 'gpt-5'
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1'

function profileDefaults(provider: string): Required<Pick<ResolvedGenerationProfile, 'promptModel' | 'imageModel' | 'format'>> {
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
    gemini: {
      provider: DEFAULT_PROVIDER,
      imageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      promptModel: DEFAULT_GEMINI_IMAGE_MODEL,
      format: 'png',
    },
  }
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
    const matchingProfileName = Object.entries(profiles).find(([, profile]) => profile.provider === overrides.provider)?.[0]
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

export function resolveGenerationProfile(
  config: ProjectConfig,
  overrides?: GenerationProfileOverrides,
): ResolvedGenerationProfile {
  const profiles = getProfiles(config)
  const profileName = selectProfileName(config, profiles, overrides)
  const base = profiles[profileName] ?? { provider: DEFAULT_PROVIDER }
  const provider = overrides?.provider ?? base.provider
  const defaults = profileDefaults(provider)
  const model = overrides?.model ?? base.model

  return {
    name: profileName,
    provider,
    promptModel: overrides?.promptModel ?? model ?? base.promptModel ?? defaults.promptModel,
    imageModel: overrides?.imageModel ?? model ?? base.imageModel ?? defaults.imageModel,
    format: overrides?.format ?? base.format ?? defaults.format,
    size: overrides?.size ?? base.size,
    background: overrides?.background ?? base.background,
    quality: overrides?.quality ?? base.quality,
    options: base.options ?? {},
  }
}
