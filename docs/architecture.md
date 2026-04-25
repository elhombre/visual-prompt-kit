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
    "defaultProfile": "gemini",
    "profiles": {
      "gemini": {
        "provider": "gemini",
        "promptModel": "gemini-3.1-flash-image-preview",
        "imageModel": "gemini-3.1-flash-image-preview",
        "format": "png"
      }
    }
  }
}
```

Common fields are shared across providers:

- `provider`
- `promptModel`
- `imageModel`
- `model`
- `format`
- `size`
- `background`
- `quality`
- `options`

`model` is a shortcut for setting both prompt and image models. Provider-specific fields belong in `options`.

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
