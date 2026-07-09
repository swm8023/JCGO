package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"jcgo/internal/deploy"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "jcgo-deploy: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("command is required: deploy or update")
	}
	mode := args[0]
	fs := flag.NewFlagSet("jcgo-deploy "+mode, flag.ContinueOnError)
	repo := fs.String("repo", "", "JCGO repository root")
	home := fs.String("home", "", "user home directory")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	opts := deploy.Options{RepoRoot: *repo, HomeDir: *home}
	switch mode {
	case "deploy":
		return deploy.Deploy(ctx, opts)
	case "update":
		opts.Pull = true
		return deploy.Deploy(ctx, opts)
	default:
		return fmt.Errorf("unsupported command %q", mode)
	}
}
