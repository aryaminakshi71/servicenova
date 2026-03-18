#!/usr/bin/env bash
set -euo pipefail

SBOM_PATH="${1:-test-results/sbom.cdx.json}"
PROVENANCE_PATH="${2:-test-results/provenance.json}"
OUT_DIR="${3:-test-results/supply-chain-signatures}"
CERT_IDENTITY_REGEX="${COSIGN_CERT_IDENTITY_REGEX:-https://github.com/.+/.+/.github/workflows/.+@refs/(heads|tags|pull)/.+}"
CERT_OIDC_ISSUER="${COSIGN_CERT_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

if ! command -v cosign >/dev/null 2>&1; then
	echo "[supply-chain] cosign binary is required but not found in PATH."
	exit 1
fi

if [[ ! -f "$SBOM_PATH" ]]; then
	echo "[supply-chain] Missing SBOM artifact: $SBOM_PATH"
	exit 1
fi

if [[ ! -f "$PROVENANCE_PATH" ]]; then
	echo "[supply-chain] Missing provenance artifact: $PROVENANCE_PATH"
	exit 1
fi

mkdir -p "$OUT_DIR"

sign_and_verify() {
	local input_path="$1"
	local artifact_name="$2"
	local signature_path="$OUT_DIR/${artifact_name}.sig"
	local certificate_path="$OUT_DIR/${artifact_name}.pem"

	cosign sign-blob \
		--yes \
		--output-signature "$signature_path" \
		--output-certificate "$certificate_path" \
		"$input_path"

	cosign verify-blob \
		--certificate "$certificate_path" \
		--signature "$signature_path" \
		--certificate-identity-regexp "$CERT_IDENTITY_REGEX" \
		--certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
		"$input_path" >/dev/null
}

sign_and_verify "$SBOM_PATH" "sbom"
sign_and_verify "$PROVENANCE_PATH" "provenance"

echo "[supply-chain] Keyless cosign signing and verification succeeded"
