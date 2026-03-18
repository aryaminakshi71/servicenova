#!/usr/bin/env bash
set -euo pipefail

SBOM_PATH="${1:-test-results/sbom.cdx.json}"
PROVENANCE_PATH="${2:-test-results/provenance.json}"
OUT_DIR="${3:-test-results/supply-chain-signatures}"

mkdir -p "$OUT_DIR"
PRIVATE_KEY="$OUT_DIR/signing-private.pem"
PUBLIC_KEY="$OUT_DIR/signing-public.pem"

openssl genrsa -out "$PRIVATE_KEY" 2048 >/dev/null 2>&1
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" >/dev/null 2>&1

openssl dgst -sha256 -sign "$PRIVATE_KEY" -out "$OUT_DIR/sbom.sig" "$SBOM_PATH"
openssl dgst -sha256 -sign "$PRIVATE_KEY" -out "$OUT_DIR/provenance.sig" "$PROVENANCE_PATH"

openssl dgst -sha256 -verify "$PUBLIC_KEY" -signature "$OUT_DIR/sbom.sig" "$SBOM_PATH" >/dev/null
openssl dgst -sha256 -verify "$PUBLIC_KEY" -signature "$OUT_DIR/provenance.sig" "$PROVENANCE_PATH" >/dev/null

echo "[supply-chain] Signed artifacts and verification succeeded"
