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
}

type GenerateResponseLike = {
  text?: string
  parts?: ResponsePart[]
  candidates?: Array<{
    content?: {
      parts?: ResponsePart[]
    }
  }>
}

function asGeminiCredentials(value: unknown): GeminiCredentials {
  return typeof value === 'object' && value !== null ? (value as GeminiCredentials) : {}
}

function getStringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function getBooleanOption(options: Record<string, unknown>, name: string): boolean | undefined {
  const value = options[name]
  return typeof value === 'boolean' ? value : undefined
}

function createClient(input: PromptProviderRequest | ImageProviderRequest): GoogleGenAI {
  const credentials = asGeminiCredentials(input.credentials)
  const apiKey = credentials.apiKey ?? getStringOption(input.profile.options, 'apiKey')
  const project = credentials.project ?? getStringOption(input.profile.options, 'project')
  const location = credentials.location ?? getStringOption(input.profile.options, 'location') ?? 'global'
  const vertexai = credentials.vertexai ?? getBooleanOption(input.profile.options, 'vertexai') ?? true

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

function getParts(response: unknown): ResponsePart[] {
  const typedResponse = response as GenerateResponseLike
  if (Array.isArray(typedResponse.parts)) {
    return typedResponse.parts
  }

  return typedResponse.candidates?.[0]?.content?.parts ?? []
}

function extractText(response: unknown): string {
  const typedResponse = response as GenerateResponseLike
  if (typeof typedResponse.text === 'string' && typedResponse.text.trim().length > 0) {
    return typedResponse.text.trim()
  }

  const text = getParts(response)
    .map(part => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()

  if (!text) {
    throw new Error('Gemini prompt generation returned no text output.')
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
        throw new Error('Gemini image generation returned no image data.')
      }
    }

    return { images }
  })
}

export function createGeminiProvider(): VisualGenerationProvider {
  return {
    name: 'gemini',
    generatePrompt,
    generateImages,
  }
}
