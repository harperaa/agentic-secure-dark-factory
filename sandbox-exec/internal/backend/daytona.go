package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// Daytona runs the inner command in an ephemeral Daytona sandbox created from the snapshot.
//
// Coded against the Daytona REST API as documented in 2026-09 (api.daytona.io, "v1" paths):
//
//	POST   {api}/sandbox                                                   create from snapshot
//	GET    {api}/sandbox/{id}                                              poll state
//	DELETE {api}/sandbox/{id}?force=true                                   destroy
//	POST   {api}/toolbox/{id}/toolbox/files/upload?path=...                upload the prompt
//	POST   {api}/toolbox/{id}/toolbox/process/session                      open a shell session
//	POST   {api}/toolbox/{id}/toolbox/process/session/{sid}/exec           run async command
//	GET    {api}/toolbox/{id}/toolbox/process/session/{sid}/command/{cid}  exit code
//	GET    {api}/toolbox/{id}/toolbox/process/session/{sid}/command/{cid}/logs   output
//
// The API key and URL come from the environment only (design §8.1: the key stays on the
// worker and never enters the sandbox). Per-run secrets are passed as sandbox env vars.
type Daytona struct {
	APIURL    string
	APIKey    string
	Target    string
	Client    *http.Client
	Poll      time.Duration
	StartWait time.Duration
	// Now is injectable for tests.
	Now func() time.Time
}

// Environment variable names read by NewDaytona.
const (
	EnvDaytonaAPIKey = "DAYTONA_API_KEY" // pragma: allowlist secret (variable name, not a value)
	EnvDaytonaAPIURL = "DAYTONA_API_URL"
	EnvDaytonaTarget = "DAYTONA_TARGET"
)

// NewDaytona builds a Daytona backend from the environment; both key and URL are required.
func NewDaytona(getenv Getenv) (*Daytona, error) {
	key := getenv(EnvDaytonaAPIKey)
	apiURL := getenv(EnvDaytonaAPIURL)
	if key == "" {
		return nil, errors.New("daytona: MISSING_ENV " + EnvDaytonaAPIKey)
	}
	if apiURL == "" {
		return nil, errors.New("daytona: MISSING_ENV " + EnvDaytonaAPIURL)
	}
	return &Daytona{
		APIURL:    strings.TrimRight(apiURL, "/"),
		APIKey:    key,
		Target:    getenv(EnvDaytonaTarget),
		Client:    &http.Client{Timeout: 5 * time.Minute},
		Poll:      2 * time.Second,
		StartWait: 5 * time.Minute,
		Now:       time.Now,
	}, nil
}

// Name returns "daytona".
func (*Daytona) Name() string { return "daytona" }

type daytonaSandbox struct {
	ID    string `json:"id"`
	State string `json:"state"`
}

type daytonaCommand struct {
	ID       string `json:"id"`
	ExitCode *int   `json:"exitCode"`
}

// Run creates the sandbox, executes the command with the prompt on stdin, streams output,
// and always destroys the sandbox before returning.
func (d *Daytona) Run(ctx context.Context, spec Spec) (int, error) {
	if spec.Snapshot == "" {
		return ExitCodeUnavailable, errors.New("daytona: MISSING_ARG snapshot")
	}
	if len(spec.Command) == 0 {
		return ExitCodeUnavailable, errors.New("daytona: empty command")
	}
	if spec.ContainerWorkDir == "" {
		return ExitCodeUnavailable, errors.New("daytona: MISSING_ARG container-workdir")
	}
	if spec.Workspace == WorkspaceMount {
		return ExitCodeUnavailable, errors.New("daytona: --workspace=mount is not supported; the inner command clones inside the sandbox")
	}

	prompt, err := io.ReadAll(spec.Stdin)
	if err != nil {
		return ExitCodeUnavailable, fmt.Errorf("daytona: read prompt: %w", err)
	}

	sb, err := d.create(ctx, spec)
	if err != nil {
		return ExitCodeUnavailable, err
	}
	fmt.Fprintf(spec.Stderr, "sandbox-exec daytona: sandbox=%s snapshot=%s target=%s\n", sb.ID, spec.Snapshot, d.Target)
	// Destruction must not be cancelled by the run's context.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if delErr := d.destroy(cleanup, sb.ID); delErr != nil {
			fmt.Fprintf(spec.Stderr, "sandbox-exec daytona: destroy %s: %v\n", sb.ID, delErr)
		} else {
			fmt.Fprintf(spec.Stderr, "sandbox-exec daytona: sandbox=%s destroyed\n", sb.ID)
		}
	}()

	if err := d.waitStarted(ctx, sb.ID); err != nil {
		return ExitCodeUnavailable, err
	}
	promptPath := path.Join(spec.ContainerWorkDir, ".sandbox-exec-prompt")
	if err := d.upload(ctx, sb.ID, promptPath, prompt); err != nil {
		return ExitCodeUnavailable, err
	}
	sessionID := "asdf-" + sb.ID
	if err := d.openSession(ctx, sb.ID, sessionID); err != nil {
		return ExitCodeUnavailable, err
	}
	command := fmt.Sprintf("cd %s && %s < %s", shellQuote(spec.ContainerWorkDir), shellJoin(spec.Command), shellQuote(promptPath))
	cmdID, err := d.exec(ctx, sb.ID, sessionID, command)
	if err != nil {
		return ExitCodeUnavailable, err
	}
	return d.stream(ctx, sb.ID, sessionID, cmdID, spec.Stdout)
}

