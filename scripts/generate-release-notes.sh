#!/usr/bin/env bash
# Generate the shared GitHub Release body for tagged and rolling builds.
set -euo pipefail

channel="$1"
commit="$2"
repository="$3"
artifacts_dir="$4"
output_file="$5"

release_url="https://github.com/${repository}/releases/download/${channel}"
readme_url="https://github.com/${repository}#installing-the-released-binary"

download_row() {
    local platform="$1"
    local archive="$2"
    if [[ -f "${artifacts_dir}/${archive}" ]]; then
        printf '| %s | [%s](%s/%s) |\n' "$platform" "$archive" "$release_url" "$archive"
    fi
}

{
    if [[ "$channel" == "latest" ]]; then
        printf '%s\n\n' '## Latest build (main)'
        printf 'Built from commit [`%.12s`](https://github.com/%s/commit/%s).\n\n' \
            "$commit" "$repository" "$commit"
    else
        printf '%s\n\n' '## Downloads'
    fi

    printf '%s\n\n' '### Download based on your OS'
    printf '%s\n' '| OS | Download |' '| --- | --- |'
    download_row 'macOS Apple Silicon' 'gork-macos-arm64.tar.gz'
    download_row 'Linux x86_64' 'gork-linux-x86_64.tar.gz'
    printf '\n%s\n\n' \
        'Each archive has a matching `.sha256` file in the Assets section for verification.'
    printf '%s\n\n' '### Install'
    printf '[View installation instructions](%s).\n' "$readme_url"
} >"$output_file"
