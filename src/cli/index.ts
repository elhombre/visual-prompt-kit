import { access, constants } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { config as loadEnv } from 'dotenv'

import {
  loadProject,
  resolveGenerationProfile,
  runVisualBatch,
  type GenerationProfileOverrides,
  type RenderRetryEvent,
} from '../core/index.js'
import { createDefaultProviders, getProxyUrlFromEnv } from '../providers/index.js'

interface CliOptions {
  command: string
  project?: string
  profile?: string
  provider?: string
  name?: string
  unique: boolean
  uniqueLookback?: number
  output?: string
  format?: 'png' | 'jpeg' | 'webp'
  size?: string
  background?: 'opaque' | 'transparent'
  quality?: 'low' | 'medium' | 'high' | 'auto'
  model?: string
  promptModel?: string
  imageModel?: string
  count?: number
  images?: number
  renderAttempts?: number
  renderRetryDelayMs?: number
  continueOnError: boolean
  sets: Record<string, string>
}

function printUsage(): void {
  process.stdout.write(`vpk <prompt|render> --project <path> [options]

Options:
  --project <path>             Path to project directory or project.jsonc
  --profile <name>             Generation profile from project.jsonc
  --provider <name>            Provider override, for example gemini or openai
  --set <key=value>            Override one prompt parameter
  --name <slug>                Override artifact slug source
  --output <dir>               Artifact root directory, default current working directory
  --count <n>                  Create n independent artifact directories, default 1
  --images <n>                 Generate n images per render artifact, default 1
  --render-attempts <n>        Attempts per render request, default project config or 3
  --render-retry-delay-ms <n>  Delay between render retry attempts, default project config or 2000
  --continue-on-error          Continue batch runs after a failed artifact
  --unique                     Enable artifact-based uniqueness checks
  --unique-lookback <n>        Number of prior artifact manifests to inspect
  --format <png|jpeg|webp>     Output image format
  --size <value>               Override image size
  --background <opaque|transparent>
  --quality <low|medium|high|auto>
  --model <name>               Override both prompt and image model
  --prompt-model <name>        Override prompt generation model
  --image-model <name>         Override image generation model
  --help, -h                   Show this help
`)
}

function parsePositiveInteger(value: string | undefined, optionName: string): number {
  const number = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Expected a positive integer after ${optionName}.`)
  }
  return number
}

function parseNonNegativeInteger(value: string | undefined, optionName: string): number {
  const number = Number.parseInt(value ?? '', 10)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Expected a non-negative integer after ${optionName}.`)
  }
  return number
}

function requireValue(argv: string[], index: number, optionName: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`${optionName} requires a value.`)
  }
  return value
}

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] === '--help' || argv[0] === '-h') {
    printUsage()
    process.exit(0)
  }

  const options: CliOptions = {
    command: argv[0] ?? '',
    unique: false,
    continueOnError: false,
    sets: {},
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case '--project':
        options.project = requireValue(argv, index, arg)
        index += 1
        break
      case '--profile':
        options.profile = requireValue(argv, index, arg)
        index += 1
        break
      case '--provider':
        options.provider = requireValue(argv, index, arg)
        index += 1
        break
      case '--set': {
        const value = requireValue(argv, index, arg)
        index += 1
        const delimiterIndex = value.indexOf('=')
        if (delimiterIndex <= 0) {
          throw new Error(`Invalid --set value "${value}". Expected key=value.`)
        }

        options.sets[value.slice(0, delimiterIndex)] = value.slice(delimiterIndex + 1)
        break
      }
      case '--name':
        options.name = requireValue(argv, index, arg)
        index += 1
        break
      case '--output':
        options.output = requireValue(argv, index, arg)
        index += 1
        break
      case '--count':
        options.count = parsePositiveInteger(requireValue(argv, index, arg), arg)
        index += 1
        break
      case '--images':
        options.images = parsePositiveInteger(requireValue(argv, index, arg), arg)
        index += 1
        break
      case '--render-attempts':
        options.renderAttempts = parsePositiveInteger(requireValue(argv, index, arg), arg)
        index += 1
        break
      case '--render-retry-delay-ms':
        options.renderRetryDelayMs = parseNonNegativeInteger(requireValue(argv, index, arg), arg)
        index += 1
        break
      case '--continue-on-error':
        options.continueOnError = true
        break
      case '--unique':
        options.unique = true
        break
      case '--unique-lookback':
        options.uniqueLookback = parseNonNegativeInteger(requireValue(argv, index, arg), arg)
        index += 1
        break
      case '--format':
        options.format = requireValue(argv, index, arg) as CliOptions['format']
        index += 1
        break
      case '--size':
        options.size = requireValue(argv, index, arg)
        index += 1
        break
      case '--background':
        options.background = requireValue(argv, index, arg) as CliOptions['background']
        index += 1
        break
      case '--quality':
        options.quality = requireValue(argv, index, arg) as CliOptions['quality']
        index += 1
        break
      case '--model':
        options.model = requireValue(argv, index, arg)
        index += 1
        break
      case '--prompt-model':
        options.promptModel = requireValue(argv, index, arg)
        index += 1
        break
      case '--image-model':
        options.imageModel = requireValue(argv, index, arg)
        index += 1
        break
      case '--help':
      case '-h':
        printUsage()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function getInvocationCwd(): string {
  return process.env.INIT_CWD || process.cwd()
}

async function fileExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function collectDirectoryAncestors(startDir: string): string[] {
  const directories: string[] = []
  let current = resolve(startDir)

  while (true) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) {
      return directories
    }
    current = parent
  }
}

