"""Local static server with an opt-in, same-origin transcription endpoint."""

import json
import pathlib
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from transcription import MAX_AUDIO_BYTES, TranscriptionError, transcribe
from google_studio import list_voices, read_key, save_key, config_path, synthesize


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.startswith("/__") or self.path.split("?")[0] in {"/", "/index.html", "/app.js", "/styles.css"}:
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def allowed(self):
        origin = self.headers.get("Origin", "")
        allowed = f"http://127.0.0.1:{self.server.server_port}"
        return origin == allowed and self.headers.get("Host") == allowed[7:] and self.client_address[0].startswith("127.")

    def do_GET(self):
        if self.path.startswith("/__google_config") or self.path.startswith("/__voices"):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or not self.client_address[0].startswith("127."):
                self.json_response(403, {"error": "دسترسی غیرمجاز است."})
                return
            if self.path == "/__google_config":
                self.json_response(200, {"configured": bool(read_key())})
                return
            if self.path.startswith("/__voices?"):
                try:
                    from urllib.parse import parse_qs, urlsplit
                    key = read_key()
                    if not key:
                        raise TranscriptionError("ابتدا کلید Google API را در تنظیمات ذخیره کنید.")
                    gender = parse_qs(urlsplit(self.path).query).get("gender", ["female"])[0]
                    self.json_response(200, {"voices": list_voices(key, gender)})
                except (TranscriptionError, ValueError) as error:
                    self.json_response(400, {"error": str(error)})
                return
            self.send_error(404)
            return
        super().do_GET()

    def do_DELETE(self):
        if self.path != "/__google_config":
            self.send_error(404)
            return
        if not self.allowed():
            self.json_response(403, {"error": "درخواست فقط از همین برنامه مجاز است."})
            return
        config_path().unlink(missing_ok=True)
        self.json_response(200, {"configured": False})

    def do_POST(self):
        if self.path not in {"/__transcribe", "/__google_config", "/__tts"}:
            self.send_error(404)
            return
        if not self.allowed():
            self.json_response(403, {"error": "درخواست فقط از همین برنامه مجاز است."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if self.path == "/__google_config":
                if not 0 < size < 1024:
                    raise TranscriptionError("کلید Google API معتبر نیست.")
                save_key(json.loads(self.rfile.read(size)).get("key", ""))
                self.json_response(200, {"configured": True})
                return
            if self.path == "/__tts":
                if not 0 < size <= 20 * 1024:
                    raise TranscriptionError("متن نریشن بیش از اندازه بلند است.")
                data = json.loads(self.rfile.read(size))
                key = read_key()
                if not key:
                    raise TranscriptionError("ابتدا کلید Google API را در تنظیمات ذخیره کنید.")
                wav = synthesize(data.get("script", ""), data.get("voice", ""),
                                 data.get("style", ""), data.get("model", ""), key)
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav)))
                self.end_headers()
                self.wfile.write(wav)
                return
            if not 0 < size <= MAX_AUDIO_BYTES:
                raise TranscriptionError("حجم فایل صوتی باید کمتر از ۳۵ مگابایت باشد.")
            mime = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            key = read_key()
            if not key:
                raise TranscriptionError("ابتدا کلید Google API را در تنظیمات ذخیره کنید.")
            result = transcribe(self.rfile.read(size), mime, key)
            self.json_response(200, result)
        except (TranscriptionError, ValueError, KeyError) as error:
            self.json_response(400, {"error": str(error)})
        except Exception:
            self.json_response(502, {"error": "پاسخ سرویس رونویسی دریافت نشد."})

    def json_response(self, status, data):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main():
    port, directory = int(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(directory)))
    print(f"Flow2Short: http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
