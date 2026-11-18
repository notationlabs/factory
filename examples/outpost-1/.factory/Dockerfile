FROM oven/bun:1-debian

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/*

# The container's runtimes' setups, from the hub's plugins.
COPY factory-runtimes /tmp/factory-runtimes
RUN for setup in /tmp/factory-runtimes/*.sh; do sh "$setup"; done \
 && rm -rf /tmp/factory-runtimes

# Claude Code refuses --dangerously-skip-permissions as root.
RUN useradd --create-home --home-dir /data/home --shell /bin/bash factory \
 && chown -R factory:factory /data
USER factory
ENV HOME=/data/home
# Bun's image works in /home/bun/app, which the factory user can't read.
WORKDIR /data/home