async function loadNearestEnvFile(invocationCwd: string): Promise<string | undefined> {
  for (const directory of collectDirectoryAncestors(invocationCwd)) {
    const envPath = resolve(directory, '.env')
    if (await fileExists(envPath)) {
      loadEnv({ path: envPath, quiet: true })
      return envPath
    }
  }

  return undefined
}

function buildCredentials(): Record<string, unknown> {
  return {
    gemini: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      vertexai: process.env.GOOGLE_GENAI_USE_VERTEXAI === undefined ? undefined : process.env.GOOGLE_GENAI_USE_VERTEXAI !== 'false',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    },
  }
}

function formatRetryMessage(event: RenderRetryEvent): string {
  const artifact =
    event.artifactIndex === undefined
      ? ''
      : `Artifact ${event.artifactIndex + 1}${event.artifactCount === undefined ? '' : `/${event.artifactCount}`}: `
  const stage = event.stage === 'image' ? `image ${(event.imageIndex ?? 0) + 1}` : 'prompt generation'
  const delay = event.retryDelayMs > 0 ? ` Waiting ${event.retryDelayMs}ms.` : ''
  const retry = artifact ? 'retrying' : 'Retrying'
  return `${artifact}${retry} ${stage} after attempt ${event.attempt}/${event.attempts} failed: ${event.errorMessage}.${delay}\n`
}

async function buildProfileOverrides(
  projectPath: string,
  options: CliOptions,
): Promise<GenerationProfileOverrides> {
  const base: GenerationProfileOverrides = {
    profileName: options.profile,
    provider: options.provider,
    model: options.model,
    promptModel: options.promptModel,
    imageModel: options.imageModel,
    format: options.format,
    size: options.size,
    background: options.background,
    quality: options.quality,
  }

  if (base.model || base.promptModel || base.imageModel) {
    return base
  }

  const project = await loadProject(projectPath)
  const resolved = resolveGenerationProfile(project.config, base)

  if (resolved.provider === 'openai') {
    return {
      ...base,
      promptModel: process.env.OPENAI_PROMPT_MODEL,
      imageModel: process.env.OPENAI_IMAGE_MODEL,
    }
  }

  return base
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.command !== 'prompt' && options.command !== 'render') {
    printUsage()
    process.exitCode = 1
    return
  }

  if (!options.project) {
    throw new Error('Missing required --project argument.')
  }

  const count = options.count ?? 1
  const images = options.images ?? 1

  const invocationCwd = getInvocationCwd()
  await loadNearestEnvFile(invocationCwd)
  const projectPath = resolve(invocationCwd, options.project)
  const artifactRootDir = resolve(invocationCwd, options.output ?? '.')
  const profileOverrides = await buildProfileOverrides(projectPath, options)

  const result = await runVisualBatch({
    command: options.command,
    projectPath,
    artifactRootDir,
    parameterOverrides: options.sets,
    profileOverrides,
    providers: createDefaultProviders(),
    credentials: buildCredentials(),
    proxyUrl: getProxyUrlFromEnv(process.env),
    unique: options.unique,
    uniqueLookback: options.uniqueLookback,
    name: options.name,
    artifactCount: count,
    imagesPerArtifact: images,
    renderAttempts: options.renderAttempts,
    renderRetryDelayMs: options.renderRetryDelayMs,
    onRetry: event => {
      process.stderr.write(formatRetryMessage(event))
    },
    continueOnError: options.continueOnError,
  })

  const firstRun = result.runs[0]
  if (options.command === 'prompt' && firstRun && count === 1) {
    process.stdout.write(`${firstRun.manifest.resolvedPrompt}\n`)
  } else {
    for (const run of result.runs) {
      process.stdout.write(`Saved ${run.manifest.status} artifact to ${run.artifactDirectory}.\n`)
    }
  }

  for (const error of result.errors) {
    process.stderr.write(`Artifact ${error.index + 1} failed: ${error.message}\n`)
  }

  if (result.errors.length > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
