import { Buffer } from 'node:buffer'

import { fetch } from 'undici'

import type {
  GeneratedImage,
  ImageFormat,
  ImageProviderRequest,
  ImageProviderResult,
  PromptProviderRequest,
  PromptProviderResult,
  VisualGenerationProvider,
} from '../core/index.js'
import { withOptionalSocksProxy } from './socks.js'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

interface OpenRouterCredentials {
  apiKey?: string
  baseUrl?: string
}

interface OpenRouterErrorPayload {
  error?: {
    message?: string
  }
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }> | null
      images?: Array<{
        image_url?: {
          url?: string
        }
        imageUrl?: {
          url?: string
        }
        type?: string
      }>
    }
  }>
}

function asOpenRouterCredentials(value: unknown): OpenRouterCredentials {
  return typeof value === 'object' && value !== null ? (value as OpenRouterCredentials) : {}
}

function getStringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function getProviderOptions(input: PromptProviderRequest | ImageProviderRequest): Record<string, unknown> {
  return input.providerOptions ?? input.profile.options
}

function requireApiKey(input: PromptProviderRequest | ImageProviderRequest): string {
  const credentials = asOpenRouterCredentials(input.credentials)
  const apiKey = credentials.apiKey ?? getStringOption(getProviderOptions(input), 'apiKey')
  if (!apiKey) {
    throw new Error('Missing OpenRouter API key.')
  }
  return apiKey
}

function getBaseUrl(input: PromptProviderRequest | ImageProviderRequest): string {
  const credentials = asOpenRouterCredentials(input.credentials)
  return credentials.baseUrl ?? getStringOption(getProviderOptions(input), 'baseUrl') ?? DEFAULT_BASE_URL
}

async function callOpenRouter<T>(input: {
  apiKey: string
  baseUrl: string
  body: Record<string, unknown>
  proxyUrl?: string
}): Promise<T> {
  return withOptionalSocksProxy(input.proxyUrl, async () => {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.body),
    })

    if (!response.ok) {
      let errorMessage = `OpenRouter request failed with status ${response.status}.`

      try {
        const payload = (await response.json()) as OpenRouterErrorPayload
        if (payload.error?.message) {
          errorMessage = payload.error.message
        }
      } catch {
        const text = await response.text()
        if (text.trim().length > 0) {
          errorMessage = text.trim()
        }
      }

      throw new Error(errorMessage)
    }

    return (await response.json()) as T
  })
}

