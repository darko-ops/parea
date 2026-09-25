# The deriver needs three things the base image does not have: exiftool (to
# rewrite metadata without re-encoding pixels), libheif with an HEVC decoder
# (to read iPhone HEIC — sharp's bundled libvips parses the container but
# cannot decode HEVC), and the heif-convert CLI the fallback shells out to.
# Trixie, for libheif. Bookworm ships 1.15.1, and 1.15 rejects a modern iPhone
# photograph outright:
#
#   Could not read HEIF/AVIF file: Invalid input: Unspecified:
#   Too many auxiliary image references
#
# A photograph off a current iPhone carries several auxiliary images — an HDR
# gain map, depth — and 1.15's ceiling on how many it will follow is below
# what the camera writes. So `heif-convert` failed, the fallback in
# `buildDerivatives` caught nothing, and every HEIC upload ended `failed` with
# "bad seek" from sharp: the container parses, the pixels never decode, and
# the one thing that could have decoded them refused to open the file.
#
# It failed on real photographs only. The probe's fixture is a minimal HEVC
# sample with no auxiliary images at all, so it decoded happily on 1.15 and
# the image built green — see the note on the probe below, which is the part
# of this that still does not catch it.
FROM node:22-trixie-slim

# The plugin is back, exactly as the note it replaces predicted. libheif moved
# its decoders out into separate packages in 1.17, so on trixie `libheif1`
# alone decodes nothing at all and the HEVC decoder has to be asked for by
# name. On bookworm the same line failed the build with "Unable to locate
# package", which is why it was not here.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libimage-exiftool-perl \
      libheif1 \
      libheif-examples \
      libheif-plugin-libde265 \
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
# deploying something that discovers it one upload at a time. This is a check
# on codecs and binaries, which are properties of the image; scanner and
# classifier credentials are properties of a deployment and are not present
# here, so `watch` re-runs the same probe against the real environment.
#
# Its reach is narrower than it looks, and the libheif upgrade above is the
# proof: the fixture it decodes is a minimal HEVC sample with no auxiliary
# images, so it passed on a libheif that could not open any photograph an
# iPhone has ever taken. It answers "is there an HEVC decoder", not "can this
# read what the cameras people own actually produce". Closing that gap needs a
# real photograph in the repository, which is a licensing and size question
# rather than a technical one.
#
# The posture is declared only to get past the runtime gate during a build. It
# says nothing about how the deployment reviews content — that is read from the
# environment at boot, where the answer actually lives.
RUN PAREA_MODERATION=manual NODE_ENV=development \
      node_modules/.bin/tsx services/deriver/src/index.ts probe

# Not root, and this is the one line in the file that is about what happens
# when something here goes wrong rather than about making it work.
#
# This process exists to decode images from strangers. That is the largest
# untrusted-input surface in the product — libvips, libheif and exiftool all
# parse attacker-chosen bytes — and it is also the process holding the R2
# credentials and DATABASE_URL. Running it as root means a decoder bug is root
# in a container with the keys to the photo store; running it as `node` means
# it is a decoder bug.
#
# `node:22-trixie-slim` ships the `node` user for exactly this. Nothing here
# needs to write inside the image: the build ran as root and the app only reads
# what it copied, while the pipeline's scratch files go to `mkdtemp` under
# `/tmp`, which is world-writable. Nothing binds below port 1024 either — 8080
# is above the privileged range, which is why that number and not 80.
#
# After every build step, so `npm ci` and the probe above still run as root.
USER node

# The port `serve` listens on, and what `fly.toml` points `internal_port` at.
EXPOSE 8080

# `watch` rather than `serve` as the image default: running this container by
# hand has no QStash in front of it, and `serve` refuses to start without
# signing keys. Production does not use this line — `fly.toml` sets the
# process — and the poll is still the right answer against a local database
# nobody is billed for.
# `node_modules/.bin/tsx`, not `npx tsx`, and the difference is a network call.
#
# `tsx` was a devDependency while the install above is `--omit=dev`, so it was
# not in the image — and `npx` answers that by fetching it from the registry and
# running it, which is exactly what it is for and exactly what nobody wanted
# here. It was doing so on every cold boot: the build-time probe downloaded it
# as root, that cache lives in root's `~/.npm`, and `USER node` then had its own
# empty one, so the running container fetched it again. The line read like a
# local invocation and was a supply-chain path into the process holding the R2
# credentials and DATABASE_URL.
#
# So `tsx` is a real dependency of `@parea/deriver` now, and these call the
# binary rather than a package runner. A missing one is then an exec failure on
# the spot instead of a silent install — which is the same preference the boot
# probe expresses two lines up, and the reason ingest refuses to start rather
# than start badly.
#
# Absolute, because Docker's exec form runs no shell to resolve a relative path
# against WORKDIR. The two Fly process definitions are relative and correct,
# because those *are* run through a shell, in `/app`.
CMD ["/app/node_modules/.bin/tsx", "services/deriver/src/index.ts", "watch"]
