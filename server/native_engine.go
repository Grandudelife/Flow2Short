package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The desktop capability is injected by the native host, never served to a web page.
type nativeEngine struct {
	root, bin, token string
	mu               sync.Mutex
	fileMu           sync.Mutex
	cancel           context.CancelFunc
	done             chan struct{}
	closed           bool
}

func newNativeEngine() (*nativeEngine, error) {
	token := os.Getenv("FLOW2SHORT_DESKTOP_TOKEN")
	if len(token) < 32 {
		return nil, fmt.Errorf("missing desktop capability")
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	bin := filepath.Dir(executable)
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		if _, err = os.Stat(filepath.Join(bin, name)); err != nil {
			return nil, err
		}
	}
	root, err := os.MkdirTemp("", "flow2short-render-")
	if err != nil {
		return nil, err
	}
	return &nativeEngine{root: root, bin: bin, token: token}, nil
}

func (n *nativeEngine) authorized(r *http.Request, port int) bool {
	host := fmt.Sprintf("127.0.0.1:%d", port)
	origin := r.Header.Get("Origin")
	return r.Host == host && (origin == "" || origin == "http://"+host) &&
		subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Flow2Short-Desktop")), []byte(n.token)) == 1
}

func (n *nativeEngine) stop() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.cancel != nil {
		n.cancel()
	}
}

func (n *nativeEngine) close() {
	n.mu.Lock()
	n.closed = true
	if n.cancel != nil {
		n.cancel()
	}
	done := n.done
	n.mu.Unlock()
	if done != nil {
		<-done
	}
	n.fileMu.Lock()
	defer n.fileMu.Unlock()
	_ = os.RemoveAll(n.root)
}

