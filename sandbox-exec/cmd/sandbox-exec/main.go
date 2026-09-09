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

// Environment variables the CLI falls back to when the matching flag is not given, so a
// worker.toml executor line can stay identical across runtimes (design §5.2).
const (
	envBackend          = "SANDBOX_BACKEND"
	envSnapshot         = "SANDBOX_SNAPSHOT"
	envContainerWorkDir = "SANDBOX_CONTAINER_WORKDIR"
	envNetwork          = "SANDBOX_NETWORK"
	envWorkspace        = "SANDBOX_WORKSPACE"
	envRunID            = "MACHINIST_RUN_ID"
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
	os.Exit(run(os.Args[1:], os.Getenv))
}

func run(args []string, getenv backend.Getenv) int {
	fs := flag.NewFlagSet("sandbox-exec", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	backendName := fs.String("backend", getenv(envBackend), "where to run: local|docker|scaleway|daytona|cloudflare (or "+envBackend+")")
	snapshot := fs.String("snapshot", getenv(envSnapshot), "sandbox image name (or "+envSnapshot+"; ignored by local)")
	workDir := fs.String("workdir", "", "host working directory (default: current directory)")
	containerWorkDir := fs.String("container-workdir", getenv(envContainerWorkDir), "working directory inside the sandbox (or "+envContainerWorkDir+")")
	workspace := fs.String("workspace", getenv(envWorkspace), "none|mount: whether the host workdir is shared with the sandbox (or "+envWorkspace+"; default none)")
	network := fs.String("network", getenv(envNetwork), "egress policy: docker --network value or Daytona allow list (or "+envNetwork+")")
	runID := fs.String("run-id", getenv(envRunID), "label for the sandbox (or "+envRunID+")")
	var env envList
	fs.Var(&env, "env", "KEY=VALUE injected into the run (repeatable)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: sandbox-exec --backend=<name> [--snapshot=<name>] [--container-workdir=<path>] [--workspace=none|mount] [--network=<policy>] [--env=K=V ...] -- <command> [args...]")
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
	mode := backend.WorkspaceMode(*workspace)
	if mode == "" {
		mode = backend.WorkspaceNone
	}

	b, err := backend.New(*backendName, getenv)
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

	fmt.Fprintf(os.Stderr, "sandbox-exec backend=%s snapshot=%s workspace=%s command=%s\n", b.Name(), *snapshot, mode, inner[0])
	code, err := b.Run(ctx, backend.Spec{
		Command:          inner,
		Snapshot:         *snapshot,
		Env:              env,
		WorkDir:          dir,
		ContainerWorkDir: *containerWorkDir,
		Workspace:        mode,
		Network:          *network,
		RunID:            *runID,
		Stdin:            os.Stdin,
		Stdout:           os.Stdout,
		Stderr:           os.Stderr,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "sandbox-exec: %v\n", err)
	}
	return code
}
