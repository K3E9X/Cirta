#!/bin/sh
# Refuse a commit that would add identifying metadata or a deceptive link.
#
# Install with:  cp examples/pre-commit-hook.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# Only staged files are scanned, so the hook stays fast on a large repository.
# `--fail-on confirmed` is the gate: probable findings (a title, a timestamp)
# are reported by `cirta inspect` when you ask, and are not worth blocking a
# commit over.
set -eu

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

# shellcheck disable=SC2086
if ! echo "$staged" | xargs -r cirta inspect --fail-on confirmed; then
  echo
  echo "cirta: a staged file carries confirmed identifying data."
  echo "       Review it above, then either clean it:"
  echo
  echo "           cirta redact <file> --in-place"
  echo
  echo "       or commit anyway with:  git commit --no-verify"
  exit 1
fi
