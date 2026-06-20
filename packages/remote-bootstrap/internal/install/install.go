package install

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	binaryFileName = "cosmosh-bootstrap"
	markerStart    = "# >>> cosmosh bootstrap >>>"
	markerEnd      = "# <<< cosmosh bootstrap <<<"
)

// Options contains immutable install command inputs.
type Options struct {
	Shell            string
	Version          string
	HelperPayloadB64 string
	Stdout           io.Writer
}

type statusLine struct {
	Type    string `json:"type"`
	Phase   string `json:"phase"`
	State   string `json:"state"`
	Version string `json:"version,omitempty"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type paths struct {
	binDir      string
	binaryPath  string
	versionPath string
	helperDir   string
	helperPath  string
	profilePath string
}

// Run installs the current bootstrap binary and shell helper into user scope.
func Run(options Options) error {
	if err := validateOptions(options); err != nil {
		writeStatus(options.Stdout, "install", "failed", options.Version, "INVALID_OPTIONS", err.Error())
		return err
	}

	resolvedPaths, err := resolvePaths(options.Shell)
	if err != nil {
		writeStatus(options.Stdout, "install", "failed", options.Version, "PATH_RESOLVE_FAILED", err.Error())
		return err
	}

	if isCurrentInstallation(options, resolvedPaths) {
		writeStatus(options.Stdout, "install", "skipped", options.Version, "", "bootstrap already current")
		return nil
	}

	if err := installFiles(options, resolvedPaths); err != nil {
		writeStatus(options.Stdout, "install", "failed", options.Version, "FILE_INSTALL_FAILED", err.Error())
		return err
	}

	if err := updateProfile(options, resolvedPaths); err != nil {
		writeStatus(options.Stdout, "install", "failed", options.Version, "PROFILE_UPDATE_FAILED", err.Error())
		return err
	}

	writeStatus(options.Stdout, "verify", "ok", options.Version, "", "bootstrap installed")
	return nil
}

// Status prints the resolved user-scope bootstrap paths.
func Status(stdout io.Writer, shell string) error {
	resolvedPaths, err := resolvePaths(shell)
	if err != nil {
		return err
	}

	payload := map[string]string{
		"binaryPath":  resolvedPaths.binaryPath,
		"helperPath":  resolvedPaths.helperPath,
		"profilePath": resolvedPaths.profilePath,
	}

	return json.NewEncoder(stdout).Encode(payload)
}

func validateOptions(options Options) error {
	if options.Version == "" {
		return errors.New("version is required")
	}

	if options.HelperPayloadB64 == "" {
		return errors.New("helper payload is required")
	}

	_, err := base64.StdEncoding.DecodeString(options.HelperPayloadB64)
	if err != nil {
		return fmt.Errorf("helper payload must be base64: %w", err)
	}

	return validateShell(options.Shell)
}

func validateShell(shell string) error {
	switch shell {
	case "ash", "bash", "fish", "sh", "zsh":
		return nil
	default:
		return fmt.Errorf("unsupported shell: %s", shell)
	}
}

func resolvePaths(shell string) (paths, error) {
	if err := validateShell(shell); err != nil {
		return paths{}, err
	}

	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		return paths{}, errors.New("home directory is unavailable")
	}

	dataRoot := envOrDefault("XDG_DATA_HOME", filepath.Join(homeDir, ".local", "share"))
	configRoot := envOrDefault("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	helperDir := filepath.Join(configRoot, "cosmosh", "bootstrap")
	return paths{
		binDir:      filepath.Join(dataRoot, "cosmosh", "bootstrap", "bin"),
		binaryPath:  filepath.Join(dataRoot, "cosmosh", "bootstrap", "bin", binaryFileName),
		versionPath: filepath.Join(dataRoot, "cosmosh", "bootstrap", "bin", ".version"),
		helperDir:   helperDir,
		helperPath:  filepath.Join(helperDir, helperName(shell)),
		profilePath: resolveProfilePath(homeDir, configRoot, shell),
	}, nil
}

func isCurrentInstallation(options Options, resolvedPaths paths) bool {
	versionBytes, err := os.ReadFile(resolvedPaths.versionPath)
	if err != nil || strings.TrimSpace(string(versionBytes)) != options.Version {
		return false
	}

	for _, requiredPath := range []string{resolvedPaths.binaryPath, resolvedPaths.helperPath, resolvedPaths.profilePath} {
		if _, err := os.Stat(requiredPath); err != nil {
			return false
		}
	}

	return true
}

func installFiles(options Options, resolvedPaths paths) error {
	if err := os.MkdirAll(resolvedPaths.binDir, 0o700); err != nil {
		return err
	}

	if err := os.MkdirAll(resolvedPaths.helperDir, 0o700); err != nil {
		return err
	}

	currentBinary, err := os.Executable()
	if err != nil {
		return err
	}

	if err := copyFile(currentBinary, resolvedPaths.binaryPath, 0o700); err != nil {
		return err
	}

	helperBytes, err := base64.StdEncoding.DecodeString(options.HelperPayloadB64)
	if err != nil {
		return err
	}

	if err := os.WriteFile(resolvedPaths.helperPath, helperBytes, 0o600); err != nil {
		return err
	}

	return os.WriteFile(resolvedPaths.versionPath, []byte(options.Version+"\n"), 0o600)
}

func updateProfile(options Options, resolvedPaths paths) error {
	if options.Shell == "fish" {
		return writeFishProfile(resolvedPaths)
	}

	existing := ""
	if bytes, err := os.ReadFile(resolvedPaths.profilePath); err == nil {
		existing = string(bytes)
	}

	nextContent := replaceMarkedBlock(existing, posixProfileBlock(resolvedPaths))
	return os.WriteFile(resolvedPaths.profilePath, []byte(nextContent), 0o600)
}

func writeFishProfile(resolvedPaths paths) error {
	if err := os.MkdirAll(filepath.Dir(resolvedPaths.profilePath), 0o700); err != nil {
		return err
	}

	block := fmt.Sprintf("set -gx PATH %q $PATH\nsource %q\n", resolvedPaths.binDir, resolvedPaths.helperPath)
	return os.WriteFile(resolvedPaths.profilePath, []byte(block), 0o600)
}

func replaceMarkedBlock(existing string, block string) string {
	startIndex := strings.Index(existing, markerStart)
	endIndex := strings.Index(existing, markerEnd)
	markedBlock := markerStart + "\n" + block + markerEnd + "\n"

	if startIndex >= 0 && endIndex > startIndex {
		endIndex += len(markerEnd)
		remaining := strings.TrimLeft(existing[endIndex:], "\r\n")
		return existing[:startIndex] + markedBlock + remaining
	}

	separator := "\n"
	if strings.TrimSpace(existing) == "" {
		separator = ""
	}

	return existing + separator + markedBlock
}

func posixProfileBlock(resolvedPaths paths) string {
	return fmt.Sprintf("export PATH=%q:$PATH\n. %q\n", resolvedPaths.binDir, resolvedPaths.helperPath)
}

func copyFile(sourcePath string, targetPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer target.Close()

	_, err = io.Copy(target, source)
	return err
}

func envOrDefault(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	return value
}

func helperName(shell string) string {
	if shell == "fish" {
		return "helper.fish"
	}

	return "helper.sh"
}

func resolveProfilePath(homeDir string, configRoot string, shell string) string {
	if shell == "fish" {
		return filepath.Join(configRoot, "fish", "conf.d", "cosmosh.fish")
	}

	if shell == "zsh" {
		return filepath.Join(homeDir, ".zshrc")
	}

	if shell == "bash" {
		return filepath.Join(homeDir, ".bashrc")
	}

	return filepath.Join(homeDir, ".profile")
}

func writeStatus(stdout io.Writer, phase string, state string, version string, code string, message string) {
	if stdout == nil {
		stdout = os.Stdout
	}

	_ = json.NewEncoder(stdout).Encode(statusLine{
		Type:    "bootstrap-status",
		Phase:   phase,
		State:   state,
		Version: version,
		Code:    code,
		Message: message,
	})
}
