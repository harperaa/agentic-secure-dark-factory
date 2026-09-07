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

// Local runs the inner command as a child process on this machine.
// It is a passthrough: stdin, stdout, and stderr are wired straight through so
// Machinist's stream parsing sees exactly what the agent printed.
type Local struct {
	// GracePeriod is how long a cancelled run may take to exit after SIGTERM
	// before the process group is killed. Zero means DefaultGracePeriod.
	GracePeriod time.Duration
}

// DefaultGracePeriod bounds shutdown after cancellation.
const DefaultGracePeriod = 10 * time.Second

// Name returns "local".
func (Local) Name() string { return "local" }

// Run executes the command in its own process group and returns its exit code.
func (l Local) Run(ctx context.Context, spec Spec) (int, error) {
	if len(spec.Command) == 0 {
		return ExitCodeUnavailable, errors.New("local: empty command")
	}
	cmd := exec.Command(spec.Command[0], spec.Command[1:]...)
	cmd.Dir = spec.WorkDir
	cmd.Env = append(os.Environ(), spec.Env...)
	cmd.Stdin = spec.Stdin
	cmd.Stdout = spec.Stdout
	cmd.Stderr = spec.Stderr
	// A separate process group lets cancellation reach the agent's own children.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		return ExitCodeUnavailable, fmt.Errorf("local: start: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	grace := l.GracePeriod
	if grace == 0 {
		grace = DefaultGracePeriod
	}

	select {
	case err := <-done:
		return exitCode(err), waitError(err)
	case <-ctx.Done():
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
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
