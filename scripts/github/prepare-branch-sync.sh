#!/usr/bin/env bash

set -euo pipefail

: "${SOURCE_REMOTE:?SOURCE_REMOTE is required}"
: "${SOURCE_BRANCH:?SOURCE_BRANCH is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"
: "${SYNC_BRANCH_PREFIX:?SYNC_BRANCH_PREFIX is required}"
: "${SYNC_COMMIT_PREFIX:?SYNC_COMMIT_PREFIX is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

write_output() {
  local name="$1"
  local value="$2"
  local delimiter="SYNC_OUTPUT_${RANDOM}_${RANDOM}"

  {
    printf '%s<<%s\n' "$name" "$delimiter"
    printf '%s\n' "$value"
    printf '%s\n' "$delimiter"
  } >> "$GITHUB_OUTPUT"
}

git fetch --no-tags origin "+refs/heads/${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}"
git fetch --no-tags "$SOURCE_REMOTE" "+refs/heads/${SOURCE_BRANCH}:refs/remotes/${SOURCE_REMOTE}/${SOURCE_BRANCH}"

source_ref="refs/remotes/${SOURCE_REMOTE}/${SOURCE_BRANCH}"
target_ref="refs/remotes/origin/${TARGET_BRANCH}"
source_sha="$(git rev-parse "$source_ref")"
target_sha="$(git rev-parse "$target_ref")"

write_output source_sha "$source_sha"
write_output target_sha "$target_sha"

if git merge-base --is-ancestor "$source_sha" "$target_sha"; then
  write_output status "no_update"
  exit 0
fi

merge_base="$(git merge-base "$target_sha" "$source_sha")"
changed_paths="$(git diff --name-only "$merge_base" "$source_sha")"
hard_block_paths=""
review_paths=""

if [[ -n "${HARD_BLOCK_REGEX:-}" ]]; then
  hard_block_paths="$(printf '%s\n' "$changed_paths" | grep -E "$HARD_BLOCK_REGEX" || true)"
fi

if [[ -n "${REVIEW_REGEX:-}" ]]; then
  review_paths="$(printf '%s\n' "$changed_paths" | grep -E "$REVIEW_REGEX" || true)"
fi

write_output changed_paths "$changed_paths"
write_output hard_block_paths "$hard_block_paths"
write_output review_paths "$review_paths"

# Workflow/action changes from an external source must never be pushed into a
# same-repository PR branch: that would let unreviewed CI definitions execute
# with this repository's GITHUB_TOKEN.
if [[ -n "$hard_block_paths" ]]; then
  write_output status "hard_block"
  exit 0
fi

sync_branch="${SYNC_BRANCH_PREFIX}-${source_sha:0:12}-to-${target_sha:0:12}"
write_output sync_branch "$sync_branch"

git checkout --force -B "$sync_branch" "$target_ref"

if ! git merge --no-ff --no-commit "$source_ref"; then
  conflict_paths="$(git diff --name-only --diff-filter=U)"
  git merge --abort
  write_output conflict_paths "$conflict_paths"
  write_output status "conflict"
  exit 0
fi

git commit -m "${SYNC_COMMIT_PREFIX} ${source_sha:0:12}"
git push origin "HEAD:refs/heads/${sync_branch}"
write_output status "pushed"
