package wrapper

import (
	"strings"
	"testing"
)

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
	assertContains(t, script, "install --shell \"sh\"")
	assertContains(t, script, "\"type\":\"bootstrap-status\"")
}

func TestGenerateFishWrapper(t *testing.T) {
	script, err := Generate(validConfig("fish"))
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, script, "function cosmosh_phase")
	assertContains(t, script, "command -q curl")
	assertContains(t, script, "install --shell \"fish\"")
	assertContains(t, script, "\"type\":\"bootstrap-status\"")
}

func TestGenerateRejectsUnsupportedPlatform(t *testing.T) {
	config := validConfig("sh")
	config.TargetOS = "darwin"

	_, err := Generate(config)
	if err == nil {
		t.Fatal("expected unsupported platform error")
	}
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()

	if !strings.Contains(value, expected) {
		t.Fatalf("expected %q to contain %q", value, expected)
	}
}
