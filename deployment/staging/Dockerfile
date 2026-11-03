FROM ghcr.io/blizardo-sh/maru-go-to-api@sha256:42bf7e93fe44a90f30b3db7ef5425970d62c658584e0fb1c018261d8ebf52cb7
USER root
WORKDIR /stage
RUN ln -s /app/node_modules /stage/node_modules
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY materials ./materials
COPY db ./db
COPY dist ./dist
COPY dist ./public
USER bun
CMD ["bun", "src/server/index.ts"]
