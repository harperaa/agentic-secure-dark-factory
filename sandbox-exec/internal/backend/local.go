package backend

import (
	"context"
	"errors"
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

// Name returns "local".
func (Local) Name() string { return "local" }

// Run executes the command in its own process group and returns its exit code.
func (l Local) Run(ctx context.Context, spec Spec) (int, error) {
	if len(spec.Command) == 0 {
		return ExitCodeUnavailable, errors.New("local: empty command")
	}
	return runProcess(ctx, processRun{
		name:  spec.Command[0],
		args:  spec.Command[1:],
		dir:   spec.WorkDir,
		env:   spec.Env,
		spec:  spec,
		grace: l.GracePeriod,
	})
}
