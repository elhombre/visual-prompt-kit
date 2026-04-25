import type { PromptUniquenessResult } from './types.js'

export function hydrateMetaPrompt(template: string, params: Record<string, string>): string {
  let output = template

  for (const [key, value] of Object.entries(params)) {
    output = output.replaceAll(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value)
  }

  return output
}

export function buildPromptProviderInput(metaPrompt: string, uniqueness: PromptUniquenessResult): string {
  if (!uniqueness.applied || !uniqueness.augmentation) {
    return metaPrompt
  }

  return `${metaPrompt.trim()}\n\n${uniqueness.augmentation.trim()}\n`
}
