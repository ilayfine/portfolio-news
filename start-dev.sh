#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"
cd "$(dirname "$0")"
exec npx next dev --port 3000
