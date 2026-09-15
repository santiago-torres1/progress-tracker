# Backend container image for AWS Lambda (x86_64), invoked through a Lambda Function URL.
#
# CI builds it with:
#   docker buildx build --platform linux/amd64 --provenance=false --build-arg GIT_SHA=<sha> ...
#
# --platform linux/amd64  The function's architecture is x86_64. Without this, a build on an
#                         arm64 machine (e.g. Apple Silicon) produces an image Lambda cannot run.
# --provenance=false      buildx attaches a provenance attestation by default, which turns the
#                         pushed artifact into an OCI image index. Lambda rejects image indexes
#                         with attestations; it needs a plain single-platform image manifest.
#
# Local test against the Runtime Interface Emulator bundled in the base image:
#   npm run docker:build && npm run docker:run
#   curl -s -X POST localhost:9000/2015-03-31/functions/function/invocations \
#     -d @events/function-url-health.json

# ---- build: compile TypeScript -------------------------------------------------------------
# Runs on the builder's native platform: the output is plain JavaScript, so there is nothing
# architecture-specific here and no reason to compile under emulation on arm64 machines.
FROM --platform=$BUILDPLATFORM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /build
COPY package.json package-lock.json ./
# --ignore-scripts: no dependency needs an install script to compile; don't run third-party code.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only --------------------------------------------------
# Separate stage on the *target* platform, so any future dependency with native code is
# installed for x86_64 rather than for the build machine.
FROM public.ecr.aws/lambda/nodejs:22 AS prod-deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime: what Lambda runs -------------------------------------------------------------
FROM public.ecr.aws/lambda/nodejs:22

ENV NODE_ENV=production
# dist/ ships source maps; this makes stack traces in CloudWatch point at src/*.ts lines.
ENV NODE_OPTIONS=--enable-source-maps

COPY --from=prod-deps /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
# package.json is required at runtime: "type": "module" makes Node load dist/*.js as ESM, and
# GET /health reads "version" from it (dist/lib/version.js -> ../../package.json).
COPY package.json ${LAMBDA_TASK_ROOT}/package.json
COPY --from=build /build/dist ${LAMBDA_TASK_ROOT}/dist

# Declared last so a new commit SHA does not invalidate the cached layers above.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

CMD ["dist/lambda.handler"]
