import type { LoadedProject, ResolvedPromptContext } from './types.js'

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function chooseRandomValue(values: string[]): string {
  const index = Math.floor(Math.random() * values.length)
  return values[index] as string
}

export function extractPlaceholderNames(metaPrompt: string): string[] {
  return dedupe(
    [...metaPrompt.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)]
      .map(match => match[1])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
}

export function resolveParameters(input: {
  project: LoadedProject
  overrides?: Record<string, string>
  placeholderNames: string[]
}): ResolvedPromptContext {
  const { project, overrides, placeholderNames } = input
  const params: Record<string, string> = {}
  const randomlySelected: string[] = []

  for (const name of placeholderNames) {
    const overrideValue = overrides?.[name]
    if (overrideValue !== undefined) {
      params[name] = overrideValue
      continue
    }

    const candidates = project.parameterCatalog?.[name]
    if (!candidates || candidates.length === 0) {
      throw new Error(
        `Missing value for parameter "${name}". Pass --set ${name}=... or add it to parameter-catalog.jsonc.`,
      )
    }

    params[name] = chooseRandomValue(candidates)
    randomlySelected.push(name)
  }

  return { params, randomlySelected }
}
