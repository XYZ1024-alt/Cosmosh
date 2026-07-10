package install

import (
	"fmt"
	"strings"
)

// RemoteShellProtocolVersion identifies the OSC event contract emitted by installed helpers.
const RemoteShellProtocolVersion = 1

var fullRemoteShellCapabilities = []string{
	"cwd",
	"command-start",
	"command-end",
	"foreground-command",
	"prompt-ready",
}

var degradedRemoteShellCapabilities = []string{
	"cwd",
	"command-end",
	"prompt-ready",
}

// HelperCapabilities returns the event capabilities installed for a shell.
func HelperCapabilities(shell string) []string {
	if shell == "sh" || shell == "ash" {
		return append([]string(nil), degradedRemoteShellCapabilities...)
	}

	return append([]string(nil), fullRemoteShellCapabilities...)
}

// BuildHelper creates the versioned shell integration owned by the Go bootstrap.
func BuildHelper(shell string, version string) (string, error) {
	if err := validateShell(shell); err != nil {
		return "", err
	}
	if version == "" {
		return "", fmt.Errorf("version is required")
	}

	if shell == "fish" {
		return buildFishHelper(version), nil
	}

	return buildPosixHelper(shell, version), nil
}

func buildPosixHelper(shell string, version string) string {
	capabilities := capabilitiesJSON(HelperCapabilities(shell))
	header := fmt.Sprintf(`# Cosmosh Remote Enhancements shell integration.
export COSMOSH_BOOTSTRAP_READY=1
__COSMOSH_REMOTE_SHELL=%s
__COSMOSH_HELPER_VERSION=%s
__COSMOSH_PROTOCOL_VERSION=%d
__COSMOSH_CAPABILITIES_JSON=%s
`, quotePOSIX(shell), quotePOSIX(version), RemoteShellProtocolVersion, quotePOSIX(capabilities))

	common := `
__cosmosh_json_escape() {
  if command -v sed >/dev/null 2>&1; then
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
    return
  fi

  return 1
}

__cosmosh_command_name_from_line() {
  __cosmosh_line="$1"
  __cosmosh_guard=0
  while [ "$__cosmosh_guard" -lt 8 ]; do
    __cosmosh_guard=$((__cosmosh_guard + 1))
    __cosmosh_line="$(printf '%s' "$__cosmosh_line" | sed 's/^[[:space:];|&(){}]*//')" || return 1
    __cosmosh_word="$(printf '%s' "$__cosmosh_line" | sed 's/[[:space:];|&(){}].*$//')" || return 1
    __cosmosh_word="$(printf '%s' "$__cosmosh_word" | sed "s/^[\"']//; s/[\"']$//")" || return 1
    case "$__cosmosh_word" in
      "")
        return 1
        ;;
      command|builtin|exec|env|noglob|time|*=*)
        __cosmosh_line="$(printf '%s' "$__cosmosh_line" | sed 's/^[^[:space:];|&(){}]*[[:space:]]*//')" || return 1
        continue
        ;;
    esac

    __cosmosh_name="${__cosmosh_word##*/}"
    case "$__cosmosh_name" in
      ""|__cosmosh_*|PROMPT_COMMAND|trap)
        return 1
        ;;
    esac

    printf '%s' "$__cosmosh_name"
    return 0
  done

  return 1
}

__cosmosh_emit_remote_shell_event() {
  [ -t 1 ] || return 0
  command -v base64 >/dev/null 2>&1 || return 0
  __cosmosh_event="$1"
  __cosmosh_status="${2:-}"
  __cosmosh_command="${3:-}"
  __cosmosh_timestamp="$(date +%s 2>/dev/null || printf '0')000"
  __cosmosh_cwd="$(__cosmosh_json_escape "$PWD" 2>/dev/null)" || return 0
  __cosmosh_json="{\"event\":\"$__cosmosh_event\",\"shell\":\"$__COSMOSH_REMOTE_SHELL\",\"helperVersion\":\"$__COSMOSH_HELPER_VERSION\",\"protocolVersion\":$__COSMOSH_PROTOCOL_VERSION,\"capabilities\":$__COSMOSH_CAPABILITIES_JSON,\"cwd\":\"$__cosmosh_cwd\",\"timestamp\":$__cosmosh_timestamp"
  if [ -n "$__cosmosh_command" ]; then
    __cosmosh_command="$(__cosmosh_json_escape "$__cosmosh_command" 2>/dev/null)" || return 0
    __cosmosh_json="$__cosmosh_json,\"command\":\"$__cosmosh_command\""
  fi
  if [ -n "$__cosmosh_status" ]; then
    __cosmosh_json="$__cosmosh_json,\"exitCode\":$__cosmosh_status"
  fi
  __cosmosh_json="$__cosmosh_json}"
  __cosmosh_payload="$(printf '%s' "$__cosmosh_json" | base64 | tr -d '\r\n')" || return 0
  printf '\033]777;cosmosh;%s\007' "$__cosmosh_payload"
}

__cosmosh_emit_command_start() {
  __cosmosh_command="$(__cosmosh_command_name_from_line "$1" 2>/dev/null)" || return 0
  [ -n "$__cosmosh_command" ] || return 0
  __cosmosh_emit_remote_shell_event command-start "" "$__cosmosh_command"
  __cosmosh_emit_remote_shell_event foreground-command "" "$__cosmosh_command"
}

__cosmosh_prompt_ready() {
  __cosmosh_status="$1"
  if [ "${__COSMOSH_REMOTE_SHELL_SEEN_PROMPT:-0}" = "1" ]; then
    __cosmosh_emit_remote_shell_event command-end "$__cosmosh_status"
  fi
  __COSMOSH_REMOTE_SHELL_SEEN_PROMPT=1
  __cosmosh_emit_remote_shell_event cwd ""
  __cosmosh_emit_remote_shell_event prompt-ready ""
}
`

	if shell == "bash" {
		return header + common + bashHelperHooks
	}
	if shell == "zsh" {
		return header + common + zshHelperHooks
	}

	return header + common + degradedPosixHelperHooks
}

