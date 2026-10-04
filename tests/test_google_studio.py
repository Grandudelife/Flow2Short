import base64
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "server"))
from google_studio import list_voices, read_key, save_key, synthesize


class GoogleStudioTests(unittest.TestCase):
    def test_key_is_persistent_outside_project_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "flow2short" / "google-api-key"
            with patch("google_studio.config_path", return_value=target):
                save_key("AQ.Ab123_456-789.example")
                self.assertEqual(read_key(), "AQ.Ab123_456-789.example")
                if os.name == 'nt':
                    # Windows uses inherited user ACLs, not POSIX permission bits.
                    acl = subprocess.run(
                        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                         '(Get-Acl -LiteralPath $env:FLOW2SHORT_TEST_KEY_PATH).Sddl'],
                        env={**os.environ, 'FLOW2SHORT_TEST_KEY_PATH': str(target)},
                        capture_output=True, text=True, check=True).stdout
                    self.assertTrue(acl.strip(), 'Windows ACL was unavailable')
                    self.assertIsNone(re.search(r'\(A;[^)]*;(?:WD|BU|AU|S-1-1-0|S-1-5-11|S-1-5-32-545)\)', acl),
                                      'API key readable by broad Windows user groups')
                else:
                    self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_voice_filter_and_speech_metadata_are_sent_to_google(self):
        wav = b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 40
        calls = []

        def fake_request(url, key, *, data=None, headers=None):
            calls.append((url, key, data))
            if url.endswith("/v1beta/interactions"):
                return json.dumps({"steps": [{"type": "model_output", "content": [
                    {"type": "audio", "data": base64.b64encode(wav).decode()}]}]}).encode(), {}
            return json.dumps({"voices": [{"id": "Kore", "displayName": "Kore", "description": "Clear"}]}).encode(), {}

        with patch("google_studio.google_request", side_effect=fake_request):
            voices = list_voices("test-key-for-google", "female")
            audio = synthesize("Hello world.", voices[0]["id"], "warm, speaking slowly", "gemini-3.8-flash-tts", "test-key-for-google")
        self.assertEqual(audio, wav)
        self.assertIn("gender=female", calls[0][0])
        payload = json.loads(calls[1][2])
        self.assertEqual(payload["input"][0]["content"][0]["text"], "Hello world.")
        self.assertEqual(payload["input"][0]["content"][0]["annotations"][0]["style"], "warm, speaking slowly")
        self.assertEqual(payload["generation_config"]["speech_config"][0]["voice"], "Kore")


if __name__ == "__main__":
    unittest.main()
