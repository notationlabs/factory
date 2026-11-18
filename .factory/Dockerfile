FROM node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11
