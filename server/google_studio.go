package main

import (
    "bytes"
    "encoding/base64"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "os"
    "path/filepath"
    "regexp"
    "runtime"
    "strings"
)

func googleKeyPath() (string, error) {
    root := os.Getenv("XDG_CONFIG_HOME")
    if runtime.GOOS == "windows" { root = os.Getenv("LOCALAPPDATA") }
    if root == "" {
        home, err := os.UserHomeDir(); if err != nil { return "", err }
        if runtime.GOOS == "windows" { root = filepath.Join(home, "AppData", "Local") } else { root = filepath.Join(home, ".config") }
    }
    return filepath.Join(root, "flow2short", "google-api-key"), nil
}

func readGoogleKey() (string, error) {
    path, err := googleKeyPath(); if err != nil { return "", err }
    data, err := os.ReadFile(path)
    if errors.Is(err, os.ErrNotExist) { return "", nil }
    return strings.TrimSpace(string(data)), err
}

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{12,512}$`)
var voicePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{2,120}$`)

func storeGoogleKey(key string) error {
    key = strings.TrimSpace(key)
    if !keyPattern.MatchString(key) { return errors.New("فقط خود کلید Google AI Studio را، بدون فاصله یا متن اضافی، وارد کنید.") }
    path, err := googleKeyPath(); if err != nil { return err }
    if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil { return err }
    file, err := os.CreateTemp(filepath.Dir(path), "key-"); if err != nil { return err }
    defer os.Remove(file.Name())
    if err = file.Chmod(0600); err != nil { file.Close(); return err }
    if _, err = file.WriteString(key); err != nil { file.Close(); return err }
    if err = file.Close(); err != nil { return err }
    return os.Rename(file.Name(), path)
}

func googleStudioHTTP(w http.ResponseWriter, r *http.Request, port int) {
    w.Header().Set("Cache-Control", "no-store")
    respond := func(code int, value any) { w.Header().Set("Content-Type", "application/json; charset=utf-8"); w.WriteHeader(code); _ = json.NewEncoder(w).Encode(value) }
    address := fmt.Sprintf("127.0.0.1:%d", port)
    if r.Host != address || (r.Method != http.MethodGet && r.Header.Get("Origin") != "http://"+address) {
        respond(403, map[string]string{"error":"درخواست فقط از همین برنامه مجاز است."}); return
    }
    if r.URL.Path == "/__google_config" {
        switch r.Method {
        case http.MethodGet:
            key, err := readGoogleKey(); if err != nil { respond(500, map[string]string{"error":"خواندن تنظیمات ممکن نشد."}); return }
            respond(200, map[string]bool{"configured":key != ""})
        case http.MethodDelete:
            path, err := googleKeyPath(); if err == nil { err = os.Remove(path) }
            if err != nil && !errors.Is(err, os.ErrNotExist) { respond(500, map[string]string{"error":"حذف کلید ممکن نشد."}); return }
            respond(200, map[string]bool{"configured":false})
        case http.MethodPost:
            var payload struct { Key string `json:"key"` }
            if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&payload); err != nil { respond(400, map[string]string{"error":"کلید معتبر نیست."}); return }
            if err := storeGoogleKey(payload.Key); err != nil { respond(400, map[string]string{"error":err.Error()}); return }
            respond(200, map[string]bool{"configured":true})
        default: respond(405, map[string]string{"error":"روش درخواست پشتیبانی نمی‌شود."})
        }
        return
    }
    key, err := readGoogleKey()
    if err != nil || key == "" { respond(400, map[string]string{"error":"ابتدا کلید Google API را در تنظیمات ذخیره کنید."}); return }
    if r.URL.Path == "/__voices" {
        if r.Method != http.MethodGet { respond(405, map[string]string{"error":"روش درخواست پشتیبانی نمی‌شود."}); return }
        gender := r.URL.Query().Get("gender")
        if gender != "female" && gender != "male" && gender != "neutral" { respond(400, map[string]string{"error":"انتخاب صدا معتبر نیست."}); return }
        values := url.Values{"gender":{gender}, "language_code":{"en-US"}, "page_size":{"100"}}
        result, _, err := googleCall("GET", geminiEndpoint+"/v1beta/voices?"+values.Encode(), key, nil, nil)
        if err != nil { respond(400, map[string]string{"error":err.Error()}); return }
        var data struct { Voices []struct { ID string `json:"id"`; Name string `json:"name"`; DisplayName string `json:"displayName"`; Description string `json:"description"` } `json:"voices"` }
        if err = json.Unmarshal(result, &data); err != nil { respond(502, map[string]string{"error":"فهرست صدا قابل خواندن نیست."}); return }
        voices := []map[string]string{}
        for _, voice := range data.Voices { id := voice.ID; if id == "" { id = voice.Name }; name := voice.DisplayName; if name == "" { name = id }; if id != "" { voices = append(voices, map[string]string{"id":id, "name":name, "description":voice.Description}) } }
        respond(200, map[string]any{"voices":voices}); return
    }
    if r.Method != http.MethodPost { respond(405, map[string]string{"error":"روش درخواست پشتیبانی نمی‌شود."}); return }
    var data struct { Script string `json:"script"`; Voice string `json:"voice"`; Style string `json:"style"`; Model string `json:"model"` }
    if err := json.NewDecoder(io.LimitReader(r.Body, 20*1024)).Decode(&data); err != nil { respond(400, map[string]string{"error":"متن نریشن معتبر نیست."}); return }
    if len(strings.TrimSpace(data.Script)) == 0 || len([]rune(data.Script)) > 5000 || !voicePattern.MatchString(data.Voice) || len([]rune(data.Style)) > 240 || (data.Model != "gemini-3.8-flash-tts" && data.Model != "gemini-3.8-flash-lite-tts") {
        respond(400, map[string]string{"error":"متن، صدا یا مدل معتبر نیست."}); return
    }
    request, _ := json.Marshal(map[string]any{"model":data.Model,
        "input":[]any{map[string]any{"type":"user_input", "content":[]any{map[string]any{"type":"text", "text":strings.TrimSpace(data.Script), "annotations":[]any{map[string]string{"type":"speech_metadata", "style":strings.TrimSpace(data.Style)}}}}}},
        "response_format":map[string]string{"type":"audio"},
        "generation_config":map[string]any{"speech_config":[]any{map[string]string{"voice":data.Voice}}},
    })
    result, _, err := googleCall("POST", geminiEndpoint+"/v1beta/interactions", key, request, map[string]string{"Content-Type":"application/json"})
    if err != nil { respond(400, map[string]string{"error":err.Error()}); return }
    var interaction struct { Steps []struct { Type string `json:"type"`; Content []struct { Type string `json:"type"`; Data string `json:"data"` } `json:"content"` } `json:"steps"` }
    if err = json.Unmarshal(result, &interaction); err != nil { respond(502, map[string]string{"error":"پاسخ صدا قابل خواندن نیست."}); return }
    var wav []byte
    for _, step := range interaction.Steps { if step.Type == "model_output" { for _, part := range step.Content { if part.Type == "audio" { wav, err = base64.StdEncoding.DecodeString(part.Data) } } } }
    if err != nil || len(wav) < 44 || !bytes.Equal(wav[:4], []byte("RIFF")) || !bytes.Equal(wav[8:12], []byte("WAVE")) { respond(502, map[string]string{"error":"پاسخ Google فایل WAV معتبر نداشت."}); return }
    w.Header().Set("Content-Type", "audio/wav"); w.Header().Set("Content-Length", fmt.Sprint(len(wav))); _, _ = w.Write(wav)
}
