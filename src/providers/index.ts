export { createGeminiProvider } from './gemini.js'
export { createOpenAiProvider } from './openai.js'
export { createOpenRouterProvider } from './openrouter.js'
export { getProxyUrlFromEnv, normalizeSocksProxyUrl, withOptionalSocksProxy } from './socks.js'

import type { ProviderRegistry } from '../core/index.js'
import { createGeminiProvider } from './gemini.js'
import { createOpenAiProvider } from './openai.js'
import { createOpenRouterProvider } from './openrouter.js'

export function createDefaultProviders(): ProviderRegistry {
  const gemini = createGeminiProvider()
  const openai = createOpenAiProvider()
  const openrouter = createOpenRouterProvider()

  return {
    [gemini.name]: gemini,
    [openai.name]: openai,
    [openrouter.name]: openrouter,
  }
}
