package backend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// DefaultGracePeriod bounds shutdown after cancellation.
const DefaultGracePeriod = 10 * time.Second

// processRun describes one host process to supervise.
type processRun struct {
	name   string
	args   []string
	dir    string
	env    []string
	spec   Spec
	grace  time.Duration
	onStop func() // called after SIGTERM is sent, before the grace timer; may be nil
}

// runProcess starts the process in its own process group, wires the Spec's streams through
// unchanged, and terminates the group (then the backend's own cleanup) when ctx is cancelled.
func runProcess(ctx context.Context, run processRun) (int, error) {
	if run.name == "" {
		return ExitCodeUnavailable, errors.New("empty command")
	}
	// The command is the operator-configured executor array or the sandbox CLI, never run input.
	// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
	cmd := exec.Command(run.name, run.args...) // #nosec G204 -- operator-configured executor
	cmd.Dir = run.dir
	cmd.Env = append(os.Environ(), run.env...)
	cmd.Stdin = run.spec.Stdin
	cmd.Stdout = run.spec.Stdout
	cmd.Stderr = run.spec.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		return ExitCodeUnavailable, fmt.Errorf("start %s: %w", run.name, err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	grace := run.grace
	if grace == 0 {
		grace = DefaultGracePeriod
	}

	select {
	case err := <-done:
		return exitCode(err), waitError(err)
	case <-ctx.Done():
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		if run.onStop != nil {
			run.onStop()
		}
		select {
		case err := <-done:
			return exitCode(err), waitError(err)
		case <-time.After(grace):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			err := <-done
			return exitCode(err), waitError(err)
		}
	}
}

// exitCode maps a Wait error to the process exit code; a signal death maps to 128+signal.
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return 128 + int(status.Signal())
		}
		return exitErr.ExitCode()
	}
	return ExitCodeUnavailable
}

// waitError hides the ordinary non-zero-exit case, which the exit code already conveys.
func waitError(err error) error {
	var exitErr *exec.ExitError
	if err == nil || errors.As(err, &exitErr) {
		return nil
	}
	return err
}
