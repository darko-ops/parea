#!/bin/sh
# Vercel's Ignored Build Step for apps/web (see `ignoreCommand` in
# apps/web/vercel.json, which runs this from apps/web): exit 0 cancels the
# build, 1 builds. It builds unless nothing the app is built from changed
# since the last deployed commit, and builds when there is no such commit or
# git cannot compare with it. apps/web/test/ignore-build.test.ts checks that
# every @parea/* package the app depends on is listed.
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  . \
  ../../packages/cards \
  ../../packages/core \
  ../../packages/push \
  ../../packages/upload \
  ../../packages/urls \
  ../../packages/zip \
  ../../package.json \
  ../../package-lock.json \
  ../../.nvmrc \
  ../../.vercelignore \
  ../../scripts/migrate-on-deploy.mjs \
  ../../scripts/ignore-web-build.sh || exit 1
