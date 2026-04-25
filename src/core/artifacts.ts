import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseJsonc } from './jsonc.js'
import type { ArtifactManifestRecord, RunManifest } from './types.js'

function normalizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.length > 0 ? normalized.slice(0, 80) : 'run'
}

export function getArtifactSlug(name: string | undefined, params: Record<string, string>, fallback: string): string {
  if (name && name.trim().length > 0) {
    return normalizeSlug(name)
  }

  const topic = params.topic
  if (typeof topic === 'string' && topic.trim().length > 0) {
    return normalizeSlug(topic)
  }

  return normalizeSlug(fallback)
}

export function formatArtifactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z')
}

export async function createArtifactDirectory(
  baseDir: string,
  createdAt: Date,
  slug: string,
): Promise<{
  directoryName: string
  directoryPath: string
}> {
  await mkdir(baseDir, { recursive: true })

  const timestamp = formatArtifactTimestamp(createdAt)
  const baseName = `${timestamp}__${slug}`
  let candidate = baseName
  let suffix = 1

  while (true) {
    const directoryPath = resolve(baseDir, candidate)

    try {
      await mkdir(directoryPath)
      return { directoryName: candidate, directoryPath }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST') {
        throw error
      }
    }

    candidate = `${baseName}__${suffix}`
    suffix += 1
  }
}

export async function listArtifactManifests(outputDir: string): Promise<ArtifactManifestRecord[]> {
  try {
    const info = await stat(outputDir)
    if (!info.isDirectory()) {
      return []
    }
  } catch {
    return []
  }

  const entries = await readdir(outputDir, { withFileTypes: true })
  const manifests: ArtifactManifestRecord[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const directoryPath = resolve(outputDir, entry.name)
    const manifestPath = resolve(directoryPath, 'manifest.json')

    try {
      const raw = await readFile(manifestPath, 'utf8')
      const manifest = parseJsonc<RunManifest>(raw, manifestPath)
      manifests.push({
        manifestPath,
        directoryPath,
        directoryName: entry.name,
        manifest,
      })
    } catch {}
  }

  return manifests.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt))
}
