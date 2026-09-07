package backend

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"
)

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

func TestStubBackendsReportNotImplemented(t *testing.T) {
	for _, name := range []string{"daytona", "cloudflare", "scaleway"} {
		b, err := New(name)
		if err != nil {
			t.Fatalf("New(%q): %v", name, err)
		}
		code, err := b.Run(context.Background(), Spec{Command: []string{"true"}})
		if code != ExitCodeUnavailable || err == nil {
			t.Fatalf("%s: code=%d err=%v, want unavailable", name, code, err)
		}
	}
	if _, err := New("nope"); err == nil {
		t.Fatalf("unknown backend accepted")
	}
}
