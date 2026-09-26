package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxTranscriptionAudio = 35 * 1024 * 1024
const geminiEndpoint = "https://generativelanguage.googleapis.com"

var fileNamePattern = regexp.MustCompile(`^files/[A-Za-z0-9_-]+$`)
var offsetPattern = regexp.MustCompile(`^\d+(\.\d+)?s$`)
var googleClient = &http.Client{Timeout: 180 * time.Second}

type wordCue struct {
	Start float64 `json:"start"`
	End float64 `json:"end"`
	Text string `json:"text"`
}

func googleCall(method, address, key string, body []byte, headers map[string]string) ([]byte, http.Header, error) {
	request, err := http.NewRequest(method, address, bytes.NewReader(body))
	if err != nil { return nil, nil, err }
	request.Header.Set("x-goog-api-key", key)
	for name, value := range headers { request.Header.Set(name, value) }
	response, err := googleClient.Do(request)
	if err != nil { return nil, nil, errors.New("ارتباط با Google API برقرار نشد.") }
	defer response.Body.Close()
	content, err := io.ReadAll(io.LimitReader(response.Body, 40*1024*1024))
	if err != nil { return nil, nil, err }
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var result struct { Error struct { Message string `json:"message"` } `json:"error"` }
		_ = json.Unmarshal(content, &result)
		if result.Error.Message == "" { result.Error.Message = "درخواست رد شد." }
		return nil, nil, fmt.Errorf("Google API (%d): %s", response.StatusCode, result.Error.Message)
	}
	return content, response.Header, nil
}

