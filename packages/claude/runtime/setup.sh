#!/bin/sh
# Run as root at image build, from the Dockerfile's runtime mount.
set -eu
npm install --global @anthropic-ai/claude-code
claude --version
