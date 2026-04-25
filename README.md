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
    "defaultProfile": "gemini",
    "profiles": {
      "gemini": {
        "provider": "gemini",
        "promptModel": "gemini-3.1-flash-image-preview",
        "imageModel": "gemini-3.1-flash-image-preview",
        "format": "png",
        "options": {
          "location": "global"
        }
      },
      "openai": {
        "provider": "openai",
        "promptModel": "gpt-5",
        "imageModel": "gpt-image-1",
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
vpk render --project ./examples/urban-scenes --output ./runs --profile openai
```

Create five independent artifacts with three images each:

```bash
vpk render --project ./examples/urban-scenes --output ./runs --count 5 --images 3 --continue-on-error
```

Common options:

- `--profile <name>`: generation profile from `project.jsonc`.
- `--provider <name>`: provider override. If no profile is selected, the CLI first looks for a profile using that provider.
- `--set <key=value>`: override one prompt parameter.
- `--output <dir>`: artifact root directory. Defaults to the current working directory.
- `--count <n>`: create independent artifact directories.
- `--images <n>`: create multiple images inside each render artifact.
- `--unique`: add an anti-repetition block from similar prior artifact manifests.

## Environment

The CLI loads the first `.env` found in the invocation directory or its parents. Library APIs never read `.env`; pass credentials explicitly.

Gemini / Vertex AI:

```bash
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_VERTEXAI=true
NANO_BANANA_MODEL=gemini-3.1-flash-image-preview
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
    profileName: 'gemini',
  },
  providers: createDefaultProviders(),
  credentials: {
    gemini: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: 'global',
    },
  },
  imagesPerArtifact: 2,
})

console.log(result.artifactDirectory)
```

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
    profileName: 'openai',
  },
  artifactCount: 5,
  imagesPerArtifact: 3,
  continueOnError: true,
})
```

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
