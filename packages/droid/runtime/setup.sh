# Installs the Droid CLI system-wide. Runs as root at image build. The
# installer puts droid in root's home, which the factory user can't read.
set -e
curl -fsSL https://app.factory.ai/cli | sh
install -m 0755 "$(readlink -f /root/.local/bin/droid)" /usr/local/bin/droid
rm -rf /root/.local /root/.factory