func parseWordCues(content []byte) ([]wordCue, error) {
	var interaction struct {
		Steps []struct {
			Content []struct {
				Annotations []struct {
					Type string `json:"type"`
					Text string `json:"text"`
					Start string `json:"start_offset"`
					End string `json:"end_offset"`
				} `json:"annotations"`
			} `json:"content"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(content, &interaction); err != nil { return nil, errors.New("پاسخ رونویسی معتبر نیست.") }
	words := []wordCue{}
	for _, step := range interaction.Steps {
		for _, item := range step.Content {
			for _, annotation := range item.Annotations {
				if annotation.Type != "word_info" || !offsetPattern.MatchString(annotation.Start) || !offsetPattern.MatchString(annotation.End) { continue }
				start, _ := strconv.ParseFloat(strings.TrimSuffix(annotation.Start, "s"), 64)
				end, _ := strconv.ParseFloat(strings.TrimSuffix(annotation.End, "s"), 64)
				text := strings.TrimSpace(annotation.Text)
				if start >= 0 && end > start && text != "" { words = append(words, wordCue{start, end, text}) }
			}
		}
	}
	sort.SliceStable(words, func(i, j int) bool { return words[i].Start < words[j].Start })
	if len(words) == 0 { return nil, errors.New("پاسخ Google زمان‌بندی کلمه‌ای نداشت؛ زیرنویس قبلی حفظ شد.") }
	return words, nil
}

func transcribeAudio(audio []byte, mime, key string) ([]wordCue, error) {
	if len(audio) == 0 || len(audio) > maxTranscriptionAudio { return nil, errors.New("حجم فایل صوتی باید کمتر از ۳۵ مگابایت باشد.") }
	supported := map[string]bool{"audio/mpeg":true,"audio/mp3":true,"audio/wav":true,"audio/x-wav":true,"audio/mp4":true,"audio/aac":true,"audio/ogg":true,"audio/webm":true,"audio/flac":true}
	if !supported[mime] { return nil, errors.New("فرمت صوتی پشتیبانی نمی‌شود؛ از MP3، WAV یا M4A استفاده کنید.") }
	if len(key) == 0 || len(key) > 512 || strings.ContainsAny(key, "\r\n") { return nil, errors.New("کلید Gemini API معتبر نیست.") }
	metadata := []byte(`{"file":{"display_name":"Flow2Short narration"}}`)
	_, responseHeaders, err := googleCall("POST", geminiEndpoint+"/upload/v1beta/files", key, metadata, map[string]string{
		"Content-Type":"application/json", "X-Goog-Upload-Protocol":"resumable", "X-Goog-Upload-Command":"start",
		"X-Goog-Upload-Header-Content-Length":strconv.Itoa(len(audio)), "X-Goog-Upload-Header-Content-Type":mime,
	})
	if err != nil { return nil, err }
	uploadURL := responseHeaders.Get("X-Goog-Upload-URL")
	parsed, err := url.Parse(uploadURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "generativelanguage.googleapis.com" { return nil, errors.New("آدرس آپلود Google معتبر نیست.") }
	uploaded, _, err := googleCall("POST", uploadURL, key, audio, map[string]string{
		"Content-Type":mime, "X-Goog-Upload-Offset":"0", "X-Goog-Upload-Command":"upload, finalize",
	})
	if err != nil { return nil, err }
	var fileInfo struct { File struct { Name string `json:"name"`; URI string `json:"uri"` } `json:"file"` }
	if err := json.Unmarshal(uploaded, &fileInfo); err != nil || !fileNamePattern.MatchString(fileInfo.File.Name) || fileInfo.File.URI == "" { return nil, errors.New("بارگذاری فایل صوتی کامل نشد.") }
	defer func() { go func(name, apiKey string) { _, _, _ = googleCall("DELETE", geminiEndpoint+"/v1beta/"+name, apiKey, nil, nil) }(fileInfo.File.Name, key) }()
	requestBody, _ := json.Marshal(map[string]any{
		"model":"gemini-3.5-transcribe",
		"input":[]map[string]string{{"type":"audio", "uri":fileInfo.File.URI, "mime_type":mime}},
		"generation_config":map[string]any{"transcription_config":map[string]any{
			"language_codes":[]string{"en-US"},
			"mode":map[string]any{"type":"verbatim", "timestamp_granularities":[]string{"word"}},
		}},
	})
	result, _, err := googleCall("POST", geminiEndpoint+"/v1beta/interactions", key, requestBody, map[string]string{"Content-Type":"application/json"})
	if err != nil { return nil, err }
	return parseWordCues(result)
}

func transcribeHTTP(response http.ResponseWriter, request *http.Request, port int) {
	response.Header().Set("Cache-Control", "no-store")
	respond := func(status int, value any) {
		response.Header().Set("Content-Type", "application/json; charset=utf-8")
		response.WriteHeader(status)
		_ = json.NewEncoder(response).Encode(value)
	}
	if request.Method != http.MethodPost { respond(405, map[string]string{"error":"روش درخواست پشتیبانی نمی‌شود."}); return }
	address := fmt.Sprintf("127.0.0.1:%d", port)
	if request.Host != address || request.Header.Get("Origin") != "http://"+address {
		respond(403, map[string]string{"error":"درخواست فقط از همین برنامه مجاز است."}); return
	}
	length := request.ContentLength
	if length <= 0 || length > maxTranscriptionAudio { respond(400, map[string]string{"error":"حجم فایل صوتی باید کمتر از ۳۵ مگابایت باشد."}); return }
	audio, err := io.ReadAll(io.LimitReader(request.Body, maxTranscriptionAudio+1))
	if err != nil || len(audio) != int(length) { respond(400, map[string]string{"error":"خواندن صدا ممکن نشد."}); return }
	mime := strings.TrimSpace(strings.SplitN(request.Header.Get("Content-Type"), ";", 2)[0])
	key, err := readGoogleKey()
	if err != nil || key == "" { respond(400, map[string]string{"error":"ابتدا کلید Google API را در تنظیمات ذخیره کنید."}); return }
	words, err := transcribeAudio(audio, mime, key)
	if err != nil { respond(400, map[string]string{"error":err.Error()}); return }
	respond(200, map[string]any{"cues":words})
}
