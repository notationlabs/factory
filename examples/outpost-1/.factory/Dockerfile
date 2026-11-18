FROM oven/bun:1-debian

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh jq openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/*

# The installer puts claude in root's home, which the factory user can't read.
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && install -m 0755 "$(readlink -f /root/.local/bin/claude)" /usr/local/bin/claude \
 && rm -rf /root/.local /root/.claude /root/.claude.json
ENV DISABLE_AUTOUPDATER=1

RUN useradd --create-home --home-dir /data/home --shell /bin/bash factory \
 && chown -R factory:factory /data
USER factory
ENV HOME=/data/home
