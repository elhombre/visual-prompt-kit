import { Buffer } from 'node:buffer'

import { GoogleGenAI } from '@google/genai'

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

interface GeminiCredentials {
  project?: string
  location?: string
  apiKey?: string
  vertexai?: boolean
}

type InlineData = {
  data?: string
  mimeType?: string
  mime_type?: string
}

type ResponsePart = {
  text?: string
  inlineData?: InlineData
  inline_data?: InlineData
  [key: string]: unknown
}

type GenerateResponseLike = {
  parts?: ResponsePart[]
  candidates?: Array<{
    finishReason?: string
    finish_reason?: string
    content?: {
      parts?: ResponsePart[]
    }
  }>
  promptFeedback?: {
    blockReason?: string
    block_reason?: string
  }
  prompt_feedback?: {
    blockReason?: string
    block_reason?: string
  }
}

const GEMINI_NON_TEXT_WARNING = 'there are non-text parts'
const GEMINI_WARNING_FILTER_FLAG = Symbol.for('visual-prompt-kit.gemini-warning-filter-installed')

function asGeminiCredentials(value: unknown): GeminiCredentials {
  return typeof value === 'object' && value !== null ? (value as GeminiCredentials) : {}
}

function getStringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function getProviderOptions(input: PromptProviderRequest | ImageProviderRequest): Record<string, unknown> {
  return input.providerOptions ?? input.profile.options
}

function getBooleanOption(options: Record<string, unknown>, name: string): boolean | undefined {
  const value = options[name]
  return typeof value === 'boolean' ? value : undefined
}

function createClient(input: PromptProviderRequest | ImageProviderRequest): GoogleGenAI {
  const credentials = asGeminiCredentials(input.credentials)
  const options = getProviderOptions(input)
  const apiKey = credentials.apiKey ?? getStringOption(options, 'apiKey')
  const project = credentials.project ?? getStringOption(options, 'project')
  const location = credentials.location ?? getStringOption(options, 'location') ?? 'global'
  const vertexai = credentials.vertexai ?? getBooleanOption(options, 'vertexai') ?? true

  if (apiKey) {
    return new GoogleGenAI({ apiKey })
  }

  if (!project) {
    throw new Error('Missing Gemini project. Set GOOGLE_CLOUD_PROJECT or pass Gemini credentials explicitly.')
  }

  return new GoogleGenAI({
    vertexai,
    project,
    location,
  })
}

function installGeminiWarningFilter(): void {
  const globalState = globalThis as typeof globalThis & {
    [GEMINI_WARNING_FILTER_FLAG]?: boolean
  }

  if (globalState[GEMINI_WARNING_FILTER_FLAG]) {
    return
  }

  globalState[GEMINI_WARNING_FILTER_FLAG] = true
  const originalWarn = console.warn.bind(console)

  console.warn = (...args: unknown[]) => {
    const first = args[0]
    if (
      typeof first === 'string' &&
      first.includes(GEMINI_NON_TEXT_WARNING) &&
      first.includes('returning concatenation of all text parts')
    ) {
      return
    }

    originalWarn(...args)
  }
}

function getParts(response: unknown): ResponsePart[] {
  const typedResponse = response as GenerateResponseLike
  if (Array.isArray(typedResponse.parts)) {
    return typedResponse.parts
  }

  return typedResponse.candidates?.flatMap(candidate => candidate.content?.parts ?? []) ?? []
}

function getTextParts(response: unknown): string[] {
  return getParts(response)
    .map(part => part.text?.trim() ?? '')
    .filter(Boolean)
}

function getResponseDiagnostics(response: unknown): string {
  const typedResponse = response as GenerateResponseLike
  const parts = getParts(response)
  const partSummary = parts
    .map(part => {
      const inlineData = part.inlineData || part.inline_data
      if (inlineData) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || 'unknown'
        return `inlineData(mimeType=${mimeType}, hasData=${inlineData.data ? 'true' : 'false'})`
      }

      if (typeof part.text === 'string') {
        return 'text'
      }

      const keys = Object.keys(part)
      return keys.length > 0 ? keys.join('+') : 'empty'
    })
    .join(', ')
  const text = getTextParts(response)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
  const finishReasons =
    typedResponse.candidates
      ?.map(candidate => candidate.finishReason || candidate.finish_reason)
      .filter(Boolean)
      .join(', ') ?? ''
  const promptFeedback = typedResponse.promptFeedback || typedResponse.prompt_feedback
  const blockReason = promptFeedback?.blockReason || promptFeedback?.block_reason

  return [
    partSummary ? `parts=[${partSummary}]` : 'parts=[]',
    text ? `text="${text}"` : undefined,
    finishReasons ? `finishReasons=[${finishReasons}]` : undefined,
    blockReason ? `promptBlockReason=${blockReason}` : undefined,
  ]
    .filter(Boolean)
    .join('; ')
}

function extractText(response: unknown): string {
  const text = getTextParts(response).join('\n').trim()

  if (!text) {
    throw new Error(`Gemini prompt generation returned no text output. ${getResponseDiagnostics(response)}`)
  }

  return text
}

function formatForMime(mimeType: string, requested?: ImageFormat): ImageFormat {
  if (mimeType === 'image/jpeg') {
    return 'jpeg'
  }
  if (mimeType === 'image/webp') {
    return 'webp'
  }
  return requested ?? 'png'
}

async function generatePrompt(input: PromptProviderRequest): Promise<PromptProviderResult> {
  return withOptionalSocksProxy(input.proxyUrl, async () => {
    const ai = createClient(input)
    const response = await ai.models.generateContent({
      model: input.model,
      contents: input.input,
    })

    return {
      prompt: extractText(response),
    }
  })
}

async function generateImages(input: ImageProviderRequest): Promise<ImageProviderResult> {
  return withOptionalSocksProxy(input.proxyUrl, async () => {
    const ai = createClient(input)
    const images: GeneratedImage[] = []

    while (images.length < input.imageCount) {
      const imageCountBeforeRequest = images.length
      const response = await ai.models.generateContent({
        model: input.model,
        contents: input.prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          candidateCount: 1,
        },
      })

      for (const part of getParts(response)) {
        const inlineData = part.inlineData || part.inline_data
        if (!inlineData?.data) {
          continue
        }

        const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png'
        images.push({
          bytes: Uint8Array.from(Buffer.from(inlineData.data, 'base64')),
          format: formatForMime(mimeType, input.format),
        })

        if (images.length >= input.imageCount) {
          break
        }
      }

      if (images.length === imageCountBeforeRequest) {
        throw new Error(`Gemini image generation returned no image data. ${getResponseDiagnostics(response)}`)
      }
    }

    return { images }
  })
}

export function createGeminiProvider(): VisualGenerationProvider {
  installGeminiWarningFilter()

  return {
    name: 'gemini',
    generatePrompt,
    generateImages,
  }
}
