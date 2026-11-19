# Installs Cursor Agent system-wide. Runs as root at image build. The
# installer puts the CLI in root's home, which the factory user can't read,
# and the CLI is a directory of node and JavaScript, not one binary.
set -e
if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl
  rm -rf /var/lib/apt/lists/*
fi
curl -fsSL https://cursor.com/install | bash
dir="$(dirname "$(readlink -f /root/.local/bin/agent)")"
rm -rf /opt/cursor-agent
mv "$dir" /opt/cursor-agent
chmod -R a+rX /opt/cursor-agent
ln -sfn /opt/cursor-agent/cursor-agent /usr/local/bin/agent
rm -rf /root/.local /root/.cursor
