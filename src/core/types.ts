export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type ImageBackground = 'opaque' | 'transparent'
export type PromptCommand = 'prompt' | 'render'
export type RunStatus = 'success' | 'partial-success' | 'prompt-generation-failed' | 'image-generation-failed'

export interface LoadedProject {
  filePath: string
  dirPath: string
  outputDir: string
  config: ProjectConfig
  metaPrompt: string
  parameterCatalog?: ParameterCatalog
}

export interface ProjectConfig {
  id: string
  metaPromptFile: string
  parameterCatalogFile?: string
  output?: OutputConfig
  generation?: GenerationConfig
  uniqueness?: UniquenessDefaults
}

export interface OutputConfig {
  dir: string
}

export interface GenerationConfig {
  renderAttempts?: number
  renderRetryDelayMs?: number
  defaultProfile?: string
  profiles?: Record<string, GenerationProfile>
}

export interface GenerationProfile {
  provider: string
  promptModel?: string
  imageModel?: string
  model?: string
  format?: ImageFormat
  size?: string
  background?: ImageBackground
  quality?: 'low' | 'medium' | 'high' | 'auto'
  options?: Record<string, unknown>
}

export interface ResolvedGenerationProfile extends Required<Pick<GenerationProfile, 'provider'>> {
  name: string
  promptModel: string
  imageModel: string
  format: ImageFormat
  size?: string
  background?: ImageBackground
  quality?: 'low' | 'medium' | 'high' | 'auto'
  options: Record<string, unknown>
}

export interface GenerationProfileOverrides {
  profileName?: string
  provider?: string
  model?: string
  promptModel?: string
  imageModel?: string
  format?: ImageFormat
  size?: string
  background?: ImageBackground
  quality?: 'low' | 'medium' | 'high' | 'auto'
}

export interface ParameterCatalog {
  [parameterName: string]: string[]
}

export interface UniquenessDefaults {
  enabled?: boolean
  lookback?: number
}

export interface ResolvedPromptContext {
  params: Record<string, string>
  randomlySelected: string[]
}

export interface ArtifactFileMap {
  prompt?: string
  images?: string[]
}

export interface RunManifest {
  projectId: string
  command: PromptCommand
  createdAt: string
  params: Record<string, string>
  randomlySelected: string[]
  resolvedPrompt: string
  provider: {
    profile: string
    name: string
    promptModel: string
    imageModel?: string
    format?: ImageFormat
    size?: string
    background?: ImageBackground
    quality?: string
  }
  uniqueness: {
    applied: boolean
    lookback: number
    sources: string[]
  }
  files: ArtifactFileMap
  requestedImages: number
  generatedImages: number
  status: RunStatus
  error?: {
    message: string
  }
}

export interface ArtifactManifestRecord {
  manifestPath: string
  directoryPath: string
  directoryName: string
  manifest: RunManifest
}

export interface PromptUniquenessResult {
  applied: boolean
  lookback: number
  sources: string[]
  augmentation?: string
}

export interface PreparePromptGenerationInput {
  projectPath: string
  artifactRootDir?: string
  overrides?: Record<string, string>
  unique?: boolean
  uniqueLookback?: number
}

export interface PreparedPromptGeneration {
  project: LoadedProject
  resolved: ResolvedPromptContext
  hydratedMetaPrompt: string
  uniqueness: PromptUniquenessResult
  providerInput: string
}

export interface PromptProviderRequest {
  model: string
  input: string
  profile: ResolvedGenerationProfile
  credentials?: unknown
  proxyUrl?: string
}

export interface PromptProviderResult {
  prompt: string
}

export interface ImageProviderRequest {
  model: string
  prompt: string
  profile: ResolvedGenerationProfile
  imageCount: number
  format?: ImageFormat
  size?: string
  background?: ImageBackground
  quality?: 'low' | 'medium' | 'high' | 'auto'
  credentials?: unknown
  proxyUrl?: string
}

export interface GeneratedImage {
  bytes: Uint8Array
  format: ImageFormat
  revisedPrompt?: string
}

export interface ImageProviderResult {
  images: GeneratedImage[]
}

export interface VisualGenerationProvider {
  name: string
  generatePrompt(input: PromptProviderRequest): Promise<PromptProviderResult>
  generateImages(input: ImageProviderRequest): Promise<ImageProviderResult>
}

export type ProviderRegistry = Record<string, VisualGenerationProvider>

export interface RenderRetryEvent {
  stage: 'prompt' | 'image'
  attempt: number
  attempts: number
  retryDelayMs: number
  errorMessage: string
  imageIndex?: number
  artifactIndex?: number
  artifactCount?: number
}

export interface RunVisualGenerationInput {
  command: PromptCommand
  projectPath: string
  artifactRootDir?: string
  parameterOverrides?: Record<string, string>
  profileOverrides?: GenerationProfileOverrides
  providers: ProviderRegistry
  credentials?: Record<string, unknown>
  proxyUrl?: string
  unique?: boolean
  uniqueLookback?: number
  name?: string
  imagesPerArtifact?: number
  renderAttempts?: number
  renderRetryDelayMs?: number
  onRetry?: (event: RenderRetryEvent) => void
}

export interface VisualGenerationRunResult {
  artifactDirectory: string
  artifactDirectoryName: string
  manifest: RunManifest
}

export interface RunVisualBatchInput extends RunVisualGenerationInput {
  artifactCount?: number
  continueOnError?: boolean
}

export interface VisualBatchResult {
  runs: VisualGenerationRunResult[]
  errors: Array<{
    index: number
    message: string
  }>
}
