"""Same-origin, memory-only Gemini transcription for the local Flow2Short server."""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from threading import Thread

BASE = "https://generativelanguage.googleapis.com"
MAX_AUDIO_BYTES = 35 * 1024 * 1024


class TranscriptionError(Exception):
    pass


def google_request(url, key, *, data=None, headers=None, method=None):
    request = urllib.request.Request(
        url, data=data, method=method,
        headers={"x-goog-api-key": key, **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=150) as response:
            return response.read(), response.headers
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read(4096)).get("error", {}).get("message", "")
        except (ValueError, AttributeError):
            detail = ""
        raise TranscriptionError(f"Google API ({error.code}): {detail or 'درخواست رد شد.'}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise TranscriptionError("ارتباط با Google API برقرار نشد.") from error


def word_cues(interaction):
    words = []
    for step in interaction.get("steps", []):
        for content in step.get("content", []):
            for item in content.get("annotations", []):
                if item.get("type") != "word_info":
                    continue
                start = item.get("start_offset", "")
                end = item.get("end_offset", "")
                if not re.fullmatch(r"\d+(?:\.\d+)?s", start) or not re.fullmatch(r"\d+(?:\.\d+)?s", end):
                    continue
                start_time, end_time = float(start[:-1]), float(end[:-1])
                text = str(item.get("text", "")).strip()
                if 0 <= start_time < end_time and text:
                    words.append({"start": start_time, "end": end_time, "text": text})
    words.sort(key=lambda cue: cue["start"])
    return words


def transcribe(audio, mime, key):
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise TranscriptionError("حجم فایل صوتی باید کمتر از ۳۵ مگابایت باشد.")
    if mime not in {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac"}:
        raise TranscriptionError("فرمت صوتی پشتیبانی نمی‌شود؛ از MP3، WAV یا M4A استفاده کنید.")
    if not key or len(key) > 512 or "\n" in key or "\r" in key:
        raise TranscriptionError("کلید Gemini API معتبر نیست.")
    name = None
    try:
        metadata, headers = google_request(
            BASE + "/upload/v1beta/files", key,
            data=json.dumps({"file": {"display_name": "Flow2Short narration"}}).encode(),
            headers={"Content-Type": "application/json", "X-Goog-Upload-Protocol": "resumable",
                     "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": str(len(audio)),
                     "X-Goog-Upload-Header-Content-Type": mime},
        )
        upload_url = headers.get("x-goog-upload-url", "")
        parsed = urllib.parse.urlparse(upload_url)
        if parsed.scheme != "https" or parsed.hostname != "generativelanguage.googleapis.com":
            raise TranscriptionError("آدرس آپلود Google معتبر نیست.")
        file_bytes, _ = google_request(
            upload_url, key, data=audio,
            headers={"Content-Type": mime, "X-Goog-Upload-Offset": "0",
                     "X-Goog-Upload-Command": "upload, finalize"},
        )
        uploaded = json.loads(file_bytes).get("file", {})
        name, uri = uploaded.get("name"), uploaded.get("uri")
        if not uri or not name or not re.fullmatch(r"files/[A-Za-z0-9_-]+", name):
            raise TranscriptionError("بارگذاری فایل صوتی کامل نشد.")
        payload = {
            "model": "gemini-3.5-transcribe",
            "input": [{"type": "audio", "uri": uri, "mime_type": mime}],
            "generation_config": {"transcription_config": {
                "language_codes": ["en-US"],
                "mode": {"type": "verbatim", "timestamp_granularities": ["word"]},
            }},
        }
        response, _ = google_request(
            BASE + "/v1beta/interactions", key, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        result = json.loads(response)
        cues = word_cues(result)
        if not cues:
            raise TranscriptionError("پاسخ Google زمان‌بندی کلمه‌ای نداشت؛ زیرنویس قبلی حفظ شد.")
        return {"cues": cues}
    except (ValueError, KeyError) as error:
        raise TranscriptionError("پاسخ سرویس رونویسی قابل خواندن نبود.") from error
    finally:
        if name and re.fullmatch(r"files/[A-Za-z0-9_-]+", name):
            def cleanup():
                try:
                    google_request(BASE + "/v1beta/" + name, key, method="DELETE")
                except TranscriptionError:
                    pass
            Thread(target=cleanup, name="flow2short-google-file-cleanup", daemon=True).start()
