FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY index.html tsconfig.json vite.config.ts tokens.css ./
COPY src ./src
COPY public ./public
COPY materials/course.json ./materials/course.json
RUN bun run typecheck && bun run build

FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS api
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

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS web
RUN setcap -r /usr/bin/caddy
COPY deployment/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