function extractMessageText(payload: ChatCompletionPayload): string {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const text = content
      .map(item => (typeof item.text === 'string' ? item.text.trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim()

    if (text.length > 0) {
      return text
    }
  }

  throw new Error('OpenRouter prompt generation returned no text output.')
}

function recordOption(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayOption(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function omitOpenRouterLocalOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(
      ([key]) =>
        ![
          'apiKey',
          'aspectRatio',
          'aspect_ratio',
          'baseUrl',
          'imageConfig',
          'imageSize',
          'image_config',
          'image_size',
          'modalities',
          'outputFormat',
          'output_format',
        ].includes(key),
    ),
  )
}

function imageConfigFor(input: ImageProviderRequest): Record<string, unknown> {
  const options = getProviderOptions(input)
  const imageConfig = {
    ...(recordOption(options.image_config) ?? recordOption(options.imageConfig) ?? {}),
  }

  const aspectRatio = getStringOption(options, 'aspect_ratio') ?? getStringOption(options, 'aspectRatio')
  if (aspectRatio) {
    imageConfig.aspect_ratio = aspectRatio
  } else {
    const derivedAspectRatio = aspectRatioFromSize(input.size)
    if (derivedAspectRatio) {
      imageConfig.aspect_ratio = derivedAspectRatio
    }
  }

  const imageSize = getStringOption(options, 'image_size') ?? getStringOption(options, 'imageSize')
  if (imageSize) {
    imageConfig.image_size = imageSize
  } else if (input.size && !input.size.includes('x')) {
    imageConfig.image_size = input.size
  }

  const outputFormat = getStringOption(options, 'output_format') ?? getStringOption(options, 'outputFormat')
  if (outputFormat) {
    imageConfig.output_format = outputFormat
  } else if (input.format) {
    imageConfig.output_format = input.format
  }

  return imageConfig
}

function aspectRatioFromSize(size: string | undefined): string | undefined {
  const match = /^(\d+)x(\d+)$/i.exec(size ?? '')
  if (!match) {
    return undefined
  }

  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

function greatestCommonDivisor(first: number, second: number): number {
  let a = Math.abs(first)
  let b = Math.abs(second)

  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }

  return a || 1
}

async function generatePrompt(input: PromptProviderRequest): Promise<PromptProviderResult> {
  const options = getProviderOptions(input)
  const payload = await callOpenRouter<ChatCompletionPayload>({
    apiKey: requireApiKey(input),
    baseUrl: getBaseUrl(input),
    proxyUrl: input.proxyUrl,
    body: {
      ...omitOpenRouterLocalOptions(options),
      messages: [{ content: input.input, role: 'user' }],
      model: input.model,
    },
  })

  return {
    prompt: extractMessageText(payload),
  }
}

function extractImages(payload: ChatCompletionPayload): string[] {
  return (
    payload.choices?.flatMap(choice =>
      (choice.message?.images ?? [])
        .map(image => image.image_url?.url ?? image.imageUrl?.url)
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0),
    ) ?? []
  )
}

async function generatedImageFromUrl(url: string, fallbackFormat: ImageFormat): Promise<GeneratedImage> {
  if (url.startsWith('data:')) {
    return generatedImageFromDataUrl(url, fallbackFormat)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`OpenRouter image download failed with status ${response.status}.`)
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const bytes = Uint8Array.from(Buffer.from(await response.arrayBuffer()))

  return {
    bytes,
    format: imageFormatForContentType(contentType) ?? fallbackFormat,
  }
}

function generatedImageFromDataUrl(dataUrl: string, fallbackFormat: ImageFormat): GeneratedImage {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) {
    throw new Error('OpenRouter image generation returned an unsupported image URL.')
  }

  const contentType = match[1].toLowerCase()
  return {
    bytes: Uint8Array.from(Buffer.from(match[2], 'base64')),
    format: imageFormatForContentType(contentType) ?? fallbackFormat,
  }
}

function imageFormatForContentType(contentType: string | null | undefined): ImageFormat | undefined {
  if (contentType === 'image/jpeg') {
    return 'jpeg'
  }
  if (contentType === 'image/png') {
    return 'png'
  }
  if (contentType === 'image/webp') {
    return 'webp'
  }
  return undefined
}

async function generateImages(input: ImageProviderRequest): Promise<ImageProviderResult> {
  const options = getProviderOptions(input)
  const imageConfig = imageConfigFor(input)
  const payload = await callOpenRouter<ChatCompletionPayload>({
    apiKey: requireApiKey(input),
    baseUrl: getBaseUrl(input),
    proxyUrl: input.proxyUrl,
    body: {
      ...omitOpenRouterLocalOptions(options),
      image_config: Object.keys(imageConfig).length > 0 ? imageConfig : undefined,
      messages: [{ content: input.prompt, role: 'user' }],
      modalities: arrayOption(options.modalities) ?? ['image', 'text'],
      model: input.model,
    },
  })
  const imageUrls = extractImages(payload).slice(0, input.imageCount)

  if (imageUrls.length === 0) {
    throw new Error('OpenRouter image generation returned no image data.')
  }

  return {
    images: await Promise.all(
      imageUrls.map(url => generatedImageFromUrl(url, input.format ?? 'png')),
    ),
  }
}

export function createOpenRouterProvider(): VisualGenerationProvider {
  return {
    name: 'openrouter',
    generatePrompt,
    generateImages,
  }
}
