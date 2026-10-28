import contextlib
import io
import json
import tempfile
import threading
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
        self.path.parent.mkdir(exist_ok=True)
        self.path.write_text('{"version":99,"grants":[]}', encoding="utf-8")
        self.assertEqual(self.invoke("check", "--origin", "https://thingtime.com", "--account", "owner-1",
                                     "--action", "update", "--target", "thing-1")[0], 1)
        self.assertEqual(self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                                     "--account", "owner-1", "--action", "update", "--target", "thing-1")[0], 1)
        self.assertEqual(self.path.read_text(), '{"version":99,"grants":[]}')
        self.path.write_text(json.dumps({"version": 1, "grants": [{"id": "c298aa85-e240-4c42-b0aa-2fe3c0caf56d",
            "origin": 42, "account": "owner-1", "actions": ["update"], "targets": ["thing-1"], "expiresAt": None}]}))
        self.assertEqual(self.invoke("check", "--origin", "https://thingtime.com", "--account", "owner-1",
                                     "--action", "update", "--target", "thing-1")[0], 1)

    def test_all_owned_requires_fresh_ownership_assertion(self):
        status, _ = self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                                "--account", "owner-1", "--action", "update", "--all-owned")
        self.assertEqual(status, 0)
        command = ("check", "--origin", "https://thingtime.com", "--account", "owner-1",
                   "--action", "update", "--target", "future-thing")
        self.assertEqual(self.invoke(*command)[1], {"allowed": False})
        self.assertEqual(self.invoke(*command, "--owned-verified")[1], {"allowed": True})
        self.assertEqual(self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                                     "--account", "owner-1", "--action", "create", "--all-owned")[0], 1)
        with self.assertRaises(ValueError):
            consent.origin(42)

    def test_concurrent_grant_cannot_restore_revoked_grant(self):
        _, old = self.invoke("grant", "--user-consented", "--origin", "https://thingtime.com",
                             "--account", "owner-1", "--action", "update", "--target", "old-thing")
        original_read = consent.read
        grant_read = threading.Event()
        release_grant = threading.Event()
        revoke_finished = threading.Event()
        failures = []

        def delayed_read(path):
            data = original_read(path)
            if threading.current_thread().name == "grant":
                grant_read.set()
                if not release_grant.wait(3):
                    raise TimeoutError("grant test wait timed out")
            return data

        def run_grant():
            if consent.run(["grant", "--user-consented", "--origin", "https://thingtime.com",
                            "--account", "owner-1", "--action", "update", "--target", "new-thing"], self.path):
                failures.append("grant failed")

        def run_revoke():
            if consent.run(["revoke", "--id", old["id"]], self.path):
                failures.append("revoke failed")
            revoke_finished.set()

        consent.read = delayed_read
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                writer = threading.Thread(target=run_grant, name="grant")
                writer.start()
                self.assertTrue(grant_read.wait(2))
                revoker = threading.Thread(target=run_revoke, name="revoke")
                revoker.start()
                revoke_finished.wait(0.1)
                release_grant.set()
                writer.join(3)
                revoker.join(3)
            self.assertFalse(writer.is_alive() or revoker.is_alive())
            self.assertFalse(failures)
            grants = consent.read(self.path)["grants"]
            self.assertEqual([item["targets"] for item in grants], [["new-thing"]])
        finally:
            release_grant.set()
            consent.read = original_read


if __name__ == "__main__":
    unittest.main()
