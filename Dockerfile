FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder

ARG SEALWORT_RELEASE
ARG SEALWORT_COMMIT_HASH
ARG SEALWORT_REPOSITORY_URL
ENV SEALWORT_RELEASE=$SEALWORT_RELEASE
ENV SEALWORT_COMMIT_HASH=$SEALWORT_COMMIT_HASH
ENV SEALWORT_REPOSITORY_URL=$SEALWORT_REPOSITORY_URL

WORKDIR /source
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY scripts/ scripts/
COPY src/ src/
RUN bun run build

FROM ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 AS ipfs-kubo
FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf

COPY --from=ipfs-kubo /usr/local/bin/ipfs /usr/local/bin/ipfs
COPY --from=builder /source/src/dist /export
RUN ipfs init \
	&& ipfs add --cid-version 1 --quieter --only-hash --recursive /export > /ipfs_hash.txt

COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -eu

BUILD_CID=$(cat /ipfs_hash.txt)
IPFS_API_ADDRESS="${IPFS_API_MULTIADDR:-/dns4/host.docker.internal/tcp/5001}"

echo "Build CID: $BUILD_CID"
echo "Publishing Sealwort to Kubo at $IPFS_API_ADDRESS"
if ! PUBLISHED_CID=$(ipfs add \
		--api "$IPFS_API_ADDRESS" \
		--cid-version 1 \
		--pin=true \
		--quieter \
		--recursive \
		/export); then
	echo "Could not publish to Kubo at $IPFS_API_ADDRESS." >&2
	echo "A loopback-only host RPC listener is not reachable from Docker; see the README for configuration options." >&2
	exit 1
fi

if [ "$PUBLISHED_CID" != "$BUILD_CID" ]; then
	echo "Published CID $PUBLISHED_CID does not match build CID $BUILD_CID." >&2
	exit 1
fi

echo "Published CID: $PUBLISHED_CID"
echo "Local URL: http://$PUBLISHED_CID.ipfs.localhost:8080/"
EOF

RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
