import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

import consent_preferences as consent


class ConsentPreferencesTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "thingtime" / "consent-preferences.json"

    def invoke(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            status = consent.run(list(args), self.path)
        return status, json.loads(output.getvalue()) if output.getvalue() else None

    def test_exact_match_and_revocation(self):
        status, grant = self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                                    "--account", "owner-1", "--action", "update", "--target", "thing-1")
        self.assertEqual(status, 0)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        for expected, origin, account, action, target in [
            (True, "https://thingtime.com", "owner-1", "update", "thing-1"),
            (False, "https://other.example", "owner-1", "update", "thing-1"),
            (False, "https://thingtime.com", "owner-2", "update", "thing-1"),
            (False, "https://thingtime.com", "owner-1", "create", "thing-1"),
            (False, "https://thingtime.com", "owner-1", "update", "thing-2"),
            (False, "https://thingtime.com", "owner-1", "delete", "thing-1"),
        ]:
            status, decision = self.invoke("check", "--origin", origin, "--account", account,
                                           "--action", action, "--target", target)
            self.assertEqual((status, decision), (0, {"allowed": expected}))
        self.assertEqual(self.invoke("revoke", "--id", grant["id"])[0], 0)
        self.assertEqual(self.invoke("check", "--origin", "https://thingtime.com", "--account", "owner-1",
                                     "--action", "update", "--target", "thing-1")[1], {"allowed": False})

    def test_rejects_unsafe_scope_and_malformed_store_without_overwrite(self):
        for args in [
            ("--origin", "https://user:pass@thingtime.com", "--account", "owner-1", "--action", "update", "--target", "thing-1"),
            ("--origin", "https://thingtime.com", "--account", "owner-1", "--action", "share", "--target", "thing-1"),
            ("--origin", "https://thingtime.com", "--account", "owner-1", "--action", "update", "--target", "*"),
        ]:
            self.assertEqual(self.invoke("grant", "--user-consented", *args)[0], 1)
        self.assertFalse(self.path.exists())
        self.path.parent.mkdir()
        self.path.write_text('{"version":99,"grants":[]}', encoding="utf-8")
        self.assertEqual(self.invoke("check", "--origin", "https://thingtime.com", "--account", "owner-1",
                                     "--action", "update", "--target", "thing-1")[0], 1)
        self.assertEqual(self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                                     "--account", "owner-1", "--action", "update", "--target", "thing-1")[0], 1)
        self.assertEqual(self.path.read_text(), '{"version":99,"grants":[]}')


if __name__ == "__main__":
    unittest.main()
