# visual-prompt-kit

Generate production-ready visual prompts from reusable templates, parameter catalogs, and provider profiles. Optionally render images directly through Gemini or OpenAI.

The package includes:

- a reusable TypeScript library;
- a `vpk` / `visual-prompt` CLI;
- JSONC project configuration;
- generation profiles for multiple providers;
- artifact manifests for reproducible runs;
- batch artifact generation;
- multiple images per artifact;
- optional SOCKS5 proxy support.

## Requirements

- Node.js 20 or newer.
- For Gemini: a Google Cloud project with Vertex AI access, or a Gemini API key.
- For OpenAI: an OpenAI API key.

## Install

```bash
npm install visual-prompt-kit
```

For global CLI usage:

```bash
npm install -g visual-prompt-kit
vpk --help
```

GitHub source installs depend on lifecycle hooks because generated `dist` files are not committed. With Yarn, use the Git protocol form instead of the `github:` shorthand so the package is packed and built before installation:

```json
{
  "dependencies": {
    "visual-prompt-kit": "git+https://github.com/elhombre/visual-prompt-kit.git"
  }
}
```

The package includes `prepare` and `prepack` scripts, both running `npm run build`.

## Project Layout

```text
project/
  project.jsonc
  meta-prompt.md
  parameter-catalog.jsonc
```

Example config:

```jsonc
{
  "id": "urban-scenes",
  "metaPromptFile": "./meta-prompt.md",
  "parameterCatalogFile": "./parameter-catalog.jsonc",
  "output": {
    "dir": "./artifacts"
  },
  "generation": {
    "renderAttempts": 3,
    "renderRetryDelayMs": 2000,
    "defaultProfile": "editorial-cover",
    "profiles": {
      "editorial-cover": {
        "prompt": {
          "provider": "gemini",
          "model": "gemini-3.1-flash-image-preview",
          "options": {
            "location": "global"
          }
        },
        "image": {
          "provider": "gemini",
          "model": "gemini-3.1-flash-image-preview",
          "options": {
            "location": "global"
          }
        },
        "format": "png"
      },
      "studio-render": {
        "prompt": {
          "provider": "openai",
          "model": "gpt-5"
        },
        "image": {
          "provider": "gemini",
          "model": "gemini-3.1-flash-image-preview",
          "options": {
            "location": "global"
          }
        },
        "format": "png",
        "size": "1536x1024",
        "quality": "medium",
        "background": "opaque"
      }
    }
  }
}
```

`output.dir` is the library default artifact root and is resolved relative to `project.jsonc`. The CLI intentionally defaults to the current working directory instead, and `--output <dir>` overrides both defaults.

Profile names should describe output presets, not provider wiring. Each profile can choose separate `prompt` and `image` providers. Provider-specific settings belong in `prompt.options` or `image.options`; top-level `options` are merged into both stages. The legacy `provider`, `promptModel`, `imageModel`, and `model` fields are still accepted for compatibility.

## CLI

Generate a final prompt:

```bash
vpk prompt --project ./examples/urban-scenes --set subject="night market courier"
```

Render one image with the default profile:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --set subject="night market courier"
```

Use another profile:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --profile studio-render
```

Override providers for one run:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --prompt-provider openai --image-provider gemini
```

Create five independent artifacts with three images each:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --count 5 --images 3 --continue-on-error
```

Override render retry policy for a quota-sensitive batch:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --count 20 --images 2 --render-attempts 5 --render-retry-delay-ms 3000 --continue-on-error
```

Common options:

- `--profile <name>`: generation profile from `project.jsonc`.
- `--provider <name>`: override both prompt and image providers. If no profile is selected, the CLI first looks for a profile using that provider.
- `--prompt-provider <name>`: override prompt generation provider.
- `--image-provider <name>`: override image generation provider.
- `--set <key=value>`: override one prompt parameter.
- `--output <dir>`: artifact root directory. Defaults to the current working directory.
- `--count <n>`: create independent artifact directories.
- `--images <n>`: create multiple images inside each render artifact.
- `--render-attempts <n>`: attempts for prompt generation during `render`, and for each rendered image. Defaults to `3`.
- `--render-retry-delay-ms <n>`: delay between render retry attempts. Defaults to `2000`.
- `--unique`: add an anti-repetition block from similar prior artifact manifests.

## Environment

The CLI loads the first `.env` found in the invocation directory or its parents. Library APIs never read `.env`; pass credentials explicitly.

Gemini / Vertex AI:

```bash
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_VERTEXAI=true
```

Gemini API key mode:

```bash
GEMINI_API_KEY=...
```

OpenAI:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_PROMPT_MODEL=gpt-5
OPENAI_IMAGE_MODEL=gpt-image-1
```

