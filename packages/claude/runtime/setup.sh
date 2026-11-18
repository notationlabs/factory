# Installs Claude Code system-wide. Runs as root at image build. The
# installer puts claude in root's home, which the factory user can't read.
set -e
if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl
  rm -rf /var/lib/apt/lists/*
fi
curl -fsSL https://claude.ai/install.sh | bash
install -m 0755 "$(readlink -f /root/.local/bin/claude)" /usr/local/bin/claude
rm -rf /root/.local /root/.claude /root/.claude.json
