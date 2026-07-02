package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/agoudbg/cosmosh/packages/remote-bootstrap/internal/install"
)

// main dispatches remote bootstrap install and status commands.
func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "expected command: install or status")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "install":
		runInstall(os.Args[2:])
	case "status":
		runStatus(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runInstall(args []string) {
	flags := flag.NewFlagSet("install", flag.ExitOnError)
	options := install.Options{Stdout: os.Stdout}
	flags.StringVar(&options.Shell, "shell", "", "target shell")
	flags.StringVar(&options.Version, "version", "", "bootstrap version")
	flags.StringVar(&options.HelperPayloadB64, "helper-payload-b64", "", "base64 shell helper payload")
	_ = flags.Parse(args)

	if err := install.Run(options); err != nil {
		os.Exit(1)
	}
}

func runStatus(args []string) {
	flags := flag.NewFlagSet("status", flag.ExitOnError)
	shell := ""
	flags.StringVar(&shell, "shell", "sh", "target shell")
	_ = flags.Parse(args)

	if err := install.Status(os.Stdout, shell); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
