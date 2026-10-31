import hashlib
import importlib.util
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location("package_viewer", Path(__file__).with_name("package_viewer.py"))
pkg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pkg)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="offline-vm-package-")
        self.root = Path(self.fixture.name).resolve()
        os.chmod(self.root, 0o700)
        self.binary = self.root / "reviewed-binary"
        self.binary.write_bytes(bytes.fromhex("cffaedfe") + b"inert fixture, never execute")
        self.binary.chmod(0o700)
        self.digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.task = str(uuid.uuid4())

    def tearDown(self):
        self.fixture.cleanup()

    def stage(self, task=None):
        return pkg.stage_at(self.root, self.binary, self.digest, task or self.task)

    def testBundleLayoutIdentityAndBytesWithoutExecuting(self):
        receipt = self.stage()
        app = Path(receipt["bundle"])
        self.assertEqual(pkg.validate_at(self.root, app, self.digest, self.task), receipt)
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        self.assertEqual(info["CFBundlePackageType"], "APPL")
        self.assertNotIn("ProgramArguments", info)
        self.assertNotIn("LSEnvironment", info)
        self.assertEqual((app / "Contents/MacOS/offline-native-vm").read_bytes(), self.binary.read_bytes())
        self.assertFalse(receipt["launchPerformed"])
        self.assertFalse(receipt["signatureVerified"])
        self.assertFalse(receipt["candidateAdmission"])

    def testRepeatedStagesKeepIdentityButNeverOverwritePrevious(self):
        first, second = self.stage(), self.stage()
        self.assertNotEqual(first["bundle"], second["bundle"])
        self.assertEqual(first["bundleIdentifier"], second["bundleIdentifier"])
        self.assertNotEqual(first["bundleIdentifier"], self.stage(str(uuid.uuid4()))["bundleIdentifier"])
        self.assertTrue(Path(first["bundle"]).is_dir())

    def testWrongDigestAndScriptRefusedBeforeAnyAppCreated(self):
        with self.assertRaises(pkg.PackageError):
            pkg.stage_at(self.root, self.binary, "0" * 64, self.task)
        self.binary.write_bytes(b"#!/bin/sh\nexit 99\n")
        digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        with self.assertRaises(pkg.PackageError):
            pkg.stage_at(self.root, self.binary, digest, self.task)
        self.assertFalse((self.root / self.task).exists())

    def testSourceAliasesAndSharedRootRejected(self):
        alias = self.root / "alias"
        alias.symlink_to(self.binary)
        with self.assertRaises(OSError):
            pkg.stage_at(self.root, alias, self.digest, self.task)
        alias.unlink(); os.link(self.binary, alias)
        with self.assertRaises(pkg.PackageError):
            self.stage()
        alias.unlink(); self.root.chmod(0o755)
        with self.assertRaises(pkg.PackageError):
            self.stage()
        self.root.chmod(0o700)

    def testForeignBundleUnexpectedFilesAndPlistArgumentsRejected(self):
        receipt = self.stage(); app = Path(receipt["bundle"])
        with self.assertRaises(pkg.PackageError):
            pkg.validate_at(self.root, app, self.digest, str(uuid.uuid4()))
        injected = app / "Contents/host.env"; injected.write_text("inert")
        with self.assertRaises(pkg.PackageError):
            pkg.validate_at(self.root, app, self.digest, self.task)
        injected.unlink()
        info = pkg.info_plist(self.task); info["LSEnvironment"] = {"BAD": "inert"}
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        with self.assertRaises(pkg.PackageError):
            pkg.validate_at(self.root, app, self.digest, self.task)

    def testSignedLayoutAllowsOnlyInertCodeResources(self):
        receipt = self.stage(); app = Path(receipt["bundle"])
        signature = app / "Contents/_CodeSignature"; signature.mkdir(mode=0o755)
        (signature / "CodeResources").write_bytes(b"inert signature fixture")
        (signature / "CodeResources").chmod(0o644)
        self.assertEqual(pkg.validate_at(self.root, app, self.digest, self.task)["signatureVerified"], False)
        (signature / "unexpected").write_bytes(b"inert")
        with self.assertRaises(pkg.PackageError):
            pkg.validate_at(self.root, app, self.digest, self.task)

    def testFifoRejectedWithoutBlocking(self):
        fifo = self.root / "fifo"; os.mkfifo(fifo, 0o600)
        with self.assertRaises(pkg.PackageError):
            pkg.stage_at(self.root, fifo, self.digest, self.task)

    def testSymlinkedTaskAndBundleDirectoriesRefused(self):
        other = self.root / "other"; other.mkdir(mode=0o700)
        (self.root / self.task).symlink_to(other, target_is_directory=True)
        with self.assertRaises(pkg.PackageError):
            self.stage()
        self.assertEqual(list(other.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
