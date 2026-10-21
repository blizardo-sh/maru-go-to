FROM oven/bun:1.4.3-slim AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY materials/course.json ./materials/course.json
RUN bun run typecheck && bun run build

FROM oven/bun:1.4.3-slim AS production-dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-slim AS api
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY materials/course.json ./materials/course.json
COPY public/audio ./public/audio
COPY db ./db
USER bun
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]

FROM caddy:2.11.7-alpine AS web
COPY deployment/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
