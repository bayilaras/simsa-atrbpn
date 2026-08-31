ARG NODE_IMAGE=node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
FROM ${NODE_IMAGE} AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY scripts/apply-database-role-bootstrap.mjs ./scripts/apply-database-role-bootstrap.mjs
COPY scripts/apply-database-grant-convergence.mjs ./scripts/apply-database-grant-convergence.mjs
RUN npm run build

# Deliberately separate from the API runtime. This target contains the reviewed
# migration SQL, seeds, and build-time CLI only for a controlled maintenance
# job using a dedicated database principal. Never deploy it as the web service.
FROM build AS maintenance

ENV NODE_ENV=production
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
USER node
CMD ["npm", "run", "db:migrate"]

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# better-auth declares maintenance/test CLIs as optional peers. npm retains
# them when the root lockfile also has those tools as dev dependencies, so
# remove the optional peer toolchain explicitly from the API image.
RUN npm ci --omit=dev \
    && rm -rf \
        node_modules/drizzle-kit \
        node_modules/vitest \
        node_modules/@vitest \
        node_modules/vite \
        node_modules/vite-node \
        node_modules/tsx \
        node_modules/.bin/drizzle-kit \
        node_modules/.bin/vitest \
        node_modules/.bin/vite \
        node_modules/.bin/vite-node \
        node_modules/.bin/tsx \
    && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080

# The same immutable image can run the private Eventarc receiver by overriding
# the command with: node dist/events/storage-finalized.js
CMD ["node", "dist/index.js"]
