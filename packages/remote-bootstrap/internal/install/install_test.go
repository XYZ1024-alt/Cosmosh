package install

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunInstallsUserScopedFiles(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte("export COSMOSH_BOOTSTRAP_READY=1\n"))
	stdout := bytes.Buffer{}
	err := Run(Options{
		Shell:            "sh",
		Version:          "1.2.3",
		HelperPayloadB64: payload,
		Stdout:           &stdout,
	})
	if err != nil {
		t.Fatal(err)
	}

	assertFileContains(t, filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh"), "COSMOSH_BOOTSTRAP_READY")
	assertFileContains(t, filepath.Join(homeDir, ".profile"), markerStart)
	assertFileContains(t, filepath.Join(homeDir, ".profile"), "helper.sh")
	if !strings.Contains(stdout.String(), `"state":"ok"`) {
		t.Fatalf("expected ok status, got %s", stdout.String())
	}
}

func TestRunInstallsBashProfile(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte("export COSMOSH_BOOTSTRAP_READY=1\n"))
	err := Run(Options{
		Shell:            "bash",
		Version:          "1.2.3",
		HelperPayloadB64: payload,
		Stdout:           &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	assertFileContains(t, filepath.Join(homeDir, ".bashrc"), markerStart)
	assertFileContains(t, filepath.Join(homeDir, ".bashrc"), "helper.sh")
}

func TestRunSkipsCurrentInstall(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte("export COSMOSH_BOOTSTRAP_READY=1\n"))
	options := Options{Shell: "sh", Version: "1.2.3", HelperPayloadB64: payload, Stdout: &bytes.Buffer{}}
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	stdout := bytes.Buffer{}
	options.Stdout = &stdout
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(stdout.String(), `"state":"skipped"`) {
		t.Fatalf("expected skipped status, got %s", stdout.String())
	}
}

func TestReplaceMarkedBlockIsIdempotent(t *testing.T) {
	existing := "before\n" + markerStart + "\nold\n" + markerEnd + "\nafter\n"
	next := replaceMarkedBlock(existing, "new\n")

	if strings.Contains(next, "old") {
		t.Fatalf("expected old block to be replaced: %s", next)
	}

	if strings.Count(next, markerStart) != 1 {
		t.Fatalf("expected exactly one marker block: %s", next)
	}
}

func TestRunRejectsInvalidPayload(t *testing.T) {
	stdout := bytes.Buffer{}
	err := Run(Options{
		Shell:            "sh",
		Version:          "1.2.3",
		HelperPayloadB64: "not-base64",
		Stdout:           &stdout,
	})
	if err == nil {
		t.Fatal("expected invalid payload error")
	}

	if !strings.Contains(stdout.String(), `"code":"INVALID_OPTIONS"`) {
		t.Fatalf("expected invalid options status, got %s", stdout.String())
	}
}

func assertFileContains(t *testing.T, path string, expected string) {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(string(content), expected) {
		t.Fatalf("expected %s to contain %q", path, expected)
	}
}
