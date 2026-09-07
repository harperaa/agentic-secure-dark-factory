// Command sandbox-exec is a Machinist wrapper executor: it reads the prompt on stdin, runs
// the inner agent command on the selected backend, and exits with that command's exit code.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/harperaa/agentic-secure-dark-factory/sandbox-exec/internal/backend"
)

type envList []string

func (e *envList) String() string { return strings.Join(*e, ",") }
func (e *envList) Set(v string) error {
	if !strings.Contains(v, "=") {
		return fmt.Errorf("env %q is not KEY=VALUE", v)
	}
	*e = append(*e, v)
	return nil
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	fs := flag.NewFlagSet("sandbox-exec", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	backendName := fs.String("backend", "", "where to run: local|daytona|cloudflare|scaleway (required)")
	snapshot := fs.String("snapshot", "", "sandbox image name (ignored by local)")
	workDir := fs.String("workdir", "", "working directory (default: current directory)")
	var env envList
	fs.Var(&env, "env", "KEY=VALUE injected into the run (repeatable)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: sandbox-exec --backend=<name> [--snapshot=<name>] [--env=K=V ...] -- <command> [args...]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return backend.ExitCodeUnavailable
	}
	if *backendName == "" {
		fmt.Fprintln(os.Stderr, "MISSING_ARG backend")
		return backend.ExitCodeUnavailable
	}
	inner := fs.Args()
	if len(inner) == 0 {
		fmt.Fprintln(os.Stderr, "MISSING_ARG command")
		return backend.ExitCodeUnavailable
	}

	b, err := backend.New(*backendName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sandbox-exec: %v\n", err)
		return backend.ExitCodeUnavailable
	}

	dir := *workDir
	if dir == "" {
		if dir, err = os.Getwd(); err != nil {
			fmt.Fprintf(os.Stderr, "sandbox-exec: getwd: %v\n", err)
			return backend.ExitCodeUnavailable
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	fmt.Fprintf(os.Stderr, "sandbox-exec backend=%s snapshot=%s command=%s\n", b.Name(), *snapshot, inner[0])
	code, err := b.Run(ctx, backend.Spec{
		Command:  inner,
		Snapshot: *snapshot,
		Env:      env,
		WorkDir:  dir,
		Stdin:    os.Stdin,
		Stdout:   os.Stdout,
		Stderr:   os.Stderr,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "sandbox-exec: %v\n", err)
	}
	return code
}
