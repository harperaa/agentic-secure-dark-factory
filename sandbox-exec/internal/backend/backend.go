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
	// WorkDir is the directory the process starts in on the host (local) or the directory
	// bind-mounted into the sandbox when Workspace is WorkspaceMount.
	WorkDir string
	// ContainerWorkDir is the working directory inside a sandbox (docker, daytona).
	ContainerWorkDir string
	// Workspace selects how the host working directory reaches a sandbox.
	Workspace WorkspaceMode
	// Network is the backend-specific egress policy (docker --network value, Daytona
	// network allow list). Empty means the backend default.
	Network string
	// RunID labels the sandbox so an operator can trace it back to a Machinist run.
	RunID  string
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

// WorkspaceMode says whether the host working directory is shared with the sandbox.
type WorkspaceMode string

const (
	// WorkspaceNone runs in a fresh directory inside the sandbox; the inner command clones
	// what it needs (the genesis shape).
	WorkspaceNone WorkspaceMode = "none"
	// WorkspaceMount bind-mounts Spec.WorkDir at Spec.ContainerWorkDir (docker only).
	WorkspaceMount WorkspaceMode = "mount"
)

// Backend runs a Spec and returns the inner process exit code.
type Backend interface {
	Name() string
	Run(ctx context.Context, spec Spec) (int, error)
}

// ErrNotImplemented marks a backend that is declared but not yet built.
var ErrNotImplemented = errors.New("backend not implemented")

// ExitCodeUnavailable is the process exit code for a backend that cannot run at all,
// distinct from any exit code the inner command could produce meaningfully.
const ExitCodeUnavailable = 2

// Getenv abstracts os.Getenv so backends can be constructed in tests.
type Getenv func(string) string

// New returns the backend for name. Backends that need credentials read them through getenv.
func New(name string, getenv Getenv) (Backend, error) {
	switch name {
	case "local":
		return Local{}, nil
	case "docker", "scaleway":
		return NewDocker(name, getenv), nil
	case "daytona":
		return NewDaytona(getenv)
	case "cloudflare":
		return Stub{name: name, reason: "the Cloudflare backend runs from a Worker-hosted Durable Object (design §5.4); use that runtime instead of sandbox-exec"}, nil
	default:
		return nil, fmt.Errorf("unknown backend %q", name)
	}
}

// Stub is a declared backend whose implementation lives elsewhere or is pending.
type Stub struct {
	name   string
	reason string
}

// Name returns the backend name.
func (s Stub) Name() string { return s.name }

// Run always fails with ErrNotImplemented.
func (s Stub) Run(context.Context, Spec) (int, error) {
	return ExitCodeUnavailable, fmt.Errorf("%s: %w: %s", s.name, ErrNotImplemented, s.reason)
}
