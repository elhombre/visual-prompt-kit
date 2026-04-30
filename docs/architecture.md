# visual-prompt-kit Architecture

`visual-prompt-kit` is a library-first prompt composition and image rendering package.

## Responsibilities

The package has three layers:

- `core`: project loading, JSONC parsing, placeholder resolution, uniqueness, artifacts, manifests, profile resolution, and batch orchestration.
- `providers`: provider adapters for prompt generation and image rendering.
- `cli`: argument parsing, `.env` loading, credential resolution, and console output.

The core layer does not read environment variables, parse CLI arguments, or write to stdout.

## Project Model

A project is a self-contained directory:

```text
project/
  project.jsonc
  meta-prompt.md
  parameter-catalog.jsonc
```

`meta-prompt.md` contains placeholders such as `{{subject}}`. `parameter-catalog.jsonc` maps each placeholder to an array of possible values. `project.jsonc` points to both files, declares generation profiles, and may define a library default output directory through `output.dir`.

For CLI usage, artifact directories are created in the current working directory by default. `--output <dir>` overrides that root for both single and batch runs.

For library usage, artifact directories are created under `artifactRootDir` when passed to `runVisualGeneration()` or `runVisualBatch()`. If no override is passed, the library uses `project.output.dir`, resolved relative to `project.jsonc`.

## Generation Profiles

Provider configuration is profile-based:

```jsonc
{
  "generation": {
    "renderAttempts": 3,
    "renderRetryDelayMs": 2000,
    "defaultProfile": "editorial-cover",
    "profiles": {
      "editorial-cover": {
        "prompt": {
          "provider": "gemini",
          "model": "gemini-3.1-flash-image-preview"
        },
        "image": {
          "provider": "gemini",
          "model": "gemini-3.1-flash-image-preview"
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
          "model": "gemini-3.1-flash-image-preview"
        },
        "format": "png"
      }
    }
  }
}
```

Profile names describe the output preset rather than the provider implementation. Prompt generation and image rendering can use different providers:

- `prompt.provider`
- `prompt.model`
- `prompt.options`
- `image.provider`
- `image.model`
- `image.options`
- `format`
- `size`
- `background`
- `quality`
- `options`

Provider-specific fields belong in `prompt.options` or `image.options`. Top-level `options` are merged into both stages. The legacy `provider`, `promptModel`, `imageModel`, and `model` fields are still accepted and normalized into the stage-based shape.

`renderAttempts` and `renderRetryDelayMs` define the render retry policy. They apply to prompt generation during the `render` command and to each requested image. The `prompt` command performs a single prompt generation request unless a library caller explicitly passes `renderAttempts`. Defaults are `3` attempts and `2000` milliseconds.

The core API stays silent by default. Consumers that need diagnostics can pass `onRetry` to receive retry events; the CLI uses this hook to print retry notices to stderr. Retry events include the provider used by the failed stage. Batch retry events include `artifactIndex` and `artifactCount` so logs can be tied back to a specific artifact.

Resolution order:

1. CLI/API overrides.
2. Selected profile.
3. `generation.defaultProfile`.
4. Package defaults.

If `--provider` is passed without `--profile`, the resolver first selects a profile using that provider when one exists.

## Provider Boundary

Providers implement:

```ts
interface VisualGenerationProvider {
  name: string
  generatePrompt(input: PromptProviderRequest): Promise<PromptProviderResult>
  generateImages(input: ImageProviderRequest): Promise<ImageProviderResult>
}
```

The orchestration layer treats all providers uniformly. If a provider does not support native multi-image generation, it may perform repeated requests internally.

Provider calls receive `providerOptions` for the active stage. This lets a mixed profile pass different options to prompt and image providers while keeping credentials keyed by provider name.

## Batch Semantics

`artifactCount` and `imagesPerArtifact` are intentionally separate:

- `artifactCount`: independent runs with fresh parameter resolution and a separate artifact directory.
- `imagesPerArtifact`: multiple image files for one generated final prompt and one manifest.

The CLI exposes these as:

```bash
vpk render --count 5 --images 3
```

Use `--output <dir>` to place all artifact directories under a specific root:

```bash
vpk render --output ./runs --count 5 --images 3
```

Render retries are applied to the prompt step and then per requested image. With `--images 3` and `--render-attempts 5`, the prompt request and each image request can be tried up to five times before the artifact is marked failed or partially successful.

```bash
vpk render --output ./runs --count 20 --images 2 --render-attempts 5 --render-retry-delay-ms 3000
```

## Staged Library Rendering

Library callers that need prompt review or approval before image rendering can split the workflow into two calls:

1. call `runVisualGeneration({ command: 'prompt', ... })` to generate and persist the final prompt;
2. call `runImageGenerationFromPrompt({ prompt, ... })` to render images from that exact prompt.

`runImageGenerationFromPrompt()` intentionally has no CLI equivalent. It is an integration helper for applications that manage their own staged UI. The function resolves the project and generation profile, validates only the image provider, writes the supplied prompt to `prompt.txt`, renders the requested image files, and writes the same render manifest shape as `runVisualGeneration({ command: 'render', ... })`.

Because no prompt generation happens in the second call, prompt retry events and uniqueness augmentation are not applied there. Image retry events still use the same `renderAttempts`, `renderRetryDelayMs`, and `onRetry` behavior as normal renders.

## Artifact Manifest

Each artifact contains `manifest.json`, `prompt.txt`, and optionally image files. Status values are:

- `success`
- `partial-success`
- `prompt-generation-failed`
- `image-generation-failed`

Failures after the artifact directory is created are written to the manifest before the error is surfaced.

## Proxy Support

Both built-in providers support optional SOCKS5 proxy routing through `undici` global dispatcher management. The CLI reads:

- `SOCKS5_PROXY`
- `SOCKS_PROXY`
- `ALL_PROXY`

Library callers pass `proxyUrl` explicitly.
