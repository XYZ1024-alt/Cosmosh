package wrapper

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"regexp"
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

type renderConfig struct {
	ShellLiteral            string
	VersionLiteral          string
	AssetURLLiteral         string
	SHA256Literal           string
	HelperPayloadB64Literal string
}

var supportedShells = map[string]bool{
	"ash":  true,
	"bash": true,
	"fish": true,
	"sh":   true,
	"zsh":  true,
}

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var versionPattern = regexp.MustCompile(`^[A-Za-z0-9._+-]+$`)

const posixTemplate = `set -eu
cosmosh_shell={{.ShellLiteral}}
cosmosh_version={{.VersionLiteral}}
cosmosh_asset_url={{.AssetURLLiteral}}
cosmosh_sha256={{.SHA256Literal}}
cosmosh_helper_payload_b64={{.HelperPayloadB64Literal}}
cosmosh_phase() { printf '{"type":"bootstrap-status","phase":"%s","state":"%s","version":"%s","message":"%s"}\n' "$1" "$2" "$cosmosh_version" "$3"; }
cosmosh_fail() { printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\n' "$1" "$cosmosh_version" "$2" "$3"; exit 1; }
if ! command -v mktemp >/dev/null 2>&1; then cosmosh_fail download MKTEMP_NOT_FOUND "mktemp is required"; fi
umask 077
cosmosh_tmp="$(mktemp -d "${TMPDIR:-/tmp}/cosmosh-bootstrap.XXXXXX")" || cosmosh_fail download MKTEMP_FAILED "mktemp failed"
trap 'rm -rf "$cosmosh_tmp"' EXIT HUP INT TERM
cosmosh_bin="$cosmosh_tmp/cosmosh-bootstrap"
cosmosh_phase download started "downloading bootstrap binary"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$cosmosh_asset_url" -o "$cosmosh_bin" || cosmosh_fail download DOWNLOAD_FAILED "curl download failed"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$cosmosh_bin" "$cosmosh_asset_url" || cosmosh_fail download DOWNLOAD_FAILED "wget download failed"
else
  cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"
fi
cosmosh_phase verify started "verifying bootstrap binary"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$cosmosh_sha256" "$cosmosh_bin" | sha256sum -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"
elif command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "$cosmosh_sha256" "$cosmosh_bin" | shasum -a 256 -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"
else
  cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"
fi
chmod 700 "$cosmosh_bin"
cosmosh_phase install started "installing bootstrap helper"
"$cosmosh_bin" install --shell "$cosmosh_shell" --version "$cosmosh_version" --helper-payload-b64 "$cosmosh_helper_payload_b64"
`

const fishTemplate = `function cosmosh_phase
  printf '{"type":"bootstrap-status","phase":"%s","state":"%s","version":"%s","message":"%s"}\n' $argv[1] $argv[2] "$cosmosh_version" $argv[3]
end
function cosmosh_fail
  printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\n' $argv[1] "$cosmosh_version" $argv[2] $argv[3]
  exit 1
end
set cosmosh_shell {{.ShellLiteral}}
set cosmosh_version {{.VersionLiteral}}
set cosmosh_asset_url {{.AssetURLLiteral}}
set cosmosh_sha256 {{.SHA256Literal}}
set cosmosh_helper_payload_b64 {{.HelperPayloadB64Literal}}
if not command -q mktemp
  cosmosh_fail download MKTEMP_NOT_FOUND "mktemp is required"
end
set cosmosh_tmpdir "$TMPDIR"
if test -z "$cosmosh_tmpdir"
  set cosmosh_tmpdir /tmp
end
umask 077
set cosmosh_tmp (mktemp -d "$cosmosh_tmpdir/cosmosh-bootstrap.XXXXXX"); or cosmosh_fail download MKTEMP_FAILED "mktemp failed"
function cosmosh_cleanup --on-event fish_exit
  rm -rf "$cosmosh_tmp"
end
set cosmosh_bin "$cosmosh_tmp/cosmosh-bootstrap"
cosmosh_phase download started "downloading bootstrap binary"
if command -q curl
  curl -fsSL "$cosmosh_asset_url" -o "$cosmosh_bin"; or cosmosh_fail download DOWNLOAD_FAILED "curl download failed"
else if command -q wget
  wget -q -O "$cosmosh_bin" "$cosmosh_asset_url"; or cosmosh_fail download DOWNLOAD_FAILED "wget download failed"
else
  cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"
end
cosmosh_phase verify started "verifying bootstrap binary"
if command -q sha256sum
  printf '%s  %s\n' "$cosmosh_sha256" "$cosmosh_bin" | sha256sum -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"
else if command -q shasum
  printf '%s  %s\n' "$cosmosh_sha256" "$cosmosh_bin" | shasum -a 256 -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"
else
  cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"
end
chmod 700 "$cosmosh_bin"
cosmosh_phase install started "installing bootstrap helper"
"$cosmosh_bin" install --shell "$cosmosh_shell" --version "$cosmosh_version" --helper-payload-b64 "$cosmosh_helper_payload_b64"
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
	if err := tmpl.Execute(&buffer, buildRenderConfig(normalized)); err != nil {
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
	config.SHA256 = strings.TrimSpace(config.SHA256)
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

	if !versionPattern.MatchString(config.Version) {
		return Config{}, errors.New("version must contain only letters, digits, dots, underscores, plus signs, or hyphens")
	}

	if !isHTTPSURL(config.AssetURL) {
		return Config{}, errors.New("asset url must be a valid https url")
	}

	if !sha256Pattern.MatchString(config.SHA256) {
		return Config{}, errors.New("sha256 must be 64 lowercase hex characters")
	}

	return config, nil
}

func isHTTPSURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

// buildRenderConfig converts validated wrapper inputs into shell-safe template data.
func buildRenderConfig(config Config) renderConfig {
	if config.Shell == "fish" {
		return renderConfig{
			ShellLiteral:            quoteFish(config.Shell),
			VersionLiteral:          quoteFish(config.Version),
			AssetURLLiteral:         quoteFish(config.AssetURL),
			SHA256Literal:           quoteFish(config.SHA256),
			HelperPayloadB64Literal: quoteFish(config.HelperPayloadB64),
		}
	}

	return renderConfig{
		ShellLiteral:            quotePOSIX(config.Shell),
		VersionLiteral:          quotePOSIX(config.Version),
		AssetURLLiteral:         quotePOSIX(config.AssetURL),
		SHA256Literal:           quotePOSIX(config.SHA256),
		HelperPayloadB64Literal: quotePOSIX(config.HelperPayloadB64),
	}
}

// quotePOSIX converts data into a POSIX single-quoted shell literal.
func quotePOSIX(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

// quoteFish converts data into a fish single-quoted shell literal.
func quoteFish(value string) string {
	var builder strings.Builder
	builder.WriteByte('\'')

	for _, char := range value {
		if char == '\\' || char == '\'' {
			builder.WriteByte('\\')
		}
		builder.WriteRune(char)
	}

	builder.WriteByte('\'')
	return builder.String()
}