const bashHelperHooks = `
__cosmosh_bash_prompt_command() {
  __cosmosh_status=$?
  __COSMOSH_BASH_PREEXEC_READY=0
  __cosmosh_prompt_ready "$__cosmosh_status"
}

__cosmosh_bash_arm_preexec() {
  __COSMOSH_BASH_PREEXEC_READY=1
}

if [ "${__COSMOSH_REMOTE_SHELL_HOOK_INSTALLED:-0}" != "1" ]; then
  __COSMOSH_REMOTE_SHELL_HOOK_INSTALLED=1
  __cosmosh_emit_remote_shell_event integration-ready ""
  case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
    declare\ -*a*PROMPT_COMMAND=*)
      PROMPT_COMMAND=(__cosmosh_bash_prompt_command "${PROMPT_COMMAND[@]}" __cosmosh_bash_arm_preexec)
      ;;
    *)
      if [ -n "${PROMPT_COMMAND:-}" ]; then
        PROMPT_COMMAND="__cosmosh_bash_prompt_command; ${PROMPT_COMMAND}; __cosmosh_bash_arm_preexec"
      else
        PROMPT_COMMAND='__cosmosh_bash_prompt_command; __cosmosh_bash_arm_preexec'
      fi
      ;;
  esac
  __COSMOSH_BASH_PREV_DEBUG_CMD="$(trap -p DEBUG | sed -n "s/^trap -- '\(.*\)' DEBUG$/\1/p")"
  __cosmosh_bash_debug_trap() {
    local __cosmosh_debug_status=$?
    local __cosmosh_debug_command="${BASH_COMMAND:-}"
    if [ "${__COSMOSH_BASH_DEBUG_ACTIVE:-0}" != "1" ] && [ "${__COSMOSH_BASH_PREEXEC_READY:-0}" = "1" ]; then
      case "$__cosmosh_debug_command" in
        ""|__cosmosh_*|PROMPT_COMMAND=*|trap\ *)
          ;;
        *)
          __COSMOSH_BASH_PREEXEC_READY=0
          __COSMOSH_BASH_DEBUG_ACTIVE=1
          __cosmosh_emit_command_start "$__cosmosh_debug_command"
          __COSMOSH_BASH_DEBUG_ACTIVE=0
          ;;
      esac
    fi
    if [ -n "${__COSMOSH_BASH_PREV_DEBUG_CMD:-}" ]; then
      __COSMOSH_BASH_DEBUG_ACTIVE=1
      eval "$__COSMOSH_BASH_PREV_DEBUG_CMD"
      __COSMOSH_BASH_DEBUG_ACTIVE=0
    fi
    return "$__cosmosh_debug_status"
  }
  trap '__cosmosh_bash_debug_trap' DEBUG
fi
`

const zshHelperHooks = `
if [ "${__COSMOSH_REMOTE_SHELL_HOOK_INSTALLED:-0}" != "1" ]; then
  __COSMOSH_REMOTE_SHELL_HOOK_INSTALLED=1
  __cosmosh_emit_remote_shell_event integration-ready ""
  __cosmosh_zsh_precmd() {
    __cosmosh_prompt_ready "$?"
  }
  __cosmosh_zsh_chpwd() {
    __cosmosh_emit_remote_shell_event cwd ""
  }
  __cosmosh_zsh_preexec() {
    __cosmosh_emit_command_start "$1"
  }
  if autoload -Uz add-zsh-hook 2>/dev/null; then
    add-zsh-hook precmd __cosmosh_zsh_precmd
    add-zsh-hook chpwd __cosmosh_zsh_chpwd
    add-zsh-hook preexec __cosmosh_zsh_preexec
  else
    precmd_functions=(${precmd_functions[@]} __cosmosh_zsh_precmd)
    chpwd_functions=(${chpwd_functions[@]} __cosmosh_zsh_chpwd)
    preexec_functions=(${preexec_functions[@]} __cosmosh_zsh_preexec)
  fi
fi
`

