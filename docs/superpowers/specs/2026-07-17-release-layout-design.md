# FLClash-style GitHub Releases

## Goal

Make each Gcode GitHub Release immediately actionable: a visitor should identify
their platform and download the correct binary without decoding asset names.

## Release body

Both version tags and the rolling `latest` release will use the same layout:

1. Title and release channel (`vX.Y.Z` or `Latest build (main)`).
2. A concise highlights section. Versioned releases use generated release notes;
   `latest` identifies the source commit.
3. A `Download based on your OS` table with one prominent asset link per
   supported platform:
   - macOS Apple Silicon → `gcode-macos-arm64.tar.gz`
   - Linux x86_64 → `gcode-linux-x86_64.tar.gz`
4. An installation hint that points users to the README for the complete
   commands. GitHub's native Assets section remains the complete source of
   release files.

## Assets and integrity

The build job produces a SHA-256 sidecar for every archive. The publishing job
uploads both archive and sidecar, so release notes can link the primary download
while users who need verification retain a standard, discoverable checksum.

## Workflow shape

Build matrix jobs only build, package, checksum, and upload CI artifacts. A
single downstream publishing job downloads all successful artifacts, constructs
the body, and creates or updates the release. This avoids concurrent matrix jobs
racing to own the same release body and guarantees the table reflects the full
asset set.

`latest` keeps its rolling prerelease behavior; version tags remain stable
releases. Unsupported or failed platform builds do not create a broken link:
the body table is generated from the artifacts actually downloaded.

## Validation

- Shell-check the body-generation logic through the GitHub Actions YAML.
- Verify the workflow syntax and that both channels upload archive plus
  checksum.
- Inspect generated release markdown with a local fixture for complete and
  partial artifact sets.

## Out of scope

- A custom GitHub web UI (GitHub controls the page chrome).
- Additional operating systems or package formats.
- Changing binary behavior or updater logic.
