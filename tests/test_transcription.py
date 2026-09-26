import json
import pathlib
import sys
import unittest
from threading import Event
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "server"))
from transcription import transcribe, word_cues


RESPONSE = {"steps": [{"content": [{"annotations": [
    {"type": "word_info", "start_offset": "0.12s", "end_offset": "0.40s", "text": "Hello"},
    {"type": "word_info", "start_offset": "0.42s", "end_offset": "0.81s", "text": "world"},
]}]}]}


class TranscriptionTests(unittest.TestCase):
    def test_word_timing_stays_on_audio_timeline(self):
        self.assertEqual(word_cues(RESPONSE), [
            {"start": 0.12, "end": 0.4, "text": "Hello"},
            {"start": 0.42, "end": 0.81, "text": "world"},
        ])

    def test_upload_word_request_and_delete(self):
        requests = []
        deleted = Event()

        def fake_call(url, key, *, data=None, headers=None, method=None):
            requests.append((url, key, data, headers, method))
            if len(requests) == 1:
                return b"{}", {"x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/test"}
            if len(requests) == 2:
                return json.dumps({"file": {"name": "files/test123", "uri": "https://generativelanguage.googleapis.com/file/test"}}).encode(), {}
            if len(requests) == 3:
                return json.dumps(RESPONSE).encode(), {}
            deleted.set()
            return b"{}", {}

        with patch("transcription.google_request", side_effect=fake_call):
            result = transcribe(b"sample audio", "audio/mpeg", "test-key")
            self.assertTrue(deleted.wait(1), "temporary audio is deleted without blocking the response")
        self.assertEqual(len(result["cues"]), 2)
        self.assertEqual(len(requests), 4)
        payload = json.loads(requests[2][2])
        self.assertEqual(payload["generation_config"]["transcription_config"]["mode"]["timestamp_granularities"], ["word"])
        self.assertEqual(requests[3][4], "DELETE")

    def test_missing_word_timestamps_are_not_synthesized(self):
        self.assertEqual(word_cues({}), [])

if __name__ == "__main__":
    unittest.main()