func (d *Daytona) create(ctx context.Context, spec Spec) (daytonaSandbox, error) {
	env := map[string]string{}
	for _, kv := range spec.Env {
		k, v, _ := strings.Cut(kv, "=")
		env[k] = v
	}
	body := map[string]any{
		"snapshot":           spec.Snapshot,
		"env":                env,
		"labels":             map[string]string{"io.asdf.run": spec.RunID},
		"autoStopInterval":   0,
		"autoDeleteInterval": 0,
	}
	if d.Target != "" {
		body["target"] = d.Target
	}
	if spec.Network != "" {
		body["networkBlockAll"] = true
		body["networkAllowList"] = spec.Network
	}
	var sb daytonaSandbox
	if err := d.do(ctx, http.MethodPost, "/sandbox", body, &sb); err != nil {
		return sb, fmt.Errorf("daytona: create sandbox: %w", err)
	}
	if sb.ID == "" {
		return sb, errors.New("daytona: create sandbox: no id in response")
	}
	return sb, nil
}

func (d *Daytona) waitStarted(ctx context.Context, id string) error {
	deadline := d.Now().Add(d.StartWait)
	for {
		var sb daytonaSandbox
		if err := d.do(ctx, http.MethodGet, "/sandbox/"+url.PathEscape(id), nil, &sb); err != nil {
			return fmt.Errorf("daytona: poll sandbox: %w", err)
		}
		switch strings.ToLower(sb.State) {
		case "started", "running":
			return nil
		case "error", "build_failed", "destroyed", "destroying":
			return fmt.Errorf("daytona: sandbox %s entered state %s", id, sb.State)
		}
		if d.Now().After(deadline) {
			return fmt.Errorf("daytona: sandbox %s not started after %s (state %s)", id, d.StartWait, sb.State)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(d.Poll):
		}
	}
}

func (d *Daytona) upload(ctx context.Context, id, remotePath string, content []byte) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", path.Base(remotePath))
	if err != nil {
		return err
	}
	if _, err := part.Write(content); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		d.APIURL+"/toolbox/"+url.PathEscape(id)+"/toolbox/files/upload?path="+url.QueryEscape(remotePath), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+d.APIKey)
	resp, err := d.Client.Do(req)
	if err != nil {
		return fmt.Errorf("daytona: upload prompt: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("daytona: upload prompt: HTTP %d", resp.StatusCode)
	}
	return nil
}

func (d *Daytona) openSession(ctx context.Context, id, sessionID string) error {
	if err := d.do(ctx, http.MethodPost, "/toolbox/"+url.PathEscape(id)+"/toolbox/process/session", map[string]string{"sessionId": sessionID}, nil); err != nil {
		return fmt.Errorf("daytona: open session: %w", err)
	}
	return nil
}

func (d *Daytona) exec(ctx context.Context, id, sessionID, command string) (string, error) {
	var out struct {
		CmdID string `json:"cmdId"`
	}
	err := d.do(ctx, http.MethodPost,
		"/toolbox/"+url.PathEscape(id)+"/toolbox/process/session/"+url.PathEscape(sessionID)+"/exec",
		map[string]any{"command": command, "runAsync": true}, &out)
	if err != nil {
		return "", fmt.Errorf("daytona: exec: %w", err)
	}
	if out.CmdID == "" {
		return "", errors.New("daytona: exec: no cmdId in response")
	}
	return out.CmdID, nil
}

// stream polls the command's logs, writing only the new suffix each round, until an exit
// code is reported or the context is cancelled.
func (d *Daytona) stream(ctx context.Context, id, sessionID, cmdID string, stdout io.Writer) (int, error) {
	base := "/toolbox/" + url.PathEscape(id) + "/toolbox/process/session/" + url.PathEscape(sessionID) + "/command/" + url.PathEscape(cmdID)
	written := 0
	for {
		logs, err := d.raw(ctx, http.MethodGet, base+"/logs")
		if err == nil && len(logs) > written {
			if _, werr := stdout.Write(logs[written:]); werr != nil {
				return ExitCodeUnavailable, werr
			}
			written = len(logs)
		}
		var cmd daytonaCommand
		if err := d.do(ctx, http.MethodGet, base, nil, &cmd); err != nil {
			if ctx.Err() != nil {
				return 128 + 15, nil // cancelled: the deferred destroy tears the sandbox down
			}
			return ExitCodeUnavailable, fmt.Errorf("daytona: poll command: %w", err)
		}
		if cmd.ExitCode != nil {
			// Drain any output that arrived between the last logs read and completion.
			if logs, err := d.raw(ctx, http.MethodGet, base+"/logs"); err == nil && len(logs) > written {
				_, _ = stdout.Write(logs[written:])
			}
			return *cmd.ExitCode, nil
		}
		select {
		case <-ctx.Done():
			return 128 + 15, nil
		case <-time.After(d.Poll):
		}
	}
}

func (d *Daytona) destroy(ctx context.Context, id string) error {
	return d.do(ctx, http.MethodDelete, "/sandbox/"+url.PathEscape(id)+"?force=true", nil, nil)
}

// do performs a JSON request against the API and decodes the response into out when non-nil.
func (d *Daytona) do(ctx context.Context, method, p string, body any, out any) error {
	data, err := d.raw(ctx, method, p, body)
	if err != nil {
		return err
	}
	if out != nil && len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode %s %s: %w", method, p, err)
		}
	}
	return nil
}

func (d *Daytona) raw(ctx context.Context, method, p string, body ...any) ([]byte, error) {
	var reader io.Reader
	if len(body) > 0 && body[0] != nil {
		encoded, err := json.Marshal(body[0])
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.APIURL+p, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.APIKey)
	req.Header.Set("Accept", "application/json")
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s %s: HTTP %d: %s", method, p, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return data, nil
}

// shellQuote single-quotes s for a POSIX shell.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// shellJoin quotes every argument so the sandbox shell sees the exact executor array.
func shellJoin(args []string) string {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = shellQuote(a)
	}
	return strings.Join(quoted, " ")
}
