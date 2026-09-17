#!/usr/bin/env bash
set -euo pipefail
branch="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
test "$branch" = 'develop/v20-integrated-decision-platform'
certified_commit="$(git rev-parse HEAD)"
certified_parent="$(git rev-parse HEAD^)"
mapfile -t certified_paths < <(git diff-tree --no-commit-id --name-only -r "$certified_commit")
# Rebase in an isolated worktree: unstaged runtime outputs must never be staged,
# discarded, or included in the certified commit by the publication retry.
retry_dir="$(mktemp -d)"
rmdir "$retry_dir"
git worktree add --detach "$retry_dir" "$certified_commit"
trap 'git worktree remove --force "$retry_dir"' EXIT
for attempt in 1 2 3; do
  git fetch --no-tags origin "$branch"
  remote_commit="$(git rev-parse FETCH_HEAD)"
  git merge-base --is-ancestor "$certified_parent" "$remote_commit" || { echo 'Certification source ancestry changed'; exit 1; }
  # Permit only disjoint, generated evidence changes. Any source/config change
  # requires a fresh certification; conflicting evidence is never auto-resolved.
  changed="$(git diff --name-only "$certified_parent" "$remote_commit")"
  while IFS= read -r rel; do
    test -z "$rel" && continue
    case "$rel" in
      data/v20/cross-version-consensus.json|data/v20/cross-version-consensus-regression.json|data/v20/multi-engine-consensus.json|data/v20/multi-engine-consensus-regression.json) continue ;;
    esac
    git diff-tree --no-commit-id --name-only -r "$certified_commit" | grep -Fx "$rel" >/dev/null || { echo "Certification input changed: $rel"; exit 1; }
  done <<< "$changed"
  if ! git -C "$retry_dir" rebase "$remote_commit"; then
    git -C "$retry_dir" rebase --abort
    echo 'Concurrent certified evidence conflicts; fresh certification required.'
    exit 1
  fi
  git -C "$retry_dir" diff --quiet "$certified_commit" HEAD -- "${certified_paths[@]}" || { echo 'Rebase changed certified artifact bytes; fresh certification required.'; exit 1; }
  if git -C "$retry_dir" push origin "HEAD:refs/heads/$branch"; then exit 0; fi
  echo "Branch advanced during certified push (attempt $attempt)."
done
echo 'Certified push retry limit reached.'
exit 1
