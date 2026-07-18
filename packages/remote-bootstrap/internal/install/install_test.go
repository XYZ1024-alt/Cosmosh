package install

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
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

	stdout := bytes.Buffer{}
	err := Run(Options{
		Shell:   "sh",
		Version: "1.2.3",
		Stdout:  &stdout,
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

	err := Run(Options{
		Shell:   "bash",
		Version: "1.2.3",
		Stdout:  &bytes.Buffer{},
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

	err := Run(Options{
		Shell:   "bash",
		Version: "1.2.3",
		Stdout:  &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
	assertFileContains(t, helperPath, "__cosmosh_emit_remote_shell_event")
	assertFileContains(t, helperPath, "PROMPT_COMMAND='__cosmosh_bash_prompt_command; __cosmosh_bash_arm_preexec'")
	assertFileContains(t, helperPath, `__COSMOSH_BASH_PREV_PROMPT_COMMAND="$PROMPT_COMMAND"`)
	assertFileContains(t, helperPath, `PROMPT_COMMAND='__cosmosh_bash_prompt_command; eval "$__COSMOSH_BASH_PREV_PROMPT_COMMAND"; __cosmosh_bash_arm_preexec'`)
	assertFileNotContains(t, helperPath, `PROMPT_COMMAND="__cosmosh_bash_prompt_command; ${PROMPT_COMMAND}; __cosmosh_bash_arm_preexec"`)
	assertFileContains(t, helperPath, "trap '__cosmosh_bash_debug_trap' DEBUG")
	assertFileContains(t, helperPath, "command-end")
	assertFileContains(t, helperPath, "command-start")
	assertFileContains(t, helperPath, "foreground-command")
	assertFileContains(t, helperPath, `\"helperVersion\":\"$__COSMOSH_HELPER_VERSION\"`)
	assertFileContains(t, helperPath, `\"protocolVersion\":$__COSMOSH_PROTOCOL_VERSION`)
	assertFileContains(t, helperPath, `\"capabilities\":$__COSMOSH_CAPABILITIES_JSON`)
}

func TestBashHelperPreservesPromptCommandWithTrailingSeparator(t *testing.T) {
	bashPath, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash is unavailable")
	}

	helper, err := BuildHelper("bash", "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	script := "PROMPT_COMMAND='history -a;'\nHISTFILE=/dev/null\n" + helper + "\neval \"$PROMPT_COMMAND\"\n"
	command := exec.Command(bashPath, "--noprofile", "--norc", "-c", script)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("expected trailing prompt separator to remain valid: %v\n%s", err, output)
	}
}

func TestRunInstallsZshRemoteShellHelperHooks(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	err := Run(Options{
		Shell:   "zsh",
		Version: "1.2.3",
		Stdout:  &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
	assertFileContains(t, filepath.Join(homeDir, ".zshrc"), markerStart)
	assertFileContains(t, helperPath, "add-zsh-hook precmd __cosmosh_zsh_precmd")
	assertFileContains(t, helperPath, "add-zsh-hook chpwd __cosmosh_zsh_chpwd")
	assertFileContains(t, helperPath, "add-zsh-hook preexec __cosmosh_zsh_preexec")
	assertFileContains(t, helperPath, "command-start")
	assertFileContains(t, helperPath, "foreground-command")
}

func TestRunInstallsFishRemoteShellHelperHooks(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	err := Run(Options{
		Shell:   "fish",
		Version: "1.2.3",
		Stdout:  &bytes.Buffer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.fish")
	assertFileContains(t, helperPath, "__cosmosh_emit_remote_shell_event")
	assertFileContains(t, helperPath, "--on-event fish_prompt")
	assertFileContains(t, helperPath, "--on-event fish_preexec")
	assertFileContains(t, helperPath, "--on-event fish_postexec")
	assertFileContains(t, helperPath, "--on-variable PWD")
	assertFileContains(t, helperPath, "command-start")
	assertFileContains(t, helperPath, "foreground-command")
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

			err := Run(Options{
				Shell:   shell,
				Version: "1.2.3",
				Stdout:  &bytes.Buffer{},
			})
			if err != nil {
				t.Fatal(err)
			}

			helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
			assertFileContains(t, helperPath, "PS1='$(__cosmosh_prompt_ready")
			assertFileContains(t, helperPath, "command-end")
			assertFileContains(t, helperPath, `__COSMOSH_CAPABILITIES_JSON='["cwd","command-end","prompt-ready"]'`)
			assertFileNotContains(t, helperPath, `__cosmosh_emit_command_start "$1"`)
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

	options := Options{Shell: "sh", Version: "1.2.3", Stdout: &bytes.Buffer{}}
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

	options := Options{Shell: "sh", Version: "1.2.3", Stdout: &bytes.Buffer{}}
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

	err := Run(Options{Shell: "bash", Version: "1.2.3", Stdout: &bytes.Buffer{}})
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

	options := Options{Shell: "fish", Version: "1.2.3", Stdout: &bytes.Buffer{}}
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

func TestRunRepairsTamperedHelper(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	options := Options{Shell: "bash", Version: "1.2.3", Stdout: &bytes.Buffer{}}
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	helperPath := filepath.Join(configDir, "cosmosh", "bootstrap", "helper.sh")
	if err := os.WriteFile(helperPath, []byte("stale helper\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stdout := bytes.Buffer{}
	options.Stdout = &stdout
	if err := Run(options); err != nil {
		t.Fatal(err)
	}

	if strings.Contains(stdout.String(), `"state":"skipped"`) {
		t.Fatalf("expected helper repair instead of skipped status, got %s", stdout.String())
	}
	assertFileContains(t, helperPath, "__COSMOSH_HELPER_VERSION='1.2.3'")
}

func TestStatusReportsValidatedRuntimeContract(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := filepath.Join(homeDir, "data")
	configDir := filepath.Join(homeDir, "config")
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("XDG_DATA_HOME", dataDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	if err := Run(Options{Shell: "bash", Version: "1.2.3", Stdout: &bytes.Buffer{}}); err != nil {
		t.Fatal(err)
	}

	stdout := bytes.Buffer{}
	if err := Status(&stdout, "bash"); err != nil {
		t.Fatal(err)
	}

	status := InstallationStatus{}
	if err := json.Unmarshal(stdout.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if !status.Installed || !status.HelperCurrent || !status.ProfileCurrent {
		t.Fatalf("expected current installation status, got %+v", status)
	}
	if status.Version != "1.2.3" || status.ProtocolVersion != RemoteShellProtocolVersion {
		t.Fatalf("expected versioned protocol status, got %+v", status)
	}
	if len(status.BinarySHA256) != 64 {
		t.Fatalf("expected installed binary sha256, got %+v", status)
	}
	if !containsString(status.Capabilities, "foreground-command") {
		t.Fatalf("expected foreground-command capability, got %+v", status.Capabilities)
	}
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

	stdout := bytes.Buffer{}
	err := Run(Options{Shell: "sh", Version: "1.2.3", Stdout: &stdout})
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

func TestRunRejectsInvalidVersion(t *testing.T) {
	stdout := bytes.Buffer{}
	err := Run(Options{
		Shell:   "sh",
		Version: "invalid version",
		Stdout:  &stdout,
	})
	if err == nil {
		t.Fatal("expected invalid version error")
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

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}

	return false
}