const degradedPosixHelperHooks = `
if [ "${__COSMOSH_REMOTE_SHELL_HOOK_INSTALLED:-0}" != "1" ]; then
  __COSMOSH_REMOTE_SHELL_HOOK_INSTALLED=1
  __cosmosh_emit_remote_shell_event integration-ready ""
  if [ -n "${PS1:-}" ]; then
    __COSMOSH_ORIGINAL_PS1="$PS1"
    PS1='$(__cosmosh_prompt_ready "$?")'"$__COSMOSH_ORIGINAL_PS1"
  fi
fi
`

func buildFishHelper(version string) string {
	capabilities := capabilitiesJSON(HelperCapabilities("fish"))
	header := fmt.Sprintf(`# Cosmosh Remote Enhancements shell integration.
set -gx COSMOSH_BOOTSTRAP_READY 1
set -gx __COSMOSH_REMOTE_SHELL fish
set -gx __COSMOSH_HELPER_VERSION %s
set -gx __COSMOSH_PROTOCOL_VERSION %d
set -gx __COSMOSH_CAPABILITIES_JSON %s
`, quoteFish(version), RemoteShellProtocolVersion, quoteFish(capabilities))

	return header + fishHelperBody
}

const fishHelperBody = `
function __cosmosh_json_escape
  string replace -a '\\' '\\\\' -- $argv[1] | string replace -a '"' '\\"'
end

function __cosmosh_command_name_from_line
  set -l line (string trim -- $argv[1])
  set -l guard 0
  while test $guard -lt 8
    set guard (math $guard + 1)
    set line (string replace -r '^[[:space:];|&(){}]*' '' -- $line)
    set -l word (string replace -r '[[:space:];|&(){}].*$' '' -- $line)
    switch $word
      case ''
        return 1
      case command builtin exec env noglob time '*=*'
        set line (string replace -r '^[^[:space:];|&(){}]*[[:space:]]*' '' -- $line)
        continue
    end

    set -l name (basename -- $word 2>/dev/null)
    switch $name
      case '' '__cosmosh_*' PROMPT_COMMAND trap
        return 1
    end

    printf '%s' "$name"
    return 0
  end

  return 1
end

function __cosmosh_emit_remote_shell_event
  if not isatty stdout
    return 0
  end
  if not command -q base64
    return 0
  end
  set -l event $argv[1]
  set -l status $argv[2]
  set -l command_name $argv[3]
  set -l timestamp (date +%s 2>/dev/null)
  if test -z "$timestamp"
    set timestamp 0
  end
  set timestamp "$timestamp"000
  set -l cwd (__cosmosh_json_escape "$PWD")
  set -l json "{\"event\":\"$event\",\"shell\":\"$__COSMOSH_REMOTE_SHELL\",\"helperVersion\":\"$__COSMOSH_HELPER_VERSION\",\"protocolVersion\":$__COSMOSH_PROTOCOL_VERSION,\"capabilities\":$__COSMOSH_CAPABILITIES_JSON,\"cwd\":\"$cwd\",\"timestamp\":$timestamp"
  if test -n "$command_name"
    set -l escaped_command (__cosmosh_json_escape "$command_name")
    set json "$json,\"command\":\"$escaped_command\""
  end
  if test -n "$status"
    set json "$json,\"exitCode\":$status"
  end
  set json "$json}"
  set -l payload (printf '%s' "$json" | base64 | string collect | string replace -a \n '')
  printf '\e]777;cosmosh;%s\a' "$payload"
end

function __cosmosh_emit_command_start
  set -l command_name (__cosmosh_command_name_from_line $argv[1])
  if test -z "$command_name"
    return 0
  end

  __cosmosh_emit_remote_shell_event command-start "" "$command_name"
  __cosmosh_emit_remote_shell_event foreground-command "" "$command_name"
end

if not set -q __COSMOSH_REMOTE_SHELL_HOOK_INSTALLED
  set -gx __COSMOSH_REMOTE_SHELL_HOOK_INSTALLED 1
  __cosmosh_emit_remote_shell_event integration-ready

  function __cosmosh_on_preexec --on-event fish_preexec
    __cosmosh_emit_command_start $argv[1]
  end

  function __cosmosh_on_prompt --on-event fish_prompt
    __cosmosh_emit_remote_shell_event cwd
    __cosmosh_emit_remote_shell_event prompt-ready
  end

  function __cosmosh_on_postexec --on-event fish_postexec
    __cosmosh_emit_remote_shell_event command-end $status
  end

  function __cosmosh_on_pwd --on-variable PWD
    __cosmosh_emit_remote_shell_event cwd
  end
end
`

func capabilitiesJSON(capabilities []string) string {
	quoted := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		quoted = append(quoted, fmt.Sprintf("%q", capability))
	}

	return "[" + strings.Join(quoted, ",") + "]"
}

func quotePOSIX(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

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
