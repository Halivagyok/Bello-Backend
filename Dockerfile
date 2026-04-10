# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.1-slim as base
WORKDIR /usr/src/app

# [optional] install curl for healthchecks
# RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Create directory for SQLite and Uploads
RUN mkdir -p /usr/src/app/data /usr/src/app/uploads

# Set environment to production
ENV NODE_ENV=production

# expose the port
EXPOSE 3000

# run the app
USER bun
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
