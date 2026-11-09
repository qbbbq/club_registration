#!/bin/bash
set -e
pnpm install
pnpm run build
pnpm run build:server
