package wrapper

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const adversarialAssetURL = "https://downloads.example.test/cosmosh%20bootstrap$(printf%20pwn)`whoami`'\";?line=%0Aafter"

func validConfig(shell string) Config {
	return Config{
		Shell:            shell,
		TargetOS:         "linux",
		TargetArch:       "amd64",
		Version:          "1.2.3",
		AssetURL:         "https://downloads.example.test/cosmosh-bootstrap",
		SHA256:           "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		HelperPayloadB64: "ZXhwb3J0IENPU01PU0hfQk9PVFNUUkFQX0VOQUJMRUQ9MQo=",
	}
}

func TestGeneratePosixWrapper(t *testing.T) {
	script, err := Generate(validConfig("sh"))
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "set -eu")
	assertContains(t, script, "sha256sum -c -")
	assertContains(t, script, "install --shell \"$cosmosh_shell\"")
	assertContains(t, script, "\"type\":\"bootstrap-status\"")
}

func TestGenerateBashWrapper(t *testing.T) {
	script, err := Generate(validConfig("bash"))
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "set -eu")
	assertContains(t, script, "install --shell \"$cosmosh_shell\"")
	assertContains(t, script, "\"type\":\"bootstrap-status\"")
}

func TestGenerateFishWrapper(t *testing.T) {
	script, err := Generate(validConfig("fish"))
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "function cosmosh_phase")
	assertContains(t, script, "command -q curl")
	assertContains(t, script, "install --shell \"$cosmosh_shell\"")
	assertContains(t, script, "\"type\":\"bootstrap-status\"")
}

func TestGeneratePosixWrapperQuotesAdversarialAssetURL(t *testing.T) {
	config := validConfig("sh")
	config.AssetURL = adversarialAssetURL

	script, err := Generate(config)
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "cosmosh_asset_url='https://downloads.example.test/")
	assertContains(t, script, "curl -fsSL \"$cosmosh_asset_url\"")
	assertContains(t, script, "wget -q -O \"$cosmosh_bin\" \"$cosmosh_asset_url\"")
	assertContains(t, script, "mktemp -d \"${TMPDIR:-/tmp}/cosmosh-bootstrap.XXXXXX\"")
	assertContains(t, script, "trap 'rm -rf \"$cosmosh_tmp\"'")
	assertNotContains(t, script, "curl -fsSL \"https://")
	assertNotContains(t, script, "wget -q -O \"$cosmosh_bin\" \"https://")
	assertNotContains(t, script, "cosmosh-bootstrap-1.2.3-$$")
	assertNotContains(t, script, "mkdir -p \"$cosmosh_tmp\"")
}

func TestGenerateFishWrapperQuotesAdversarialAssetURL(t *testing.T) {
	config := validConfig("fish")
	config.AssetURL = adversarialAssetURL

	script, err := Generate(config)
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "set cosmosh_asset_url 'https://downloads.example.test/")
	assertContains(t, script, "curl -fsSL \"$cosmosh_asset_url\"")
	assertContains(t, script, "wget -q -O \"$cosmosh_bin\" \"$cosmosh_asset_url\"")
	assertContains(t, script, "mktemp -d \"$cosmosh_tmpdir/cosmosh-bootstrap.XXXXXX\"")
	assertContains(t, script, "function cosmosh_cleanup --on-event fish_exit")
	assertNotContains(t, script, "curl -fsSL \"https://")
	assertNotContains(t, script, "wget -q -O \"$cosmosh_bin\" \"https://")
	assertNotContains(t, script, "cosmosh-bootstrap-1.2.3")
}