var nativeName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$`)

func safeNativeName(s string) bool { return nativeName.MatchString(s) && !strings.Contains(s, "..") }

// Only options used by the editor are accepted. There is no shell command execution.
func validateNativeArgs(args []string, probe bool) error {
	if len(args) < 2 || len(args) > 1024 {
		return fmt.Errorf("invalid argument count")
	}
	options := map[string]bool{"-ss": true, "-t": true, "-i": true, "-f": true, "-filter_complex": true,
		"-map": true, "-c:v": true, "-c:a": true, "-preset": true, "-crf": true, "-b:a": true, "-ar": true,
		"-ac": true, "-movflags": true, "-r": true, "-safe": true, "-c": true, "-stream_loop": true,
		"-loop": true, "-framerate": true, "-v": true, "-select_streams": true, "-show_entries": true, "-of": true, "-o": true}
	lavfi := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "-an" || a == "-shortest" {
			continue
		}
		if strings.HasPrefix(a, "-") {
			if !options[a] || i+1 >= len(args) {
				return fmt.Errorf("unsupported option %s", a)
			}
			i++
			value := args[i]
			if len(value) > 100000 || strings.ContainsRune(value, 0) {
				return fmt.Errorf("invalid value")
			}
			if a == "-f" {
				lavfi = value == "lavfi"
			}
			if a == "-i" {
				if !(lavfi && value == "anullsrc=channel_layout=stereo:sample_rate=48000") && !safeNativeName(value) {
					return fmt.Errorf("invalid input")
				}
				lavfi = false
			}
			if a == "-o" && !safeNativeName(value) {
				return fmt.Errorf("invalid output")
			}
			if a == "-filter_complex" {
				for _, forbidden := range []string{"movie=", "amovie=", "textfile=", "filename=", "file:", "http:", "https:", "../", "\\"} {
					if strings.Contains(value, forbidden) {
						return fmt.Errorf("unsupported filter resource")
					}
				}
				if strings.Contains(value, "subtitles=") && !strings.Contains(value, "subtitles=captions.ass:fontsdir=.") {
					return fmt.Errorf("invalid subtitle path")
				}
			}
		} else if !safeNativeName(a) {
			return fmt.Errorf("invalid file name")
		}
	}
	if !probe && !safeNativeName(args[len(args)-1]) {
		return fmt.Errorf("missing output file")
	}
	return nil
}

type tailLog struct{ data []byte }

func (l *tailLog) Write(p []byte) (int, error) {
	size := len(p)
	l.data = append(l.data, p...)
	if len(l.data) > 32768 {
		l.data = l.data[len(l.data)-32768:]
	}
	return size, nil
}

func (n *nativeEngine) serveHTTP(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/__native/") {
		return false
	}
	respond := func(code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	fail := func(code int, message string) { respond(code, map[string]string{"error": message}) }
	switch r.URL.Path {
	case "/__native/load":
		if r.Method != http.MethodPost {
			fail(405, "Method not allowed")
			break
		}
		respond(200, map[string]bool{"native": true})
	case "/__native/file":
		name := r.URL.Query().Get("name")
		if !safeNativeName(name) {
			fail(400, "Invalid file name")
			break
		}
		n.fileMu.Lock()
		defer n.fileMu.Unlock()
		path := filepath.Join(n.root, name)
		switch r.Method {
		case http.MethodPut:
			// Atomically replace uploads so cancellation cannot leave partial media.
			f, err := os.CreateTemp(n.root, "upload-")
			if err != nil {
				fail(500, "Cannot create temporary file")
				break
			}
			defer os.Remove(f.Name())
			_, err = io.Copy(f, http.MaxBytesReader(w, r.Body, 4<<30))
			closeErr := f.Close()
			if err != nil || closeErr != nil {
				fail(400, "Upload failed or exceeds 4 GB")
				break
			}
			if name == "concat.txt" {
				content, _ := os.ReadFile(f.Name())
				valid := regexp.MustCompile(`^file 'segment-[0-9]+\.mp4'$`)
				for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
					if !valid.MatchString(line) {
						fail(400, "Invalid concat list")
						return true
					}
				}
			}
			if err = os.Rename(f.Name(), path); err != nil {
				fail(500, "Cannot save temporary media")
				break
			}
			respond(200, map[string]bool{"ok": true})
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/octet-stream")
			http.ServeFile(w, r, path)
		case http.MethodDelete:
			err := os.Remove(path)
			if err != nil && !os.IsNotExist(err) {
				fail(500, "Cannot remove temporary media")
				break
			}
			respond(200, map[string]bool{"ok": true})
		default:
			fail(405, "Method not allowed")
		}
	case "/__native/exec", "/__native/probe":
		if r.Method != http.MethodPost {
			fail(405, "Method not allowed")
			break
		}
		var payload struct {
			Args []string `json:"args"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
			fail(400, "Invalid arguments")
			break
		}
		probe := r.URL.Path == "/__native/probe"
		if err := validateNativeArgs(payload.Args, probe); err != nil {
			fail(400, err.Error())
			break
		}
		n.mu.Lock()
		if n.closed || n.cancel != nil {
			n.mu.Unlock()
			fail(409, "Render engine is busy or closed")
			break
		}
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Hour)
		done := make(chan struct{})
		n.cancel = cancel
		n.done = done
		n.mu.Unlock()
		defer func() {
			cancel()
			n.mu.Lock()
			n.cancel = nil
			close(done)
			n.done = nil
			n.mu.Unlock()
		}()
		name := "ffmpeg"
		args := append([]string{"-nostdin", "-y", "-hide_banner"}, payload.Args...)
		if probe {
			name = "ffprobe"
			args = append([]string{"-hide_banner"}, payload.Args...)
		}
		command := exec.CommandContext(ctx, filepath.Join(n.bin, name), args...)
		command.Dir = n.root
		log := &tailLog{}
		command.Stdout = log
		command.Stderr = log
		err := command.Run()
		code := 0
		if err != nil {
			code = 1
			if e, ok := err.(*exec.ExitError); ok {
				code = e.ExitCode()
			}
		}
		respond(200, map[string]any{"code": code, "log": string(bytes.ToValidUTF8(log.data, []byte("?")))})
	case "/__native/stop":
		if r.Method != http.MethodPost {
			fail(405, "Method not allowed")
			break
		}
		n.mu.Lock()
		if n.cancel != nil {
			n.cancel()
		}
		done := n.done
		n.mu.Unlock()
		if done != nil {
			<-done
		}
		n.fileMu.Lock()
		_ = os.RemoveAll(n.root)
		err := os.MkdirAll(n.root, 0700)
		n.fileMu.Unlock()
		if err != nil {
			fail(500, "Cannot reset render engine")
			break
		}
		respond(200, map[string]bool{"ok": true})
	default:
		fail(404, "Not found")
	}
	return true
}
