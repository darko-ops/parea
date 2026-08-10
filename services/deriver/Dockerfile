# The deriver needs three things the base image does not have: exiftool (to
# rewrite metadata without re-encoding pixels), libheif with an HEVC decoder
# (to read iPhone HEIC — sharp's bundled libvips parses the container but
# cannot decode HEVC), and the heif-convert CLI the fallback shells out to.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libimage-exiftool-perl \
      libheif1 \
      libheif-plugin-libde265 \
      libheif-examples \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/deriver/package.json services/deriver/
RUN npm ci --omit=dev --workspace @parea/deriver --include-workspace-root

COPY packages/core packages/core
COPY services/deriver services/deriver

# Fails the build if this image cannot actually ingest a photo, rather than
# deploying something that discovers it one upload at a time.
RUN npx tsx services/deriver/src/index.ts probe

CMD ["npx", "tsx", "services/deriver/src/index.ts", "watch"]
