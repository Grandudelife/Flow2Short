package main

import (
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func appDirectory() string {
	executable, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(executable), "app")
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate
		}
	}
	if info, err := os.Stat("app"); err == nil && info.IsDir() {
		absolute, _ := filepath.Abs("app")
		return absolute
	}
	return ""
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", url)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	return command.Start()
}

func main() {
	appDir := appDirectory()
	if appDir == "" {
		log.Fatal("پوشه app کنار برنامه پیدا نشد.")
	}

	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")

	var listener net.Listener
	var err error
	port := 43121
	for attempt := 0; attempt < 10; attempt++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port+attempt))
		if err == nil {
			port += attempt
			break
		}
	}
	if err != nil {
		log.Fatal("درگاه محلی آزاد پیدا نشد: ", err)
	}

	files := http.FileServer(http.Dir(appDir))
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		if request.URL.Path == "/__transcribe" {
			transcribeHTTP(response, request, port)
			return
		}
		if request.URL.Path == "/__google_config" || request.URL.Path == "/__tts" || request.URL.Path == "/__voices" {
			googleStudioHTTP(response, request, port)
			return
		}
		if request.URL.Path == "/__health" {
			response.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = response.Write([]byte("ok"))
			return
		}
		files.ServeHTTP(response, request)
	})

	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		time.Sleep(350 * time.Millisecond)
		if err := openBrowser(url); err != nil {
			log.Printf("مرورگر خودکار باز نشد؛ این آدرس را باز کنید: %s", url)
		}
	}()

	fmt.Println("Flow2Short Studio در مرورگر باز شد.")
	fmt.Println("برای بستن برنامه این پنجره را ببندید.")
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
