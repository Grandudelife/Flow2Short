package main

import (
	"flag"
	"fmt"
	"io"
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
	desktop := flag.Bool("desktop", false, "Run inside the native desktop application")
	flag.Parse()
	appDir := appDirectory()
	if appDir == "" {
		log.Fatal("پوشه app کنار برنامه پیدا نشد.")
	}

	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")

	var listener net.Listener
	var err error
	port := 43121
	if *desktop {
		port = 0
	}
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
	port = listener.Addr().(*net.TCPAddr).Port
	var native *nativeEngine
	if *desktop {
		native, err = newNativeEngine()
		if err != nil {
			log.Fatal(err)
		}
		defer native.close()
	}

	files := http.FileServer(http.Dir(appDir))
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("Cache-Control", "no-store")
		if *desktop && len(request.URL.Path) >= 3 && request.URL.Path[:3] == "/__" {
			if !native.authorized(request, port) {
				http.Error(response, "Forbidden", 403)
				return
			}
			if native.serveHTTP(response, request) {
				return
			}
		}
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
	if *desktop {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			native.close()
			_ = server.Close()
		}()
		fmt.Println(url)
	} else {
		go func() {
			time.Sleep(350 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("مرورگر خودکار باز نشد؛ این آدرس را باز کنید: %s", url)
			}
		}()
	}

	if !*desktop {
		fmt.Println("Flow2Short Studio در مرورگر باز شد.")
		fmt.Println("برای بستن برنامه این پنجره را ببندید.")
	}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
