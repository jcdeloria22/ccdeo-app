# Three stages: build the app, fetch the signatures, ship as little as possible.
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

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web

# Compiles the API to dist/ and the frontend to web/dist/.
RUN npm run build


# ---------------------------------------------------------------------------
# Virus signatures, fetched once at build time.
#
# Its own stage, for two reasons. A source change does not re-download ~250 MB.
# And a failed download fails the BUILD rather than producing an image whose
# scanner cannot scan — which matters because the gate fails closed: an image
# with no signatures would accept uploads and leave every one of them
# Quarantined for ever. Working, correct, and baffling. Better to find out here.
#
# If this step fails it is almost always the mirror rate-limiting. Retry.
FROM alpine:3.20 AS signatures

RUN apk add --no-cache clamav freshclam \
 && freshclam --quiet --datadir=/var/lib/clamav \
 && ls /var/lib/clamav/main.c*d


# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `clamscan` is invoked once per upload. It is the simple arrangement and it
# costs: each scan loads the whole signature set, which is seconds of CPU and a
# few hundred MB of memory. A resident `clamd` is the thing to reach for if
# uploads ever become frequent enough for that to hurt.
RUN apk add --no-cache clamav-scanner clamav-libunrar
COPY --from=signatures /var/lib/clamav /var/lib/clamav
ENV CLAMAV_DB_PATH=/var/lib/clamav

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

# Do not run as root. Any file this app writes is a bug — blobs belong in object
# storage — so the runtime user owning nothing is itself a check. It does need to
# read the signatures, and clamscan wants somewhere to put its temporary copy.
RUN chown -R node:node /var/lib/clamav
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
