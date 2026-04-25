import { Buffer } from 'node:buffer'

import { fetch } from 'undici'

import type {
  GeneratedImage,
  ImageProviderRequest,
  ImageProviderResult,
  PromptProviderRequest,
  PromptProviderResult,
  VisualGenerationProvider,
} from '../core/index.js'
import { withOptionalSocksProxy } from './socks.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

interface OpenAiCredentials {
  apiKey?: string
  baseUrl?: string
}

interface OpenAiErrorPayload {
  error?: {
    message?: string
  }
}

interface ResponsesApiPayload {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

interface ImagesApiPayload {
  data?: Array<{
    b64_json?: string
    revised_prompt?: string
  }>
}

function asOpenAiCredentials(value: unknown): OpenAiCredentials {
  return typeof value === 'object' && value !== null ? (value as OpenAiCredentials) : {}
}

function getStringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function requireApiKey(input: PromptProviderRequest | ImageProviderRequest): string {
  const credentials = asOpenAiCredentials(input.credentials)
  const apiKey = credentials.apiKey ?? getStringOption(input.profile.options, 'apiKey')
  if (!apiKey) {
    throw new Error('Missing OpenAI API key.')
  }
  return apiKey
}

function getBaseUrl(input: PromptProviderRequest | ImageProviderRequest): string {
  const credentials = asOpenAiCredentials(input.credentials)
  return credentials.baseUrl ?? getStringOption(input.profile.options, 'baseUrl') ?? DEFAULT_BASE_URL
}

async function callOpenAi<T>(input: {
  apiKey: string
  baseUrl: string
  path: string
  body: Record<string, unknown>
  proxyUrl?: string
}): Promise<T> {
  return withOptionalSocksProxy(input.proxyUrl, async () => {
    const response = await fetch(`${input.baseUrl}${input.path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.body),
    })

    if (!response.ok) {
      let errorMessage = `OpenAI request failed with status ${response.status}.`

      try {
        const payload = (await response.json()) as OpenAiErrorPayload
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

function extractOutputText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text.trim()
  }

  const texts = payload.output
    ?.flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text?.trim() ?? '')
    .filter(Boolean)

  if (texts && texts.length > 0) {
    return texts.join('\n').trim()
  }

  throw new Error('OpenAI prompt generation returned no text output.')
}

async function generatePrompt(input: PromptProviderRequest): Promise<PromptProviderResult> {
  const payload = await callOpenAi<ResponsesApiPayload>({
    apiKey: requireApiKey(input),
    baseUrl: getBaseUrl(input),
    path: '/responses',
    proxyUrl: input.proxyUrl,
    body: {
      model: input.model,
      input: input.input,
    },
  })

  return {
    prompt: extractOutputText(payload),
  }
}

async function generateOneImage(input: ImageProviderRequest): Promise<GeneratedImage> {
  const format = input.format ?? 'png'
  const payload = await callOpenAi<ImagesApiPayload>({
    apiKey: requireApiKey(input),
    baseUrl: getBaseUrl(input),
    path: '/images/generations',
    proxyUrl: input.proxyUrl,
    body: {
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      background: input.background,
      quality: input.quality,
      output_format: format,
    },
  })

  const first = payload.data?.[0]
  if (!first?.b64_json) {
    throw new Error('OpenAI image generation returned no image data.')
  }

  return {
    bytes: Uint8Array.from(Buffer.from(first.b64_json, 'base64')),
    format,
    revisedPrompt: first.revised_prompt,
  }
}

async function generateImages(input: ImageProviderRequest): Promise<ImageProviderResult> {
  const images: GeneratedImage[] = []
  for (let index = 0; index < input.imageCount; index += 1) {
    images.push(await generateOneImage(input))
  }
  return { images }
}

export function createOpenAiProvider(): VisualGenerationProvider {
  return {
    name: 'openai',
    generatePrompt,
    generateImages,
  }
}
