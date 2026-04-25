import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createArtifactDirectory, getArtifactSlug } from './artifacts.js'
import { createRunManifest } from './manifest.js'
import { preparePromptGeneration } from './prepare.js'
import { resolveGenerationProfile } from './profiles.js'
import type {
  GeneratedImage,
  RunManifest,
  RunStatus,
  RunVisualBatchInput,
  RunVisualGenerationInput,
  VisualBatchResult,
  VisualGenerationRunResult,
} from './types.js'

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

async function writeManifest(directoryPath: string, manifest: RunManifest): Promise<void> {
  await writeFile(resolve(directoryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function runVisualGeneration(input: RunVisualGenerationInput): Promise<VisualGenerationRunResult> {
  const imagesPerArtifact = positiveInteger(input.imagesPerArtifact, 1, 'imagesPerArtifact')
  const prepared = await preparePromptGeneration({
    projectPath: input.projectPath,
    overrides: input.parameterOverrides,
    unique: input.unique,
    uniqueLookback: input.uniqueLookback,
  })
  const profile = resolveGenerationProfile(prepared.project.config, input.profileOverrides)
  const provider = input.providers[profile.provider]

  if (!provider) {
    throw new Error(`Unsupported provider "${profile.provider}".`)
  }

  const createdAt = new Date()
  const slug = getArtifactSlug(input.name, prepared.resolved.params, prepared.project.config.id)
  const artifact = await createArtifactDirectory(prepared.project.artifactsDir, createdAt, slug)
  const requestedImages = input.command === 'render' ? imagesPerArtifact : 0

  let resolvedPrompt = ''

  try {
    const promptResult = await provider.generatePrompt({
      model: profile.promptModel,
      input: prepared.providerInput,
      profile,
      credentials: input.credentials?.[profile.provider],
      proxyUrl: input.proxyUrl,
    })
    resolvedPrompt = promptResult.prompt.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
    const imageResult = await provider.generateImages({
      model: profile.imageModel,
      prompt: resolvedPrompt,
      profile,
      imageCount: imagesPerArtifact,
      format: profile.format,
      size: profile.size,
      background: profile.background,
      quality: profile.quality,
      credentials: input.credentials?.[profile.provider],
      proxyUrl: input.proxyUrl,
    })
    images = imageResult.images
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
    errorMessage: imageError instanceof Error ? imageError.message : imageError === undefined ? undefined : String(imageError),
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
      runs.push(await runVisualGeneration(singleInput))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ index, message })
      if (!input.continueOnError) {
        throw error
      }
    }
  }

  return { runs, errors }
}
