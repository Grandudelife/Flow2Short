package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopCapability(t *testing.T) {
	n := &nativeEngine{token: strings.Repeat("a", 64)}
	request := httptest.NewRequest("POST", "http://127.0.0.1:43121/__native/exec", nil)
	if n.authorized(request, 43121) {
		t.Fatal("request without capability was accepted")
	}
	request.Header.Set("X-Flow2Short-Desktop", n.token)
	if !n.authorized(request, 43121) {
		t.Fatal("desktop request rejected")
	}
	request.Header.Set("Origin", "https://example.com")
	if n.authorized(request, 43121) {
		t.Fatal("foreign origin accepted")
	}
	request.Header.Set("Origin", "http://127.0.0.1:43121")
	request.Host = "evil.example:43121"
	if n.authorized(request, 43121) {
		t.Fatal("foreign host accepted")
	}
}

func TestNativePathsAndArguments(t *testing.T) {
	for _, s := range []string{"../key", "/etc/passwd", "a/../../secret", "a\\secret", "https://example.com", "..", "-file"} {
		if safeNativeName(s) {
			t.Fatalf("unsafe name accepted: %s", s)
		}
	}
	valid := []string{"-i", "input-0.mp4", "-filter_complex", "[0:v]scale=720:1280[v]", "-map", "[v]", "-c:v", "libx264", "segment-00.mp4"}
	if err := validateNativeArgs(valid, false); err != nil {
		t.Fatal(err)
	}
	invalid := [][]string{
		{"-i", "/etc/passwd", "final.mp4"},
		{"-i", "https://example.com/video", "final.mp4"},
		{"-i", "input-0.mp4", "-filter_complex", "movie=/private/file[out]", "final.mp4"},
		{"-i", "input-0.mp4", "-filter_complex", "[0:v]subtitles=/private/file[out]", "final.mp4"},
		{"-i", "input-0.mp4", "-report", "final.mp4"},
	}
	for _, args := range invalid {
		if validateNativeArgs(args, false) == nil {
			t.Fatalf("unsafe args accepted: %v", args)
		}
	}
}

func TestNativeUploadsAndCleanup(t *testing.T) {
	root := filepath.Join(t.TempDir(), "render")
	_ = os.Mkdir(root, 0700)
	n := &nativeEngine{root: root}
	upload := httptest.NewRequest("PUT", "http://localhost/__native/file?name=input-0.mp4", strings.NewReader("media"))
	w := httptest.NewRecorder()
	n.serveHTTP(w, upload)
	if w.Code != 200 {
		t.Fatalf("upload failed: %s", w.Body.String())
	}
	data, _ := os.ReadFile(filepath.Join(root, "input-0.mp4"))
	if string(data) != "media" {
		t.Fatal("upload corrupted")
	}
	// Windows must also replace a previously uploaded filename after its handle closes.
	w = httptest.NewRecorder()
	n.serveHTTP(w, httptest.NewRequest("PUT", "http://localhost/__native/file?name=input-0.mp4", strings.NewReader("replacement")))
	data, _ = os.ReadFile(filepath.Join(root, "input-0.mp4"))
	if w.Code != 200 || string(data) != "replacement" {
		t.Fatal("replacing an existing upload failed")
	}
	bad := httptest.NewRequest("PUT", "http://localhost/__native/file?name=concat.txt", strings.NewReader("file '/etc/passwd'"))
	w = httptest.NewRecorder()
	n.serveHTTP(w, bad)
	if w.Code != 400 {
		t.Fatal("unsafe concat list accepted")
	}
	if _, err := os.Stat(filepath.Join(root, "concat.txt")); !os.IsNotExist(err) {
		t.Fatal("unsafe concat list saved")
	}
	w = httptest.NewRecorder()
	n.serveHTTP(w, httptest.NewRequest("POST", "http://localhost/__native/stop", nil))
	files, _ := os.ReadDir(root)
	if len(files) != 0 {
		t.Fatal("cancel did not clean media")
	}
	n.close()
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("close did not clean session")
	}
}
