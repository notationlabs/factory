# Installs the Droid CLI system-wide. Runs as root at image build. The
# installer puts droid in root's home, which the factory user can't read.
set -e
# Droid's Execute supervisor probes its parent with ps, which slim images lack.
if ! command -v ps >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends procps
  rm -rf /var/lib/apt/lists/*
fi
curl -fsSL https://app.factory.ai/cli | sh
install -m 0755 "$(readlink -f /root/.local/bin/droid)" /usr/local/bin/droid
rm -rf /root/.local /root/.factory
