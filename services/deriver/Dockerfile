# The deriver needs three things the base image does not have: exiftool (to
# rewrite metadata without re-encoding pixels), libheif with an HEVC decoder
# (to read iPhone HEIC — sharp's bundled libvips parses the container but
# cannot decode HEVC), and the heif-convert CLI the fallback shells out to.
FROM node:22-bookworm-slim

# No libheif-plugin-libde265 here, and that is not the same package list as
# CI's. libheif only moved its decoders out into separate plugin packages in
# 1.17; bookworm ships 1.15, where libde265 is a dependency of libheif1 and
# linked straight in. So the plugin package does not exist on this base at all
# — `apt-get install` fails with "Unable to locate package" and takes the whole
# build with it. CI runs a newer Ubuntu where the split has happened and the
# name is correct, which is where it was copied from.
#
# What matters is that HEVC actually decodes, not which package supplied it,
# and the probe below is what establishes that. If this base ever moves to
# trixie or later, the plugin goes back in — by then libheif1 alone decodes
# nothing.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libimage-exiftool-perl \
      libheif1 \
      libheif-examples \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./

# Every workspace package, not the ones the deriver imported the last time
# anyone edited this file. Naming them individually has now silently broken
# the image twice — once when jobs.ts took a dependency on @parea/push, once
# when the pipeline took one on @parea/urls — and the failure is a build
# error a long way from the import that caused it. These are TypeScript
# sources measured in kilobytes; the layer-cache saving was never worth it.
COPY packages packages
COPY services/deriver/package.json services/deriver/
RUN npm ci --omit=dev --workspace @parea/deriver --include-workspace-root

COPY services/deriver services/deriver

# Fails the build if this image cannot actually ingest a photo, rather than
# deploying something that discovers it one upload at a time. Scanning is
# checked at runtime rather than here, since credentials are not present at
# build time — `watch` re-runs the probe and refuses to start without one.
RUN CSAM_SCANNER=disabled NODE_ENV=development npx tsx services/deriver/src/index.ts probe

CMD ["npx", "tsx", "services/deriver/src/index.ts", "watch"]
