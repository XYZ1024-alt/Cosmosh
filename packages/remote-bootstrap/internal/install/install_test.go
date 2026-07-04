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

func TestRunInstallsBashRemoteShellHelperHooks(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte(posixHelperPayload("bash")))
	err := Run(Options{
		Shell:            "bash",
		Version:          "1.2.3",
		HelperPayloadB64: payload,
		Stdout:           &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
	assertFileContains(t, helperPath, "__cosmosh_emit_remote_shell_event")
	assertFileContains(t, helperPath, "PROMPT_COMMAND='__cosmosh_bash_prompt_command'")
	assertFileContains(t, helperPath, "command-end")
	assertFileNotContains(t, helperPath, "command-start")
}

func TestRunInstallsZshRemoteShellHelperHooks(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte(posixHelperPayload("zsh")))
	err := Run(Options{
		Shell:            "zsh",
		Version:          "1.2.3",
		HelperPayloadB64: payload,
		Stdout:           &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
	assertFileContains(t, filepath.Join(homeDir, ".zshrc"), markerStart)
	assertFileContains(t, helperPath, "add-zsh-hook precmd __cosmosh_zsh_precmd")
	assertFileContains(t, helperPath, "add-zsh-hook chpwd __cosmosh_zsh_chpwd")
	assertFileNotContains(t, helperPath, "command-start")
}

func TestRunInstallsFishRemoteShellHelperHooks(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte(fishHelperPayload()))
	err := Run(Options{
		Shell:            "fish",
		Version:          "1.2.3",
		HelperPayloadB64: payload,
		Stdout:           &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.fish")
	assertFileContains(t, helperPath, "__cosmosh_emit_remote_shell_event")
	assertFileContains(t, helperPath, "--on-event fish_prompt")
	assertFileContains(t, helperPath, "--on-event fish_postexec")
	assertFileContains(t, helperPath, "--on-variable PWD")
	assertFileNotContains(t, helperPath, "command-start")
}

func TestRunInstallsShAshDegradedPromptHooks(t *testing.T) {
	for _, shell := range []string{"sh", "ash"} {
		t.Run(shell, func(t *testing.T) {
			homeDir := t.TempDir()
			dataDir := filepath.Join(homeDir, "data")
			configDir := filepath.Join(homeDir, "config")
			t.Setenv("HOME", homeDir)
			t.Setenv("USERPROFILE", homeDir)
			t.Setenv("XDG_DATA_HOME", dataDir)
			t.Setenv("XDG_CONFIG_HOME", configDir)

			payload := base64.StdEncoding.EncodeToString([]byte(posixHelperPayload(shell)))
			err := Run(Options{
				Shell:            shell,
				Version:          "1.2.3",
				HelperPayloadB64: payload,
				Stdout:           &bytes.Buffer{},
			})
			if err != nil {
				t.Fatal(err)
			}

			helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
			assertFileContains(t, helperPath, "PS1='$(__cosmosh_prompt_ready")
			assertFileContains(t, helperPath, "command-end")
			assertFileNotContains(t, helperPath, "command-start")
		})
	}
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

func TestRunRepairsMissingPosixProfileHook(t *testing.T) {
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

	profilePath := filepath.Join(homeDir, ".profile")
	if err := os.WriteFile(profilePath, []byte("custom profile\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stdout := bytes.Buffer{}
	options.Stdout = &stdout
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	if strings.Contains(stdout.String(), `"state":"skipped"`) {
		t.Fatalf("expected hook repair instead of skipped status, got %s", stdout.String())
	}
	assertFileContains(t, profilePath, markerStart)
	assertFileContains(t, profilePath, "helper.sh")
}

func TestRunPreservesExistingProfileContentOutsideMarkerBlock(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	profilePath := filepath.Join(homeDir, ".bashrc")
	if err := os.WriteFile(profilePath, []byte("before hook\nalias ll='ls -al'\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	payload := base64.StdEncoding.EncodeToString([]byte(posixHelperPayload("bash")))
	err := Run(Options{Shell: "bash", Version: "1.2.3", HelperPayloadB64: payload, Stdout: &bytes.Buffer{}})
	if err != nil {
		t.Fatal(err)
	}

	assertFileContains(t, profilePath, "before hook")
	assertFileContains(t, profilePath, "alias ll='ls -al'")
	assertFileContains(t, profilePath, markerStart)
	assertFileContains(t, profilePath, "helper.sh")
}

func TestRunRepairsMissingFishProfileHook(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	payload := base64.StdEncoding.EncodeToString([]byte("set -gx COSMOSH_BOOTSTRAP_READY 1\n"))
	options := Options{Shell: "fish", Version: "1.2.3", HelperPayloadB64: payload, Stdout: &bytes.Buffer{}}
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	profilePath := filepath.Join(configDir, "fish", "conf.d", "cosmosh.fish")
	if err := os.WriteFile(profilePath, []byte("set -gx CUSTOM 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stdout := bytes.Buffer{}
	options.Stdout = &stdout
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	if strings.Contains(stdout.String(), `"state":"skipped"`) {
		t.Fatalf("expected fish hook repair instead of skipped status, got %s", stdout.String())
	}
	assertFileContains(t, profilePath, "helper.fish")
	assertFileContains(t, profilePath, "set -gx PATH")
}

func TestRunDoesNotWriteVersionWhenProfileUpdateFails(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	if err := os.Mkdir(filepath.Join(homeDir, ".profile"), 0o700); err != nil {
		t.Fatal(err)
	}

	payload := base64.StdEncoding.EncodeToString([]byte("export COSMOSH_BOOTSTRAP_READY=1\n"))
	stdout := bytes.Buffer{}
	err := Run(Options{Shell: "sh", Version: "1.2.3", HelperPayloadB64: payload, Stdout: &stdout})
	if err == nil {
		t.Fatal("expected profile update failure")
	}

	if !strings.Contains(stdout.String(), `"code":"PROFILE_UPDATE_FAILED"`) {
		t.Fatalf("expected profile update failure status, got %s", stdout.String())
	}
	assertFileNotExists(t, filepath.Join(dataDir, "cosmosh", "bootstrap", "bin", ".version"))
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

func assertFileNotContains(t *testing.T, path string, unexpected string) {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if strings.Contains(string(content), unexpected) {
		t.Fatalf("expected %s to not contain %q", path, unexpected)
	}
}

func assertFileNotExists(t *testing.T, path string) {
	t.Helper()

	if _, err := os.Stat(path); err == nil || !os.IsNotExist(err) {
		t.Fatalf("expected %s to not exist", path)
	}
}

func posixHelperPayload(shell string) string {
	if shell == "zsh" {
		return "__cosmosh_emit_remote_shell_event() { :; }\nadd-zsh-hook precmd __cosmosh_zsh_precmd\nadd-zsh-hook chpwd __cosmosh_zsh_chpwd\n# command-end\n"
	}
	if shell == "bash" {
		return "__cosmosh_emit_remote_shell_event() { :; }\nPROMPT_COMMAND='__cosmosh_bash_prompt_command'\n# command-end\n"
	}

	return "__cosmosh_emit_remote_shell_event() { :; }\nPS1='$(__cosmosh_prompt_ready \"$?\")'$PS1\n# command-end\n"
}

func fishHelperPayload() string {
	return "__cosmosh_emit_remote_shell_event\nfunction __cosmosh_on_prompt --on-event fish_prompt\nend\nfunction __cosmosh_on_postexec --on-event fish_postexec\nend\nfunction __cosmosh_on_pwd --on-variable PWD\nend\n"
}
