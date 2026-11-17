FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/*

COPY --from=oven/bun:1-debian /usr/local/bin/bun /usr/local/bin/bun

COPY runtimes /opt/factory/runtimes
RUN sh /opt/factory/runtimes/setup.sh

COPY runner.ts /opt/factory/runner.ts
COPY factory-runner /usr/local/bin/factory-runner

# Claude Code refuses --dangerously-skip-permissions as root.
RUN useradd --create-home --home-dir /data/home --shell /bin/bash factory \
 && chown -R factory:factory /data
USER factory
ENV HOME=/data/home

EXPOSE 8080
CMD ["/usr/local/bin/factory-runner"]
