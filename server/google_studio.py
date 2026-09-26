"""Local Google API settings and Gemini 3.8 speech generation."""

import base64
import json
import os
import pathlib
import re
import tempfile
import urllib.parse

from transcription import BASE, TranscriptionError, google_request


def config_path():
    if os.name == "nt":
        root = pathlib.Path(os.environ.get("LOCALAPPDATA") or pathlib.Path.home() / "AppData" / "Local")
    else:
        root = pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config")
    return root / "flow2short" / "google-api-key"


def read_key():
    try:
        return config_path().read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def save_key(key):
    key = str(key).strip()
    # Modern Google AI Studio authorization keys contain dots (e.g. AQ.…).
    if not re.fullmatch(r"[A-Za-z0-9_.-]{12,512}", key):
        raise TranscriptionError("فقط خود کلید Google AI Studio را، بدون فاصله یا متن اضافی، وارد کنید.")
    target = config_path()
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix="key-")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            output.write(key)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def list_voices(key, gender="female"):
    if gender not in {"female", "male", "neutral"}:
        raise TranscriptionError("انتخاب صدا معتبر نیست.")
    query = urllib.parse.urlencode({"language_code": "en-US", "gender": gender, "page_size": 100})
    response, _ = google_request(BASE + "/v1beta/voices?" + query, key)
    values = json.loads(response).get("voices", [])
    return [{"id": value.get("id") or value.get("name"),
             "name": value.get("displayName") or value.get("display_name") or value.get("id"),
             "description": value.get("description", "")}
            for value in values if (value.get("id") or value.get("name"))]


def synthesize(script, voice, style, model, key):
    if not isinstance(script, str) or not 1 <= len(script.strip()) <= 5000:
        raise TranscriptionError("متن نریشن باید بین ۱ تا ۵۰۰۰ نویسه باشد.")
    if not isinstance(voice, str) or not re.fullmatch(r"[A-Za-z0-9_-]{2,120}", voice):
        raise TranscriptionError("یک صدای معتبر انتخاب کنید.")
    if not isinstance(style, str) or len(style) > 240:
        raise TranscriptionError("توضیح لحن باید کوتاه باشد.")
    if model not in {"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"}:
        raise TranscriptionError("مدل صدا معتبر نیست.")
    payload = {"model": model, "input": [{"type": "user_input", "content": [{
        "type": "text", "text": script.strip(),
        "annotations": [{"type": "speech_metadata", "style": style.strip()}],
    }]}], "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]}}
    response, _ = google_request(BASE + "/v1beta/interactions", key,
                                 data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    interaction = json.loads(response)
    audio = [content for step in interaction.get("steps", []) if step.get("type") == "model_output"
             for content in step.get("content", []) if content.get("type") == "audio"]
    if not audio:
        raise TranscriptionError("پاسخ گوگل فایل صوتی نداشت.")
    try:
        wav = base64.b64decode(audio[-1]["data"], validate=True)
    except (ValueError, KeyError) as error:
        raise TranscriptionError("فایل صوتی Google معتبر نبود.") from error
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise TranscriptionError("پاسخ Google فایل WAV معتبر نداشت.")
    return wav
