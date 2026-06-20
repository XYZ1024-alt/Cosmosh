package wrapper

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"text/template"
)

// Config describes the immutable bootstrap wrapper inputs.
type Config struct {
	Shell            string
	TargetOS         string
	TargetArch       string
	Version          string
	AssetURL         string
	SHA256           string
	HelperPayloadB64 string
}

var supportedShells = map[string]bool{
	"ash":  true,
	"bash": true,
	"fish": true,
	"sh":   true,
	"zsh":  true,
}

const posixTemplate = `set -eu
cosmosh_phase() { printf '{"type":"bootstrap-status","phase":"%s","state":"%s","version":"%s","message":"%s"}\n' "$1" "$2" "{{.Version}}" "$3"; }
cosmosh_fail() { printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\n' "$1" "{{.Version}}" "$2" "$3"; exit 1; }
cosmosh_tmp="${TMPDIR:-/tmp}/cosmosh-bootstrap-{{.Version}}-$$"
mkdir -p "$cosmosh_tmp"
cosmosh_bin="$cosmosh_tmp/cosmosh-bootstrap"
cosmosh_phase download started "downloading bootstrap binary"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "{{.AssetURL}}" -o "$cosmosh_bin" || cosmosh_fail download DOWNLOAD_FAILED "curl download failed"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$cosmosh_bin" "{{.AssetURL}}" || cosmosh_fail download DOWNLOAD_FAILED "wget download failed"
else
  cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"
fi
cosmosh_phase verify started "verifying bootstrap binary"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "{{.SHA256}}" "$cosmosh_bin" | sha256sum -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"
elif command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "{{.SHA256}}" "$cosmosh_bin" | shasum -a 256 -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"
else
  cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"
fi
chmod 700 "$cosmosh_bin"
cosmosh_phase install started "installing bootstrap helper"
"$cosmosh_bin" install --shell "{{.Shell}}" --version "{{.Version}}" --helper-payload-b64 "{{.HelperPayloadB64}}"
`

const fishTemplate = `function cosmosh_phase
  printf '{"type":"bootstrap-status","phase":"%s","state":"%s","version":"%s","message":"%s"}\n' $argv[1] $argv[2] "{{.Version}}" $argv[3]
end
function cosmosh_fail
  printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\n' $argv[1] "{{.Version}}" $argv[2] $argv[3]
  exit 1
end
set cosmosh_tmp (mktemp -d "/tmp/cosmosh-bootstrap-{{.Version}}.XXXXXX")
set cosmosh_bin "$cosmosh_tmp/cosmosh-bootstrap"
cosmosh_phase download started "downloading bootstrap binary"
if command -q curl
  curl -fsSL "{{.AssetURL}}" -o "$cosmosh_bin"; or cosmosh_fail download DOWNLOAD_FAILED "curl download failed"
else if command -q wget
  wget -q -O "$cosmosh_bin" "{{.AssetURL}}"; or cosmosh_fail download DOWNLOAD_FAILED "wget download failed"
else
  cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"
end
cosmosh_phase verify started "verifying bootstrap binary"
if command -q sha256sum
  printf '%s  %s\n' "{{.SHA256}}" "$cosmosh_bin" | sha256sum -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"
else if command -q shasum
  printf '%s  %s\n' "{{.SHA256}}" "$cosmosh_bin" | shasum -a 256 -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"
else
  cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"
end
chmod 700 "$cosmosh_bin"
cosmosh_phase install started "installing bootstrap helper"
"$cosmosh_bin" install --shell "{{.Shell}}" --version "{{.Version}}" --helper-payload-b64 "{{.HelperPayloadB64}}"
`

// Generate returns a shell-specific bootstrap wrapper script.
func Generate(config Config) (string, error) {
	normalized, err := normalize(config)
	if err != nil {
		return "", err
	}

	source := posixTemplate
	if normalized.Shell == "fish" {
		source = fishTemplate
	}

	tmpl, err := template.New("wrapper").Parse(source)
	if err != nil {
		return "", err
	}

	var buffer bytes.Buffer
	if err := tmpl.Execute(&buffer, normalized); err != nil {
		return "", err
	}

	return buffer.String(), nil
}

func normalize(config Config) (Config, error) {
	config.Shell = strings.TrimSpace(config.Shell)
	config.TargetOS = strings.TrimSpace(config.TargetOS)
	config.TargetArch = strings.TrimSpace(config.TargetArch)
	config.Version = strings.TrimSpace(config.Version)
	config.AssetURL = strings.TrimSpace(config.AssetURL)
	config.SHA256 = strings.ToLower(strings.TrimSpace(config.SHA256))
	config.HelperPayloadB64 = strings.TrimSpace(config.HelperPayloadB64)

	if !supportedShells[config.Shell] {
		return Config{}, fmt.Errorf("unsupported shell: %s", config.Shell)
	}

	if config.TargetOS != "linux" {
		return Config{}, fmt.Errorf("unsupported target os: %s", config.TargetOS)
	}

	if config.TargetArch != "amd64" && config.TargetArch != "arm64" {
		return Config{}, fmt.Errorf("unsupported target arch: %s", config.TargetArch)
	}

	if config.Version == "" || config.AssetURL == "" || config.HelperPayloadB64 == "" {
		return Config{}, errors.New("version, asset url, and helper payload are required")
	}

	if len(config.SHA256) != 64 {
		return Config{}, errors.New("sha256 must be 64 lowercase hex characters")
	}

	return config, nil
}
