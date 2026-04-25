import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { parseJsonc } from './jsonc.js'
import type { GenerationConfig, GenerationProfile, LoadedProject, OutputConfig, ParameterCatalog, ProjectConfig } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string at ${path}.`)
  }

  return value
}

function parseGenerationProfile(value: unknown, path: string): GenerationProfile {
  if (!isRecord(value)) {
    throw new Error(`Expected object at ${path}.`)
  }

  const format = value.format
  if (format !== undefined && format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    throw new Error(`Unsupported image format at ${path}.format.`)
  }

  const background = value.background
  if (background !== undefined && background !== 'opaque' && background !== 'transparent') {
    throw new Error(`Unsupported image background at ${path}.background.`)
  }

  const quality = value.quality
  if (quality !== undefined && quality !== 'low' && quality !== 'medium' && quality !== 'high' && quality !== 'auto') {
    throw new Error(`Unsupported image quality at ${path}.quality.`)
  }

  if (value.options !== undefined && !isRecord(value.options)) {
    throw new Error(`Expected object at ${path}.options.`)
  }

  return {
    provider: expectString(value.provider, `${path}.provider`),
    promptModel: typeof value.promptModel === 'string' ? value.promptModel : undefined,
    imageModel: typeof value.imageModel === 'string' ? value.imageModel : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    format,
    size: typeof value.size === 'string' ? value.size : undefined,
    background,
    quality,
    options: value.options as Record<string, unknown> | undefined,
  }
}

function parseGenerationConfig(value: unknown, path: string): GenerationConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`Expected object at ${path}.`)
  }

  const profilesValue = value.profiles
  if (profilesValue !== undefined && !isRecord(profilesValue)) {
    throw new Error(`Expected object at ${path}.profiles.`)
  }

  const profiles =
    profilesValue === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(profilesValue).map(([name, profile]) => [
            name,
            parseGenerationProfile(profile, `${path}.profiles.${name}`),
          ]),
        )

  return {
    defaultProfile: typeof value.defaultProfile === 'string' ? value.defaultProfile : undefined,
    profiles,
  }
}

function parseOutputConfig(value: unknown, path: string): OutputConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`Expected object at ${path}.`)
  }

  return {
    dir: expectString(value.dir, `${path}.dir`),
  }
}

function parseProjectConfig(value: unknown, filePath: string): ProjectConfig {
  if (!isRecord(value)) {
    throw new Error(`Expected object in ${filePath}.`)
  }

  const uniquenessValue = value.uniqueness
  if (uniquenessValue !== undefined && !isRecord(uniquenessValue)) {
    throw new Error(`Expected object at ${filePath}:uniqueness.`)
  }

  const lookback = uniquenessValue?.lookback
  if (lookback !== undefined && (typeof lookback !== 'number' || !Number.isInteger(lookback) || lookback < 0)) {
    throw new Error(`Expected non-negative integer at ${filePath}:uniqueness.lookback.`)
  }

  const enabled = uniquenessValue?.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error(`Expected boolean at ${filePath}:uniqueness.enabled.`)
  }

  return {
    id: expectString(value.id, `${filePath}:id`),
    metaPromptFile: expectString(value.metaPromptFile, `${filePath}:metaPromptFile`),
    parameterCatalogFile:
      value.parameterCatalogFile === undefined
        ? undefined
        : expectString(value.parameterCatalogFile, `${filePath}:parameterCatalogFile`),
    output: parseOutputConfig(value.output, `${filePath}:output`),
    generation: parseGenerationConfig(value.generation, `${filePath}:generation`),
    uniqueness: uniquenessValue === undefined ? undefined : { enabled, lookback },
  }
}

function parseParameterCatalog(value: unknown, filePath: string): ParameterCatalog {
  if (!isRecord(value)) {
    throw new Error(`Expected object in ${filePath}.`)
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (!Array.isArray(entry) || entry.some(item => typeof item !== 'string' || item.trim().length === 0)) {
        throw new Error(`Expected non-empty string array at ${filePath}:${key}.`)
      }

      return [key, entry]
    }),
  )
}

function resolveConfigFile(pathValue: string, defaultFileName: string): string {
  return pathValue.endsWith('.json') || pathValue.endsWith('.jsonc') ? pathValue : resolve(pathValue, defaultFileName)
}

export async function loadProject(projectPath: string): Promise<LoadedProject> {
  const filePath = resolveConfigFile(resolve(projectPath), 'project.jsonc')
  const dirPath = dirname(filePath)
  const raw = await readFile(filePath, 'utf8')
  const config = parseProjectConfig(parseJsonc<unknown>(raw, filePath), filePath)
  const metaPrompt = await readFile(resolve(dirPath, config.metaPromptFile), 'utf8')
  const parameterCatalog =
    config.parameterCatalogFile === undefined
      ? undefined
      : parseParameterCatalog(
          parseJsonc<unknown>(
            await readFile(resolve(dirPath, config.parameterCatalogFile), 'utf8'),
            resolve(dirPath, config.parameterCatalogFile),
          ),
          resolve(dirPath, config.parameterCatalogFile),
        )

  return {
    filePath,
    dirPath,
    outputDir: resolve(dirPath, config.output?.dir ?? './artifacts'),
    config,
    metaPrompt,
    parameterCatalog,
  }
}
