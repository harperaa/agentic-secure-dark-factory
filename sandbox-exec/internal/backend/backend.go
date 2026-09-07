// Package backend defines where a sandbox-exec run's process executes.
package backend

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// Spec describes one run: the inner command and the environment it needs.
type Spec struct {
	// Command is the inner agent command and its arguments.
	Command []string
	// Snapshot names the sandbox image; ignored by the local backend.
	Snapshot string
	// Env holds per-run KEY=VALUE pairs injected into the process.
	Env []string
	// WorkDir is the directory the process starts in.
	WorkDir string
	Stdin   io.Reader
	Stdout  io.Writer
	Stderr  io.Writer
}

// Backend runs a Spec and returns the inner process exit code.
type Backend interface {
	Name() string
	Run(ctx context.Context, spec Spec) (int, error)
}

// ErrNotImplemented marks a backend that is declared but not yet built.
var ErrNotImplemented = errors.New("backend not implemented")

// ExitCode is the process exit code for a backend that cannot run at all,
// distinct from any exit code the inner command could produce meaningfully.
const ExitCodeUnavailable = 2

// New returns the backend for name.
func New(name string) (Backend, error) {
	switch name {
	case "local":
		return Local{}, nil
	case "daytona", "cloudflare", "scaleway":
		return Stub{name: name}, nil
	default:
		return nil, fmt.Errorf("unknown backend %q", name)
	}
}

// Stub is a declared backend whose implementation is pending.
type Stub struct{ name string }

// Name returns the backend name.
func (s Stub) Name() string { return s.name }

// Run always fails with ErrNotImplemented.
func (s Stub) Run(context.Context, Spec) (int, error) {
	return ExitCodeUnavailable, fmt.Errorf("%s: %w", s.name, ErrNotImplemented)
}
