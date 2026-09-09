package backend

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func noEnv(string) string { return "" }

func TestLocalPassesStdinThroughAndReturnsExitCode(t *testing.T) {
	var out bytes.Buffer
	code, err := Local{}.Run(context.Background(), Spec{
		Command: []string{"sh", "-c", "cat; echo tail; exit 3"},
		Stdin:   strings.NewReader("prompt\n"),
		Stdout:  &out,
		Stderr:  &out,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 3 {
		t.Fatalf("exit code = %d, want 3", code)
	}
	if got := out.String(); got != "prompt\ntail\n" {
		t.Fatalf("stdout = %q", got)
	}
}

func TestLocalInjectsEnv(t *testing.T) {
	var out bytes.Buffer
	code, err := Local{}.Run(context.Background(), Spec{
		Command: []string{"sh", "-c", "printf '%s' \"$SANDBOX_EXEC_TEST\""},
		Env:     []string{"SANDBOX_EXEC_TEST=injected"},
		Stdin:   strings.NewReader(""),
		Stdout:  &out,
		Stderr:  &out,
	})
	if err != nil || code != 0 {
		t.Fatalf("run failed: code=%d err=%v", code, err)
	}
	if out.String() != "injected" {
		t.Fatalf("env not injected: %q", out.String())
	}
}

func TestLocalCancellationTerminatesProcessGroup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var out bytes.Buffer
	start := time.Now()
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()
	code, _ := Local{GracePeriod: time.Second}.Run(ctx, Spec{
		Command: []string{"sh", "-c", "sleep 30"},
		Stdin:   strings.NewReader(""),
		Stdout:  &out,
		Stderr:  &out,
	})
	if time.Since(start) > 5*time.Second {
		t.Fatalf("cancellation did not stop the process promptly")
	}
	if code == 0 {
		t.Fatalf("exit code = 0 after cancellation, want non-zero")
	}
}

func TestNewResolvesEveryDeclaredBackend(t *testing.T) {
	for _, name := range []string{"local", "docker", "scaleway", "cloudflare"} {
		b, err := New(name, noEnv)
		if err != nil {
			t.Fatalf("New(%q): %v", name, err)
		}
		if b.Name() != name {
			t.Fatalf("New(%q).Name() = %q", name, b.Name())
		}
	}
	if _, err := New("daytona", noEnv); err == nil {
		t.Fatalf("daytona without credentials should fail to construct")
	}
	if _, err := New("nope", noEnv); err == nil {
		t.Fatalf("unknown backend accepted")
	}
}

func TestCloudflareStubReportsNotImplemented(t *testing.T) {
	b, err := New("cloudflare", noEnv)
	if err != nil {
		t.Fatal(err)
	}
	code, err := b.Run(context.Background(), Spec{Command: []string{"true"}})
	if code != ExitCodeUnavailable || !errors.Is(err, ErrNotImplemented) || !strings.Contains(err.Error(), "Worker") {
		t.Fatalf("cloudflare: code=%d err=%v", code, err)
	}
}
