package backend

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeDocker writes a shell script named docker into a temp dir that records its argv to
// logPath, echoes stdin, and exits with the code in FAKE_DOCKER_EXIT (default 0).
func fakeDocker(t *testing.T) (bin string, logPath string) {
	t.Helper()
	dir := t.TempDir()
	logPath = filepath.Join(dir, "argv.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_DOCKER_LOG\"\ncat\nexit \"${FAKE_DOCKER_EXIT:-0}\"\n"
	bin = filepath.Join(dir, "docker")
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil { // #nosec G306 -- test fixture must be executable
		t.Fatal(err)
	}
	t.Setenv("FAKE_DOCKER_LOG", logPath)
	return bin, logPath
}

func TestDockerArgsBuildTheExpectedCommandLine(t *testing.T) {
	d := Docker{name: "docker", Binary: "docker", User: "machinist"}
	args, err := d.Args(Spec{
		Command:          []string{"claude", "--print"},
		Snapshot:         "svcos-factory:abc",
		Env:              []string{"A=1", "B=2"},
		WorkDir:          "/host/repo",
		ContainerWorkDir: "/work",
		Workspace:        WorkspaceMount,
		Network:          "asdf-egress",
		RunID:            "run_1",
	}, "asdf-run_1")
	if err != nil {
		t.Fatal(err)
	}
	want := "run -i --rm --name asdf-run_1 --network asdf-egress --user machinist -v /host/repo:/work -w /work -e A=1 -e B=2 --label io.asdf.run=run_1 svcos-factory:abc claude --print"
	if got := strings.Join(args, " "); got != want {
		t.Fatalf("args =\n%s\nwant\n%s", got, want)
	}
}

func TestDockerArgsRejectMissingSnapshotAndMountWithoutContainerDir(t *testing.T) {
	d := Docker{name: "docker", Binary: "docker"}
	if _, err := d.Args(Spec{Command: []string{"true"}}, "n"); err == nil || !strings.Contains(err.Error(), "MISSING_ARG snapshot") {
		t.Fatalf("expected MISSING_ARG snapshot, got %v", err)
	}
	if _, err := d.Args(Spec{Command: []string{"true"}, Snapshot: "img", Workspace: WorkspaceMount, WorkDir: "/x"}, "n"); err == nil || !strings.Contains(err.Error(), "container-workdir") {
		t.Fatalf("expected container-workdir error, got %v", err)
	}
	if _, err := d.Args(Spec{Command: []string{"true"}, Snapshot: "img", Workspace: "weird"}, "n"); err == nil {
		t.Fatalf("expected unknown workspace error")
	}
}

func TestDockerRunPipesStdinAndPropagatesExitCode(t *testing.T) {
	bin, logPath := fakeDocker(t)
	t.Setenv("FAKE_DOCKER_EXIT", "5")
	d := NewDocker("scaleway", func(k string) string {
		if k == EnvDockerBin {
			return bin
		}
		return ""
	})
	var out, errOut bytes.Buffer
	code, err := d.Run(context.Background(), Spec{
		Command:  []string{"sh", "-c", "cat"},
		Snapshot: "svcos-factory:test",
		RunID:    "run_x",
		Stdin:    strings.NewReader("prompt body\n"),
		Stdout:   &out,
		Stderr:   &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 5 {
		t.Fatalf("exit code = %d, want 5", code)
	}
	if out.String() != "prompt body\n" {
		t.Fatalf("stdout = %q", out.String())
	}
	argv, readErr := os.ReadFile(logPath) // #nosec G304 -- test temp file
	if readErr != nil {
		t.Fatal(readErr)
	}
	lines := strings.Split(strings.TrimSpace(string(argv)), "\n")
	if lines[0] != "run" || lines[len(lines)-1] != "cat" || !contains(lines, "asdf-run_x") || !contains(lines, "svcos-factory:test") {
		t.Fatalf("unexpected docker argv: %v", lines)
	}
	if !strings.Contains(errOut.String(), "container=asdf-run_x") {
		t.Fatalf("stderr banner missing: %q", errOut.String())
	}
}

func TestDockerRunCancellationKillsContainer(t *testing.T) {
	bin, logPath := fakeDocker(t)
	// A fake that ignores stdin EOF and sleeps, so only cancellation ends it.
	script := "#!/bin/sh\nif [ \"$1\" = kill ]; then printf 'kill %s\\n' \"$2\" >> \"$FAKE_DOCKER_LOG\"; exit 0; fi\nprintf '%s\\n' \"$@\" > \"$FAKE_DOCKER_LOG\"\nsleep 30\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil { // #nosec G306 -- test fixture must be executable
		t.Fatal(err)
	}
	d := Docker{name: "docker", Binary: bin, GracePeriod: time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(300 * time.Millisecond); cancel() }()
	start := time.Now()
	var out bytes.Buffer
	code, _ := d.Run(ctx, Spec{Command: []string{"true"}, Snapshot: "img", RunID: "run_k", Stdin: strings.NewReader(""), Stdout: &out, Stderr: &out})
	if time.Since(start) > 5*time.Second || code == 0 {
		t.Fatalf("cancellation did not stop the run promptly (code=%d)", code)
	}
	argv, _ := os.ReadFile(logPath) // #nosec G304 -- test temp file
	if !strings.Contains(string(argv), "kill asdf-run_k") {
		t.Fatalf("docker kill was not issued: %q", string(argv))
	}
}

// TestDockerIntegration runs a real container when SANDBOX_EXEC_DOCKER_INTEGRATION=1 and a
// daemon is reachable; otherwise it is skipped.
func TestDockerIntegration(t *testing.T) {
	if os.Getenv("SANDBOX_EXEC_DOCKER_INTEGRATION") != "1" {
		t.Skip("set SANDBOX_EXEC_DOCKER_INTEGRATION=1 to run against a real daemon")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skip("docker daemon not reachable")
	}
	image := os.Getenv("SANDBOX_EXEC_DOCKER_IMAGE")
	if image == "" {
		t.Skip("set SANDBOX_EXEC_DOCKER_IMAGE to an image that has /bin/sh")
	}
	var out bytes.Buffer
	code, err := NewDocker("docker", os.Getenv).Run(context.Background(), Spec{
		Command:  []string{"sh", "-c", "cat; exit 3"},
		Snapshot: image,
		Stdin:    strings.NewReader("hello\n"),
		Stdout:   &out,
		Stderr:   &out,
	})
	if err != nil || code != 3 || !strings.Contains(out.String(), "hello") {
		t.Fatalf("integration run: code=%d err=%v out=%q", code, err, out.String())
	}
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
