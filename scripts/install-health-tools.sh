#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking for standalone health tool dependencies (OSV-Scanner, Gitleaks, actionlint)..."

if command -v brew >/dev/null 2>&1; then
  echo "==> Homebrew detected. Installing or updating tools via brew..."
  brew install osv-scanner gitleaks actionlint || true
elif command -v go >/dev/null 2>&1; then
  echo "==> Go detected. Installing tools via go install..."
  go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.0.2
  go install github.com/zricethezav/gitleaks/v8@v8.24.2
  go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
  echo "Make sure \$(go env GOPATH)/bin is in your PATH."
else
  echo "Error: Neither 'brew' nor 'go' was found on your system."
  echo "Please install Homebrew (https://brew.sh) or Go (https://go.dev) to install these standalone health tools."
  exit 1
fi

echo "==> Standalone health tools setup complete!"
