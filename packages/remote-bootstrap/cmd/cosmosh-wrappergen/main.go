package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/agoudbg/cosmosh/packages/remote-bootstrap/internal/wrapper"
)

// main renders a shell-specific remote bootstrap wrapper to stdout.
func main() {
	config := wrapper.Config{}
	flag.StringVar(&config.Shell, "shell", "", "target shell: zsh, fish, ash, or sh")
	flag.StringVar(&config.TargetOS, "os", "linux", "target operating system")
	flag.StringVar(&config.TargetArch, "arch", "", "target architecture: amd64 or arm64")
	flag.StringVar(&config.Version, "version", "", "bootstrap version")
	flag.StringVar(&config.AssetURL, "asset-url", "", "bootstrap binary asset URL")
	flag.StringVar(&config.SHA256, "sha256", "", "bootstrap binary sha256")
	flag.StringVar(&config.HelperPayloadB64, "helper-payload-b64", "", "base64 shell helper payload")
	flag.Parse()

	script, err := wrapper.Generate(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fmt.Print(script)
}
