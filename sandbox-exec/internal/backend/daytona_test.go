package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeDaytona implements the endpoints Daytona uses, recording calls in order.
type fakeDaytona struct {
	mu         sync.Mutex
	calls      []string
	prompt     string
	command    string
	polls      int
	deleted    bool
	exitCode   int
	logs       []string // returned progressively, one more line per poll
	startAfter int      // polls before state becomes started
}

func (f *fakeDaytona) handler(t *testing.T) http.Handler {
	t.Helper()
	mux := http.NewServeMux()
	record := func(r *http.Request) {
		f.mu.Lock()
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing bearer on %s %s", r.Method, r.URL.Path)
		}
	}
	mux.HandleFunc("POST /sandbox", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["snapshot"] != "svcos-factory:test" {
			t.Errorf("snapshot = %v", body["snapshot"])
		}
		if env, ok := body["env"].(map[string]any); !ok || env["TOKEN"] != "abc" {
			t.Errorf("env not forwarded: %v", body["env"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "sb1", "state": "creating"})
	})
	mux.HandleFunc("GET /sandbox/sb1", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		f.mu.Lock()
		f.polls++
		state := "starting"
		if f.polls > f.startAfter {
			state = "started"
		}
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "sb1", "state": state})
	})
	mux.HandleFunc("DELETE /sandbox/sb1", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		f.mu.Lock()
		f.deleted = true
		f.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /toolbox/sb1/toolbox/files/upload", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Errorf("upload without file part: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		data, _ := io.ReadAll(file)
		f.mu.Lock()
		f.prompt = string(data)
		f.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /toolbox/sb1/toolbox/process/session", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /toolbox/sb1/toolbox/process/session/asdf-sb1/exec", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.command, _ = body["command"].(string)
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"cmdId": "c1"})
	})
	logsServed := 0
	mux.HandleFunc("GET /toolbox/sb1/toolbox/process/session/asdf-sb1/command/c1/logs", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		f.mu.Lock()
		if logsServed < len(f.logs) {
			logsServed++
		}
		out := strings.Join(f.logs[:logsServed], "")
		f.mu.Unlock()
		_, _ = w.Write([]byte(out))
	})
	mux.HandleFunc("GET /toolbox/sb1/toolbox/process/session/asdf-sb1/command/c1", func(w http.ResponseWriter, r *http.Request) {
		record(r)
		f.mu.Lock()
		done := logsServed >= len(f.logs)
		code := f.exitCode
		f.mu.Unlock()
		if done {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "c1", "exitCode": code})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "c1"})
	})
	return mux
}

func newTestDaytona(t *testing.T, f *fakeDaytona) (*Daytona, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	d, err := NewDaytona(func(k string) string {
		switch k {
		case EnvDaytonaAPIKey:
			return "test-key"
		case EnvDaytonaAPIURL:
			return srv.URL + "/"
		case EnvDaytonaTarget:
			return "eu"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	d.Poll = 10 * time.Millisecond
	return d, srv
}

func TestNewDaytonaRequiresKeyAndURL(t *testing.T) {
	if _, err := NewDaytona(func(string) string { return "" }); err == nil || !strings.Contains(err.Error(), EnvDaytonaAPIKey) {
		t.Fatalf("expected MISSING_ENV for key, got %v", err)
	}
	if _, err := NewDaytona(func(k string) string {
		if k == EnvDaytonaAPIKey {
			return "k"
		}
		return ""
	}); err == nil || !strings.Contains(err.Error(), EnvDaytonaAPIURL) {
		t.Fatalf("expected MISSING_ENV for url, got %v", err)
	}
}

func TestDaytonaRunsCommandStreamsLogsAndDestroys(t *testing.T) {
	f := &fakeDaytona{exitCode: 7, logs: []string{"line one\n", "line two\n"}, startAfter: 1}
	d, _ := newTestDaytona(t, f)
	var out, errOut bytes.Buffer
	code, err := d.Run(context.Background(), Spec{
		Command:          []string{"claude", "--print", "it's"},
		Snapshot:         "svcos-factory:test",
		Env:              []string{"TOKEN=abc"},
		ContainerWorkDir: "/home/machinist/work",
		RunID:            "run_1",
		Stdin:            strings.NewReader("the prompt\n"),
		Stdout:           &out,
		Stderr:           &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 7 {
		t.Fatalf("exit code = %d, want 7", code)
	}
	if out.String() != "line one\nline two\n" {
		t.Fatalf("stdout = %q", out.String())
	}
	if f.prompt != "the prompt\n" {
		t.Fatalf("prompt uploaded = %q", f.prompt)
	}
	want := "cd '/home/machinist/work' && 'claude' '--print' 'it'\\''s' < '/home/machinist/work/.sandbox-exec-prompt'"
	if f.command != want {
		t.Fatalf("command =\n%s\nwant\n%s", f.command, want)
	}
	if !f.deleted {
		t.Fatalf("sandbox was not destroyed")
	}
	if f.calls[0] != "POST /sandbox" || f.calls[len(f.calls)-1] != "DELETE /sandbox/sb1" {
		t.Fatalf("call order: %v", f.calls)
	}
	if !strings.Contains(errOut.String(), "sandbox=sb1") {
		t.Fatalf("stderr banner missing: %q", errOut.String())
	}
}

func TestDaytonaCancellationDestroysSandbox(t *testing.T) {
	f := &fakeDaytona{exitCode: 0, logs: []string{"a\n", "b\n", "c\n", "d\n", "e\n", "f\n", "g\n", "h\n"}}
	d, _ := newTestDaytona(t, f)
	d.Poll = 50 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(120 * time.Millisecond); cancel() }()
	var out bytes.Buffer
	code, err := d.Run(ctx, Spec{
		Command: []string{"sleep", "100"}, Snapshot: "svcos-factory:test", ContainerWorkDir: "/w",
		Env: []string{"TOKEN=abc"}, Stdin: strings.NewReader(""), Stdout: &out, Stderr: &out,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code == 0 {
		t.Fatalf("expected non-zero exit after cancellation")
	}
	if !f.deleted {
		t.Fatalf("sandbox was not destroyed on cancellation")
	}
}

func TestDaytonaRejectsMountWorkspace(t *testing.T) {
	f := &fakeDaytona{}
	d, _ := newTestDaytona(t, f)
	_, err := d.Run(context.Background(), Spec{Command: []string{"x"}, Snapshot: "img", ContainerWorkDir: "/w", Workspace: WorkspaceMount, Stdin: strings.NewReader("")})
	if err == nil || !strings.Contains(err.Error(), "mount") {
		t.Fatalf("expected mount rejection, got %v", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("no API call expected before validation, got %v", f.calls)
	}
}
