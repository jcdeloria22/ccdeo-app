# Two stages: build with everything, ship with as little as possible.
#
# Alpine is safe here because nothing in this project compiles native code —
# passwords use scrypt from Node's own crypto rather than bcrypt or argon2,
# precisely so that a deploy cannot fail on a build toolchain we do not control.
#
# Node 22 rather than latest: an LTS line gets security updates for years, and a
# document register is not the place to be chasing a new major every six months.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY web ./web
COPY migrations ./migrations

# Compiles the API to dist/ and the frontend to web/dist/.
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only: no TypeScript, no vite, no test runner.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
# Migrations are read at runtime, from ../../migrations relative to dist/db.
COPY migrations ./migrations
# ~15 MB of text-recognition assets, served at /ocr/ and fetched only when a
# scanned PDF actually needs them. Omitting them is survivable — the Builder
# says so and offers pasting instead — but a deploy should not quietly lose a
# feature, so they ship.
COPY ocr-assets ./ocr-assets

# Do not run as root. Any file the app writes is a bug — blobs belong in object
# storage — so the runtime user owning nothing is itself a check.
USER node

# Railway sets PORT. BIND_HOST must be 0.0.0.0 for the router to reach the
# container, which the bind guard permits only when AUTH_MODE=password.
ENV BIND_HOST=0.0.0.0
EXPOSE 3000

# Migrations run before the server starts, in the same container, so a deploy
# cannot serve a build whose schema has not been applied. `migrate` is
# idempotent and records a hash per file, so a second instance starting
# concurrently applies nothing and a changed file is refused rather than
# silently re-run.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
