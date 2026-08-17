#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
	echo "Usage: $0 IMAGE_TAG" >&2
	exit 2
fi

image_tag=$1
release=${SEALWORT_RELEASE:-}
commit_hash=${SEALWORT_COMMIT_HASH:-${GITHUB_SHA:-}}
repository_url=${SEALWORT_REPOSITORY_URL:-}

if [ -z "$release" ] && [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
	release=${GITHUB_REF_NAME:-}
fi
if [ -z "$release" ] && command -v git >/dev/null 2>&1; then
	release=$(git describe --tags --exact-match 2>/dev/null || true)
fi
if [ -z "$commit_hash" ] && command -v git >/dev/null 2>&1; then
	commit_hash=$(git rev-parse HEAD 2>/dev/null || true)
fi
if [ -z "$repository_url" ] && [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
	repository_url=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY
fi
if [ -z "$repository_url" ] && command -v git >/dev/null 2>&1; then
	repository_url=$(git remote get-url origin 2>/dev/null || true)
fi

if [ -z "$commit_hash" ]; then
	echo "Build commit information is unavailable. Set SEALWORT_COMMIT_HASH." >&2
	exit 1
fi
if [ -z "$repository_url" ]; then
	echo "Build repository information is unavailable. Set SEALWORT_REPOSITORY_URL." >&2
	exit 1
fi

docker build \
	--build-arg SEALWORT_RELEASE="$release" \
	--build-arg SEALWORT_COMMIT_HASH="$commit_hash" \
	--build-arg SEALWORT_REPOSITORY_URL="$repository_url" \
	--file Dockerfile \
	--tag "$image_tag" \
	.