Optional SOCKS5 proxy:

```bash
SOCKS5_PROXY=socks5://127.0.0.1:1080
```

The CLI also accepts `SOCKS_PROXY` and `ALL_PROXY`; `socks5h://` is normalized to `socks5://`.

## Library API

Main import:

```ts
import {
  createDefaultProviders,
  runImageGenerationFromPrompt,
  runVisualBatch,
  runVisualGeneration,
} from 'visual-prompt-kit'
```

Run one render:

```ts
const result = await runVisualGeneration({
  command: 'render',
  projectPath: './examples/urban-scenes',
  artifactRootDir: './runs',
  parameterOverrides: {
    subject: 'rain-soaked bicycle courier',
  },
  profileOverrides: {
    profileName: 'editorial-cover',
  },
  providers: createDefaultProviders(),
  credentials: {
    gemini: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: 'global',
    },
  },
  imagesPerArtifact: 2,
  renderAttempts: 3,
  renderRetryDelayMs: 2000,
  onRetry: event => {
    const artifact =
      event.artifactIndex === undefined ? '' : `Artifact ${event.artifactIndex + 1}/${event.artifactCount}: `
    console.warn(
      `${artifact}retrying ${event.stage} via ${event.provider} after attempt ${event.attempt}/${event.attempts}: ${event.errorMessage}`,
    )
  },
})

console.log(result.artifactDirectory)
```

Render from a prompt generated earlier:

```ts
const promptRun = await runVisualGeneration({
  command: 'prompt',
  projectPath: './examples/urban-scenes',
  artifactRootDir: './runs',
  parameterOverrides: {
    subject: 'rain-soaked bicycle courier',
  },
  profileOverrides: {
    profileName: 'editorial-cover',
  },
  providers: createDefaultProviders(),
  credentials: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },
})

const renderRun = await runImageGenerationFromPrompt({
  prompt: promptRun.manifest.resolvedPrompt,
  projectPath: './examples/urban-scenes',
  artifactRootDir: './runs',
  parameterOverrides: promptRun.manifest.params,
  profileOverrides: {
    profileName: 'editorial-cover',
  },
  providers: createDefaultProviders(),
  credentials: {
    gemini: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: 'global',
    },
  },
  imagesPerArtifact: 1,
})

console.log(renderRun.manifest.files.images)
```

`runImageGenerationFromPrompt()` is a library-only helper for staged integrations. It does not call the prompt provider and does not add a CLI command. The artifact still uses the normal render manifest shape and writes the supplied text to `prompt.txt`, so consumers can treat the result like any other render artifact.

Run a batch:

```ts
const batch = await runVisualBatch({
  command: 'render',
  projectPath: './examples/urban-scenes',
  artifactRootDir: './runs',
  providers: createDefaultProviders(),
  credentials: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },
  profileOverrides: {
    profileName: 'studio-render',
  },
  artifactCount: 5,
  imagesPerArtifact: 3,
  renderAttempts: 3,
  renderRetryDelayMs: 2000,
  continueOnError: true,
})
```

The CLI prints retry notices to stderr. In batch runs, retry lines include the artifact position, for example `Artifact 3/5`. Library callers can pass `onRetry` to observe retry events without coupling the core API to console output.

Core-only imports:

```ts
import {
  loadProject,
  preparePromptGeneration,
  resolveGenerationProfile,
} from 'visual-prompt-kit/core'
```

Provider-only imports:

```ts
import {
  createGeminiProvider,
  createOpenAiProvider,
  withOptionalSocksProxy,
} from 'visual-prompt-kit/providers'
```

## Artifacts

Each run writes a dedicated artifact directory:

```text
runs/
  2026-04-25T12-00-00Z__night-market-courier/
    manifest.json
    prompt.txt
    image-1.png
    image-2.png
```

`manifest.json` records selected parameters, provider profile, model names, uniqueness sources, generated files, requested image count, generated image count, and status.

See [docs/architecture.md](./docs/architecture.md) for the package architecture.
