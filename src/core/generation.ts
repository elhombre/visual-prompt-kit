import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createArtifactDirectory, getArtifactSlug } from './artifacts.js'
import { createRunManifest } from './manifest.js'
import { preparePromptGeneration } from './prepare.js'
import { resolveGenerationProfile } from './profiles.js'
import type {
  GeneratedImage,
  ResolvedGenerationProfile,
  RunManifest,
  RenderRetryEvent,
  RunImageGenerationFromPromptInput,
  RunStatus,
  RunVisualBatchInput,
  RunVisualGenerationInput,
  VisualBatchResult,
  VisualGenerationProvider,
  VisualGenerationRunResult,
} from './types.js'

const DEFAULT_RENDER_ATTEMPTS = 3
const DEFAULT_RENDER_RETRY_DELAY_MS = 2000

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return resolved
}

function imageExtension(format: string): string {
  return format === 'jpeg' ? 'jpeg' : format
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new Error(`${name} must be a non-negative integer.`)
  }
  return resolved
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return
  }

  await new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeManifest(directoryPath: string, manifest: RunManifest): Promise<void> {
  await writeFile(resolve(directoryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function generateImageWithAttempts(input: {
  provider: VisualGenerationProvider
  model: string
  prompt: string
  profile: ResolvedGenerationProfile
  imageIndex: number
  providerName: string
  renderAttempts: number
  renderRetryDelayMs: number
  onRetry?: (event: RenderRetryEvent) => void
  providerOptions: Record<string, unknown>
  credentials?: unknown
  proxyUrl?: string
}): Promise<GeneratedImage> {
  let lastError: unknown

  for (let attempt = 1; attempt <= input.renderAttempts; attempt += 1) {
    try {
      const result = await input.provider.generateImages({
        model: input.model,
        prompt: input.prompt,
        profile: input.profile,
        providerOptions: input.providerOptions,
        imageCount: 1,
        format: input.profile.format,
        size: input.profile.size,
        background: input.profile.background,
        quality: input.profile.quality,
        credentials: input.credentials,
        proxyUrl: input.proxyUrl,
      })

      const first = result.images[0]
      if (!first) {
        throw new Error('Provider returned no image data.')
      }

      return first
    } catch (error) {
      lastError = error
      if (attempt < input.renderAttempts) {
        input.onRetry?.({
          stage: 'image',
          provider: input.providerName,
          attempt,
          attempts: input.renderAttempts,
          retryDelayMs: input.renderRetryDelayMs,
          errorMessage: getErrorMessage(error),
          imageIndex: input.imageIndex,
        })
        await sleep(input.renderRetryDelayMs)
      }
    }
  }

  const detail = getErrorMessage(lastError)
  throw new Error(`Image ${input.imageIndex + 1} failed after ${input.renderAttempts} attempt(s). ${detail}`)
}

async function generatePromptWithAttempts(input: {
  provider: VisualGenerationProvider
  model: string
  providerInput: string
  profile: ResolvedGenerationProfile
  providerName: string
  attempts: number
  retryDelayMs: number
  onRetry?: (event: RenderRetryEvent) => void
  providerOptions: Record<string, unknown>
  credentials?: unknown
  proxyUrl?: string
}): Promise<string> {
  let lastError: unknown

  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    try {
      const result = await input.provider.generatePrompt({
        model: input.model,
        input: input.providerInput,
        profile: input.profile,
        providerOptions: input.providerOptions,
        credentials: input.credentials,
        proxyUrl: input.proxyUrl,
      })

      return result.prompt.trim()
    } catch (error) {
      lastError = error
      if (attempt < input.attempts) {
        input.onRetry?.({
          stage: 'prompt',
          provider: input.providerName,
          attempt,
          attempts: input.attempts,
          retryDelayMs: input.retryDelayMs,
          errorMessage: getErrorMessage(error),
        })
        await sleep(input.retryDelayMs)
      }
    }
  }

  const detail = getErrorMessage(lastError)
  throw new Error(`Prompt generation failed after ${input.attempts} attempt(s). ${detail}`)
}

export async function runVisualGeneration(input: RunVisualGenerationInput): Promise<VisualGenerationRunResult> {
  const imagesPerArtifact = positiveInteger(input.imagesPerArtifact, 1, 'imagesPerArtifact')
  const prepared = await preparePromptGeneration({
    projectPath: input.projectPath,
    artifactRootDir: input.artifactRootDir,
    overrides: input.parameterOverrides,
    unique: input.unique,
    uniqueLookback: input.uniqueLookback,
  })
  const profile = resolveGenerationProfile(prepared.project.config, input.profileOverrides)
  const promptProvider = input.providers[profile.prompt.provider]
  const imageProvider = input.providers[profile.image.provider]

  if (!promptProvider) {
    throw new Error(`Unsupported prompt provider "${profile.prompt.provider}".`)
  }

  if (input.command === 'render' && !imageProvider) {
    throw new Error(`Unsupported image provider "${profile.image.provider}".`)
  }

  const createdAt = new Date()
  const slug = getArtifactSlug(input.name, prepared.resolved.params, prepared.project.config.id)
  const artifact = await createArtifactDirectory(input.artifactRootDir ?? prepared.project.outputDir, createdAt, slug)
  const requestedImages = input.command === 'render' ? imagesPerArtifact : 0
  const renderAttempts = positiveInteger(
    input.renderAttempts ?? prepared.project.config.generation?.renderAttempts,
    DEFAULT_RENDER_ATTEMPTS,
    'renderAttempts',
  )
  const renderRetryDelayMs = nonNegativeInteger(
    input.renderRetryDelayMs ?? prepared.project.config.generation?.renderRetryDelayMs,
    DEFAULT_RENDER_RETRY_DELAY_MS,
    'renderRetryDelayMs',
  )

  let resolvedPrompt = ''

  try {
    resolvedPrompt = await generatePromptWithAttempts({
      provider: promptProvider,
      model: profile.prompt.model,
      providerInput: prepared.providerInput,
      profile,
      providerName: profile.prompt.provider,
      attempts: input.command === 'render' ? renderAttempts : 1,
      retryDelayMs: renderRetryDelayMs,
      onRetry: input.onRetry,
      providerOptions: profile.prompt.options,
      credentials: input.credentials?.[profile.prompt.provider],
      proxyUrl: input.proxyUrl,
    })
  } catch (error) {
    const message = getErrorMessage(error)
    const manifest = createRunManifest({
      projectId: prepared.project.config.id,
      command: input.command,
      createdAt,
      params: prepared.resolved.params,
      randomlySelected: prepared.resolved.randomlySelected,
      resolvedPrompt,
      profile,
      uniquenessApplied: prepared.uniqueness.applied,
      uniquenessLookback: prepared.uniqueness.lookback,
      uniquenessSources: prepared.uniqueness.sources,
      files: {},
      requestedImages,
      generatedImages: 0,
      status: 'prompt-generation-failed',
      errorMessage: message,
    })
    await writeManifest(artifact.directoryPath, manifest)
    throw error
  }

  const promptFileName = 'prompt.txt'
  await writeFile(resolve(artifact.directoryPath, promptFileName), `${resolvedPrompt}\n`, 'utf8')

  if (input.command === 'prompt') {
    const manifest = createRunManifest({
      projectId: prepared.project.config.id,
      command: 'prompt',
      createdAt,
      params: prepared.resolved.params,
      randomlySelected: prepared.resolved.randomlySelected,
      resolvedPrompt,
      profile,
      uniquenessApplied: prepared.uniqueness.applied,
      uniquenessLookback: prepared.uniqueness.lookback,
      uniquenessSources: prepared.uniqueness.sources,
      files: {
        prompt: promptFileName,
      },
      requestedImages: 0,
      generatedImages: 0,
    })
    await writeManifest(artifact.directoryPath, manifest)
    return {
      artifactDirectory: artifact.directoryPath,
      artifactDirectoryName: artifact.directoryName,
      manifest,
    }
  }

  const imageFiles: string[] = []
  let images: GeneratedImage[] = []
  let imageError: unknown

  try {
    for (let imageIndex = 0; imageIndex < imagesPerArtifact; imageIndex += 1) {
      images.push(
        await generateImageWithAttempts({
          provider: imageProvider,
          model: profile.image.model,
          prompt: resolvedPrompt,
          profile,
          imageIndex,
          providerName: profile.image.provider,
          renderAttempts,
          renderRetryDelayMs,
          onRetry: input.onRetry,
          providerOptions: profile.image.options,
          credentials: input.credentials?.[profile.image.provider],
          proxyUrl: input.proxyUrl,
        }),
      )
    }
  } catch (error) {
    imageError = error
  }

  for (const [index, image] of images.entries()) {
    const imageFileName = `image-${index + 1}.${imageExtension(image.format)}`
    await writeFile(resolve(artifact.directoryPath, imageFileName), Buffer.from(image.bytes))
    imageFiles.push(imageFileName)
  }

  let status: RunStatus = 'success'
  if (imageError) {
    status = imageFiles.length > 0 ? 'partial-success' : 'image-generation-failed'
  } else if (imageFiles.length < imagesPerArtifact) {
    status = imageFiles.length > 0 ? 'partial-success' : 'image-generation-failed'
    imageError = new Error(`Provider returned ${imageFiles.length} image(s), expected ${imagesPerArtifact}.`)
  }

  const manifest = createRunManifest({
    projectId: prepared.project.config.id,
    command: 'render',
    createdAt,
    params: prepared.resolved.params,
    randomlySelected: prepared.resolved.randomlySelected,
    resolvedPrompt,
    profile,
    format: profile.format,
    size: profile.size,
    background: profile.background,
    quality: profile.quality,
    uniquenessApplied: prepared.uniqueness.applied,
    uniquenessLookback: prepared.uniqueness.lookback,
    uniquenessSources: prepared.uniqueness.sources,
    files: {
      prompt: promptFileName,
      images: imageFiles,
    },
    requestedImages: imagesPerArtifact,
    generatedImages: imageFiles.length,
    status,
    errorMessage: imageError === undefined ? undefined : getErrorMessage(imageError),
  })
  await writeManifest(artifact.directoryPath, manifest)

  if (imageError) {
    throw imageError
  }

  return {
    artifactDirectory: artifact.directoryPath,
    artifactDirectoryName: artifact.directoryName,
    manifest,
  }
}

export async function runImageGenerationFromPrompt(
  input: RunImageGenerationFromPromptInput,
): Promise<VisualGenerationRunResult> {
  const resolvedPrompt = input.prompt.trim()
  if (resolvedPrompt.length === 0) {
    throw new Error('prompt must not be empty.')
  }

  const imagesPerArtifact = positiveInteger(input.imagesPerArtifact, 1, 'imagesPerArtifact')
  const prepared = await preparePromptGeneration({
    projectPath: input.projectPath,
    artifactRootDir: input.artifactRootDir,
    overrides: input.parameterOverrides,
  })
  const profile = resolveGenerationProfile(prepared.project.config, input.profileOverrides)
  const imageProvider = input.providers[profile.image.provider]

  if (!imageProvider) {
    throw new Error(`Unsupported image provider "${profile.image.provider}".`)
  }

  const createdAt = new Date()
  const slug = getArtifactSlug(input.name, prepared.resolved.params, prepared.project.config.id)
  const artifact = await createArtifactDirectory(input.artifactRootDir ?? prepared.project.outputDir, createdAt, slug)
  const renderAttempts = positiveInteger(
    input.renderAttempts ?? prepared.project.config.generation?.renderAttempts,
    DEFAULT_RENDER_ATTEMPTS,
    'renderAttempts',
  )
  const renderRetryDelayMs = nonNegativeInteger(
    input.renderRetryDelayMs ?? prepared.project.config.generation?.renderRetryDelayMs,
    DEFAULT_RENDER_RETRY_DELAY_MS,
    'renderRetryDelayMs',
  )

  const promptFileName = 'prompt.txt'
  await writeFile(resolve(artifact.directoryPath, promptFileName), `${resolvedPrompt}\n`, 'utf8')

  const imageFiles: string[] = []
  let images: GeneratedImage[] = []
  let imageError: unknown

  try {
    for (let imageIndex = 0; imageIndex < imagesPerArtifact; imageIndex += 1) {
      images.push(
        await generateImageWithAttempts({
          provider: imageProvider,
          model: profile.image.model,
          prompt: resolvedPrompt,
          profile,
          imageIndex,
          providerName: profile.image.provider,
          renderAttempts,
          renderRetryDelayMs,
          onRetry: input.onRetry,
          providerOptions: profile.image.options,
          credentials: input.credentials?.[profile.image.provider],
          proxyUrl: input.proxyUrl,
        }),
      )
    }
  } catch (error) {
    imageError = error
  }

  for (const [index, image] of images.entries()) {
    const imageFileName = `image-${index + 1}.${imageExtension(image.format)}`
    await writeFile(resolve(artifact.directoryPath, imageFileName), Buffer.from(image.bytes))
    imageFiles.push(imageFileName)
  }

  let status: RunStatus = 'success'
  if (imageError) {
    status = imageFiles.length > 0 ? 'partial-success' : 'image-generation-failed'
  } else if (imageFiles.length < imagesPerArtifact) {
    status = imageFiles.length > 0 ? 'partial-success' : 'image-generation-failed'
    imageError = new Error(`Provider returned ${imageFiles.length} image(s), expected ${imagesPerArtifact}.`)
  }

  const manifest = createRunManifest({
    projectId: prepared.project.config.id,
    command: 'render',
    createdAt,
    params: prepared.resolved.params,
    randomlySelected: prepared.resolved.randomlySelected,
    resolvedPrompt,
    profile,
    format: profile.format,
    size: profile.size,
    background: profile.background,
    quality: profile.quality,
    uniquenessApplied: false,
    uniquenessLookback: 0,
    uniquenessSources: [],
    files: {
      prompt: promptFileName,
      images: imageFiles,
    },
    requestedImages: imagesPerArtifact,
    generatedImages: imageFiles.length,
    status,
    errorMessage: imageError === undefined ? undefined : getErrorMessage(imageError),
  })
  await writeManifest(artifact.directoryPath, manifest)

  if (imageError) {
    throw imageError
  }

  return {
    artifactDirectory: artifact.directoryPath,
    artifactDirectoryName: artifact.directoryName,
    manifest,
  }
}

export async function runVisualBatch(input: RunVisualBatchInput): Promise<VisualBatchResult> {
  const artifactCount = positiveInteger(input.artifactCount, 1, 'artifactCount')
  const runs: VisualGenerationRunResult[] = []
  const errors: VisualBatchResult['errors'] = []
  const { artifactCount: _artifactCount, continueOnError: _continueOnError, ...singleInput } = input

  for (let index = 0; index < artifactCount; index += 1) {
    try {
      runs.push(
        await runVisualGeneration({
          ...singleInput,
          onRetry: event => {
            input.onRetry?.({
              ...event,
              artifactIndex: index,
              artifactCount,
            })
          },
        }),
      )
    } catch (error) {
      const message = getErrorMessage(error)
      errors.push({ index, message })
      if (!input.continueOnError) {
        throw error
      }
    }
  }

  return { runs, errors }
}
