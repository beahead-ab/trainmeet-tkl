import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from terminal.trainmeet_tkl_terminal import TerminalApplication, normalize_server_url, split_nmcli_fields


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class TerminalApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.application = TerminalApplication(root / "web", root / "state")

    def tearDown(self):
        self.temporary.cleanup()

    def test_profile_is_unconfigured_until_server_and_station_are_saved(self):
        self.assertFalse(self.application.read_config()["configured"])
        saved = self.application.save_config({
            "terminal_name": "CDA TKL 1",
            "server_url": "trainmeet.local:8787/",
            "station_id": "cda",
            "station_name": "Charlottendal",
            "orientation": "portrait",
        })
        self.assertTrue(saved["configured"])
        self.assertEqual(saved["server_url"], "http://trainmeet.local:8787")
        self.assertEqual(self.application.read_config()["station_id"], "cda")

    @patch("terminal.trainmeet_tkl_terminal.urlopen")
    def test_last_runtime_is_used_offline(self, mocked_urlopen):
        snapshot = {"meet": {"name": "Test"}, "stations": [{"id": "cda"}]}
        mocked_urlopen.return_value = FakeResponse(snapshot)
        self.application.save_config({
            "terminal_name": "CDA TKL 1",
            "server_url": "http://server.local:8787",
            "station_id": "cda",
            "orientation": "portrait",
        })
        online = self.application.runtime_result()
        self.assertTrue(online["connected"])

        mocked_urlopen.side_effect = OSError("offline")
        offline = self.application.runtime_result()
        self.assertFalse(offline["connected"])
        self.assertEqual(offline["source"], "cache")
        self.assertEqual(offline["snapshot"], snapshot)

    @patch("terminal.trainmeet_tkl_terminal.urlopen")
    def test_the_meets_texts_are_read_without_a_token_and_kept_for_offline(self, mocked_urlopen):
        about = {"meet": {"name": "Värnamo", "language": "sv"}, "about": {"story": "# Tema", "instructions": {"sv": "Ring"}, "program": ""},
                 "stations": [{"id": "rise", "name": "Rise", "instructions": "Kritisk"}]}
        mocked_urlopen.return_value = FakeResponse(about)
        self.application.save_config({"terminal_name": "Rise TKL", "server_url": "http://server.local:8787", "station_id": "rise", "orientation": "portrait"})
        self.assertEqual(about, self.application.about_result())
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual("http://server.local:8787/v1/about", request.full_url)
        self.assertNotIn("Authorization", request.headers)
        mocked_urlopen.side_effect = OSError("offline")
        self.assertEqual(about, self.application.about_result())

    @patch("terminal.trainmeet_tkl_terminal.urlopen")
    def test_texts_never_read_cannot_be_shown_offline(self, mocked_urlopen):
        mocked_urlopen.side_effect = OSError("offline")
        self.application.save_config({"terminal_name": "Rise TKL", "server_url": "http://server.local:8787", "station_id": "rise", "orientation": "portrait"})
        with self.assertRaisesRegex(RuntimeError, "Texterna gick inte att läsa"):
            self.application.about_result()

    def test_only_http_server_urls_are_accepted(self):
        self.assertEqual(normalize_server_url("server.local:8787"), "http://server.local:8787")
        self.assertEqual(normalize_server_url("file:///etc/passwd"), "")

    def test_nmcli_parser_keeps_colons_inside_ssid(self):
        self.assertEqual(
            split_nmcli_fields(r"*:TrainMeet\:lokal:87:WPA2"),
            ["*", "TrainMeet:lokal", "87", "WPA2"],
        )


if __name__ == "__main__":
    unittest.main()
