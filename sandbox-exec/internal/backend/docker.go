package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

// Docker runs the inner command in a fresh container from the snapshot image with
// `docker run -i --rm`. The same backend serves Scaleway Serverless Containers, which
// exposes plain Docker semantics and no SDK-level sandbox primitives (design §5.5).
type Docker struct {
	name string
	// Binary is the docker client to invoke; SANDBOX_DOCKER_BIN overrides the default "docker".
	Binary string
	// GracePeriod bounds shutdown after cancellation. Zero means DefaultGracePeriod.
	GracePeriod time.Duration
	// User is the account inside the container; SANDBOX_CONTAINER_USER, empty keeps the image's.
	User string
}

// EnvDockerBin names the environment variable that selects the docker client binary.
const EnvDockerBin = "SANDBOX_DOCKER_BIN"

// EnvContainerUser names the environment variable that selects the in-container account.
const EnvContainerUser = "SANDBOX_CONTAINER_USER"

// NewDocker builds a Docker backend reading its knobs from the environment.
func NewDocker(name string, getenv Getenv) Docker {
	bin := getenv(EnvDockerBin)
	if bin == "" {
		bin = "docker"
	}
	return Docker{name: name, Binary: bin, User: getenv(EnvContainerUser)}
}

// Name returns the configured name ("docker" or "scaleway").
func (d Docker) Name() string { return d.name }

// Args returns the docker command line for spec; exported for tests and dry runs.
func (d Docker) Args(spec Spec, containerName string) ([]string, error) {
	if spec.Snapshot == "" {
		return nil, errors.New("docker: MISSING_ARG snapshot")
	}
	if len(spec.Command) == 0 {
		return nil, errors.New("docker: empty command")
	}
	args := []string{"run", "-i", "--rm", "--name", containerName}
	if spec.Network != "" {
		args = append(args, "--network", spec.Network)
	}
	if d.User != "" {
		args = append(args, "--user", d.User)
	}
	switch spec.Workspace {
	case WorkspaceMount:
		if spec.WorkDir == "" || spec.ContainerWorkDir == "" {
			return nil, errors.New("docker: MISSING_ARG container-workdir (required with --workspace=mount)")
		}
		args = append(args, "-v", spec.WorkDir+":"+spec.ContainerWorkDir, "-w", spec.ContainerWorkDir)
	case WorkspaceNone, "":
		if spec.ContainerWorkDir != "" {
			args = append(args, "-w", spec.ContainerWorkDir)
		}
	default:
		return nil, fmt.Errorf("docker: unknown workspace mode %q", spec.Workspace)
	}
	for _, kv := range spec.Env {
		args = append(args, "-e", kv)
	}
	if spec.RunID != "" {
		args = append(args, "--label", "io.asdf.run="+spec.RunID)
	}
	args = append(args, spec.Snapshot)
	args = append(args, spec.Command...)
	return args, nil
}

// Run starts the container and returns the inner command's exit code.
func (d Docker) Run(ctx context.Context, spec Spec) (int, error) {
	containerName, err := d.containerName(spec)
	if err != nil {
		return ExitCodeUnavailable, err
	}
	args, err := d.Args(spec, containerName)
	if err != nil {
		return ExitCodeUnavailable, err
	}
	fmt.Fprintf(spec.Stderr, "sandbox-exec %s: container=%s image=%s\n", d.name, containerName, spec.Snapshot)
	return runProcess(ctx, processRun{
		name:  d.Binary,
		args:  args,
		spec:  spec,
		grace: d.GracePeriod,
		onStop: func() {
			// The client proxies SIGTERM, but a wedged client must not leave the container running.
			// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command
			_ = exec.Command(d.Binary, "kill", containerName).Run() // #nosec G204 -- operator-configured binary
		},
	})
}

func (d Docker) containerName(spec Spec) (string, error) {
	if spec.RunID != "" {
		return "asdf-" + spec.RunID, nil
	}
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("docker: random name: %w", err)
	}
	return "asdf-" + hex.EncodeToString(b[:]), nil
}