func TestGeneratePosixWrapperTreatsAdversarialURLAsData(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell execution test requires POSIX filesystem semantics")
	}

	shPath, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("POSIX shell execution test requires sh")
	}

	tempDir := t.TempDir()
	binDir := filepath.Join(tempDir, "bin")
	tmpDir := filepath.Join(tempDir, "tmp")
	outputPath := filepath.Join(tempDir, "download-url.txt")
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "curl"), fakeCurlScript())
	writeExecutable(t, filepath.Join(binDir, "sha256sum"), fakeHashScript())

	config := validConfig("sh")
	config.AssetURL = "https://downloads.example.test/cosmosh$(touch${IFS}injected-marker)`touch${IFS}backtick-marker`'\";?line=%0Aafter"
	script, err := Generate(config)
	if err != nil {
		t.Fatal(err)
	}

	scriptPath := filepath.Join(tempDir, "wrapper.sh")
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(shPath, scriptPath)
	command.Dir = tempDir
	command.Env = append(os.Environ(),
		"FAKE_TOOL_OUTPUT="+outputPath,
		"PATH="+binDir+string(os.PathListSeparator)+os.Getenv("PATH"),
		"TMPDIR="+tmpDir,
	)

	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("expected wrapper execution to succeed: %v\n%s", err, string(output))
	}

	capturedURL, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, string(output), `"type":"bootstrap-status"`)
	assertContains(t, string(capturedURL), config.AssetURL)
	assertFileNotExists(t, filepath.Join(tempDir, "injected-marker"))
	assertFileNotExists(t, filepath.Join(tempDir, "backtick-marker"))
}

func TestGenerateRejectsUnsupportedPlatform(t *testing.T) {
	config := validConfig("sh")
	config.TargetOS = "darwin"

	_, err := Generate(config)
	if err == nil {
		t.Fatal("expected unsupported platform error")
	}
}

func TestGenerateAcceptsManifestVersionGrammar(t *testing.T) {
	config := validConfig("sh")
	config.Version = "dev-ABC_123+meta.4"

	if _, err := Generate(config); err != nil {
		t.Fatalf("expected valid version to be accepted: %v", err)
	}
}

func TestGenerateRejectsInvalidVersion(t *testing.T) {
	for _, version := range []string{
		`1.2"3`,
		"1.2\n3",
		"1.2 3",
		"1.2/3",
		"1.2$(touch marker)",
	} {
		config := validConfig("sh")
		config.Version = version

		_, err := Generate(config)
		if err == nil {
			t.Fatalf("expected version %q to be rejected", version)
		}
	}
}

func TestGenerateRejectsInvalidAssetURL(t *testing.T) {
	for _, assetURL := range []string{
		"http://downloads.example.test/cosmosh-bootstrap",
		"https://",
		"://downloads.example.test/cosmosh-bootstrap",
		"downloads.example.test/cosmosh-bootstrap",
		"https://downloads.example.test/cosmosh-bootstrap\nnext",
	} {
		config := validConfig("sh")
		config.AssetURL = assetURL

		_, err := Generate(config)
		if err == nil {
			t.Fatalf("expected asset url %q to be rejected", assetURL)
		}
	}
}

func TestGenerateRejectsInvalidSHA256(t *testing.T) {
	for _, sha256 := range []string{
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde",
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg",
		"0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
	} {
		config := validConfig("sh")
		config.SHA256 = sha256

		_, err := Generate(config)
		if err == nil {
			t.Fatalf("expected sha256 %q to be rejected", sha256)
		}
	}
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()

	if !strings.Contains(value, expected) {
		t.Fatalf("expected %q to contain %q", value, expected)
	}
}

func assertNotContains(t *testing.T, value string, unexpected string) {
	t.Helper()

	if strings.Contains(value, unexpected) {
		t.Fatalf("expected %q not to contain %q", value, unexpected)
	}
}

func writeExecutable(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		t.Fatal(err)
	}
}

func fakeCurlScript() string {
	return `#!/bin/sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      shift
      out="$1"
      ;;
    -*)
      ;;
    *)
      url="$1"
      ;;
  esac
  shift
done
printf '%s\n' "$url" > "$FAKE_TOOL_OUTPUT"
cat > "$out" <<'EOF'
#!/bin/sh
printf '{"type":"bootstrap-status","phase":"install","state":"ok","version":"1.2.3"}\n'
EOF
chmod 700 "$out"
`
}

func fakeHashScript() string {
	return `#!/bin/sh
cat >/dev/null
exit 0
`
}

func assertFileNotExists(t *testing.T, path string) {
	t.Helper()

	_, err := os.Stat(path)
	if err == nil {
		t.Fatalf("expected %q not to exist", path)
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected %q stat to report non-existence: %v", path, err)
	}
}
