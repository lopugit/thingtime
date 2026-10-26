import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import subprocess
import tarfile
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('build_media', Path(__file__).with_name('build_media.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


def command(kind, text):
    data = text.encode() + b'\0'
    size = (24 + len(data) + 7) // 8 * 8
    return struct.pack('<6I', kind, size, 24, 0, 0, 0) + data + bytes(size - 24 - len(data))


def binary(dependency='/usr/lib/libSystem.B.dylib', extra=b''):
    commands = command(0xc, dependency) + struct.pack('<6I', 0x32, 24, 1, 0x000f0000, 0x001a0500, 0) + extra
    count = 2 + bool(extra)
    return struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 2, count, len(commands), 0, 0) + commands


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix='offline-vm-media-')
        self.root = Path(self.fixture.name).resolve()
        self.root.chmod(0o700)
        self.archive = self.root / 'Xcode.tar.gz'
        self.make_archive()
        self.xcodegen = self.root / 'xcodegen'
        self.xcodegen.write_bytes(binary())
        self.xcodegen.chmod(0o700)
        self.labels = dict(zip(('xcode', 'xcodeBuild', 'macOSSDK', 'simulatorSDK', 'xcodegen'),
                               ('26.6', '17F113', '26.5', '26.5', '2.45.4')))
        self.task = str(uuid.uuid4())

    def tearDown(self):
        self.fixture.cleanup()

    def make_archive(self, extras=()):
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name in ('Xcode.app/Contents/Info.plist', 'Xcode.app/Contents/_CodeSignature/CodeResources'):
                item = tarfile.TarInfo(name)
                item.size = 4
                item.mode = 0o644
                archive.addfile(item, io.BytesIO(b'fake'))
            for item in extras:
                archive.addfile(item, io.BytesIO(b'x' * item.size))
        self.archive.chmod(0o600)

    def git(self, *args):
        return subprocess.check_output(['/usr/bin/git', '-c', 'user.email=fixture@example.invalid',
            '-c', 'user.name=fixture', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
            '-C', str(self.repo), *args], env={'PATH': '/usr/bin:/bin', 'HOME': str(self.root),
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}, stderr=subprocess.DEVNULL)

    def repository(self):
        self.repo = self.root / 'repository'
        self.repo.mkdir(mode=0o700)
        self.git('init')
        for rel in ('apple/Passwords/Package.swift', 'apple/FileSync/Package.swift',
                    'iOS/project.yml', 'macos/ThingtimePasswords/project.yml',
                    'apple/Shared/ThingtimeBridgeScript.swift', 'apple/Widgets/ThingtimeWidgets.swift',
                    'iOS/.env.example'):
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('inert fixture, never execute\n')
        (self.repo / '.env').write_text('EXCLUDED=synthetic\n')
        self.git('add', '.')
        self.git('commit', '-m', 'inert fixture')
        return self.git('rev-parse', 'HEAD').decode().strip()

    def testVendorRelativeLinksStayInsideBundle(self):
        link = tarfile.TarInfo('Xcode.app/Contents/Frameworks/One.framework/One')
        link.type = tarfile.SYMTYPE
        link.linkname = 'Versions/Current/One'
        parent = tarfile.TarInfo('Xcode.app/Contents/Developer/link')
        parent.type = tarfile.SYMTYPE
        parent.linkname = '../Frameworks'
        self.make_archive([link, parent])
        self.assertEqual(media.audit_xcode(self.archive)['symlinks'], 2)

    def testArchiveLinksCannotEscapeOrUseAbsolutePaths(self):
        for target in ('/etc/passwd', '../../../outside', '../../outside', ''):
            with self.subTest(target=target):
                link = tarfile.TarInfo('Xcode.app/Contents/link')
                link.type = tarfile.SYMTYPE
                link.linkname = target
                self.make_archive([link])
                with self.assertRaises(media.MediaError):
                    media.audit_xcode(self.archive)

    def testChainedLinkEscapeCyclesAndWritesBeneathLinkAreRejected(self):
        sub = tarfile.TarInfo('Xcode.app/dir/sub')
        sub.type, sub.linkname = tarfile.SYMTYPE, '..'
        link = tarfile.TarInfo('Xcode.app/link')
        link.type, link.linkname = tarfile.SYMTYPE, 'dir/sub/../..'
        self.make_archive([link, sub])  # Forward references must not change resolution.
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)
        one = tarfile.TarInfo('Xcode.app/one')
        one.type, one.linkname = tarfile.SYMTYPE, 'two'
        two = tarfile.TarInfo('Xcode.app/two')
        two.type, two.linkname = tarfile.SYMTYPE, 'one'
        self.make_archive([one, two])
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)
        alias = tarfile.TarInfo('Xcode.app/alias')
        alias.type, alias.linkname = tarfile.SYMTYPE, 'Contents'
        self.make_archive([tarfile.TarInfo('Xcode.app/alias/extra'), alias])
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)

    def testRejectHardlinksDevicesFifoAndPrivilegedModes(self):
        for kind in (tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                item = tarfile.TarInfo('Xcode.app/Contents/alias')
                item.type = kind
                item.linkname = 'Xcode.app/Contents/Info.plist'
                self.make_archive([item])
                with self.assertRaises(media.MediaError):
                    media.audit_xcode(self.archive)
        item = tarfile.TarInfo('Xcode.app/Contents/privileged')
        item.mode = 0o4755
        self.make_archive([item])
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)

    def testReceiptPrivateMetadataAndTraversalRejected(self):
        for name in ('Xcode.app/Contents/_MASReceipt/receipt', 'Xcode.app/Contents/.DS_Store',
                     'Xcode.app/Contents/._one', 'Xcode.app/Contents/Keychains/data',
                     'Xcode.app/Contents/one.p12', '../escape', '/Xcode.app/file',
                     'Xcode.app/Contents/./alias', 'Xcode.app/Contents//alias'):
            with self.subTest(name=name):
                self.make_archive([tarfile.TarInfo(name)])
                with self.assertRaises(media.MediaError):
                    media.audit_xcode(self.archive)

    def testCanonicalFileLinkDirectoryAliasesCannotOverwriteGraph(self):
        for first_type, second_type in ((tarfile.REGTYPE, tarfile.DIRTYPE),
                                        (tarfile.SYMTYPE, tarfile.DIRTYPE),
                                        (tarfile.DIRTYPE, tarfile.REGTYPE),
                                        (tarfile.REGTYPE, tarfile.SYMTYPE)):
            with self.subTest(first=first_type, second=second_type):
                first = tarfile.TarInfo('Xcode.app/alias')
                first.type, first.linkname = first_type, 'Contents'
                second = tarfile.TarInfo('Xcode.app/alias/')
                second.type, second.linkname = second_type, 'Contents'
                self.make_archive([first, second])
                with self.assertRaisesRegex(media.MediaError, 'archive-path'):
                    media.audit_xcode(self.archive)

    def testDuplicateAndPaxXattrsRejected(self):
        item = tarfile.TarInfo('Xcode.app/Contents/Info.plist')
        self.make_archive([item])
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)
        item.name = 'Xcode.app/Contents/other'
        item.pax_headers = {'SCHILY.xattr.private': 'synthetic'}
        self.make_archive([item])
        with self.assertRaises(media.MediaError):
            media.audit_xcode(self.archive)

    def testRelocatableArm64BinaryUsesOnlySystemLibraries(self):
        audit = media.audit_xcodegen(binary())
        self.assertEqual(audit['minimumMacOS'], '15.0.0')
        self.assertFalse(audit['guestExecutionVerified'])
        for dependency in ('/opt/homebrew/opt/library/lib/private.dylib', '@rpath/libswiftCore.dylib',
                           '@executable_path/plugin.dylib', '/usr/lib/../private/dylib'):
            with self.subTest(dependency=dependency), self.assertRaises(media.MediaError):
                media.audit_xcodegen(binary(dependency))

    def testEveryDylibLoadKindRejectsNonSystemDependency(self):
        for kind in (0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023, 0xe):
            with self.subTest(kind=kind), self.assertRaises(media.MediaError):
                media.audit_xcodegen(binary(extra=command(kind, '@rpath/private.dylib')))
        for kind in (0x6, 0x9, 0x10):
            with self.subTest(kind=kind), self.assertRaises(media.MediaError):
                media.audit_xcodegen(binary(extra=struct.pack('<II', kind, 8)))

    def testUnusedVendorRunpathsDoNotCreateGuestLibraryDependencies(self):
        audit = media.audit_xcodegen(binary(extra=command(0x8000001c, '@loader_path')))
        self.assertEqual(audit['unusedRunpathCount'], 1)
        self.assertTrue(audit['allDirectDependenciesUseSystemPaths'])

    def testEnvironmentRpathMalformedAndWrongArchitectureRejected(self):
        for data in (binary(extra=command(0x27, 'DYLD_INSERT_LIBRARIES=x')),
                     binary('@rpath/private.dylib', extra=command(0x8000001c, '/opt/homebrew/lib')),
                     binary()[:-1], b'#!/bin/sh\nexit 0',
                     binary()[:4] + struct.pack('<I', 0x01000007) + binary()[8:]):
            with self.subTest(data=data[:12]), self.assertRaises(media.MediaError):
                media.audit_xcodegen(data)

    def testCopyDigestAliasAndFifoFailWithoutExecution(self):
        with self.assertRaises(media.MediaError):
            media.copy_bound(self.xcodegen, self.root / 'bad-copy', '0' * 64)
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(media.MediaError):
            media.copy_bound(fifo, self.root / 'fifo-copy', '0' * 64)
        alias = self.root / 'alias'
        alias.symlink_to(self.xcodegen)
        with self.assertRaises(media.MediaError):
            media.copy_bound(alias, self.root / 'alias-copy', '0' * 64)
        os.link(self.xcodegen, self.root / 'hardlink')
        with self.assertRaises(media.MediaError):
            media.copy_bound(self.xcodegen, self.root / 'hard-copy', '0' * 64)

    def testExactCommitExportExcludesCheckoutSecrets(self):
        commit = self.repository()
        destination = self.root / 'export'
        destination.mkdir(mode=0o700)
        result = media.export_source(self.repo, commit, destination)
        self.assertEqual(result['sourceCommit'], commit)
        self.assertEqual(len(result['files']), 7)
        (self.repo / 'iOS/project.yml').write_text('MUTABLE CHECKOUT IGNORED')
        with tarfile.open(destination / 'source.tar') as archive:
            self.assertEqual(len(archive.getmembers()), 7)
            self.assertEqual(archive.extractfile('source/iOS/project.yml').read(), b'inert fixture, never execute\n')
            self.assertTrue(all(m.isfile() and not m.pax_headers for m in archive.getmembers()))

    def testTrackedNativeSymlinkRefused(self):
        self.repository()
        (self.repo / 'iOS/escape').symlink_to('/etc/passwd')
        self.git('add', 'iOS/escape')
        self.git('commit', '-m', 'inert alias')
        destination = self.root / 'export'
        destination.mkdir(mode=0o700)
        with self.assertRaises(media.MediaError):
            media.export_source(self.repo, self.git('rev-parse', 'HEAD').decode().strip(), destination)

    def testStageProducesBoundMediaAndNoReadinessOrPrivatePaths(self):
        commit = self.repository()
        commands = []
        def runner(args, cwd, **kwargs):
            commands.append(args)
            if args[0] == '/usr/bin/hdiutil':
                self.assertEqual(args[1:5], ['makehybrid', '-udf', '-udf-volume-name', 'TTNativeBuild'])
                self.assertNotIn('-ov', args)
                Path(args[args.index('-o') + 1]).write_bytes(bytes(512))
                return b''
            return media.run_fixed(args, cwd, **kwargs)
        result = media.stage(self.root, self.task, self.repo, commit, self.archive,
            hashlib.sha256(self.archive.read_bytes()).hexdigest(), self.xcodegen,
            hashlib.sha256(self.xcodegen.read_bytes()).hexdigest(), self.labels, runner)
        build = self.root / self.task / result['buildID']
        self.assertTrue((build / 'build-input.iso').is_file())
        self.assertFalse(result['guestStarted'])
        self.assertFalse(result['candidateAdmission'])
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(result['sourceMembers'], 7)
        manifest = json.loads((build / 'payload/build-manifest.json').read_text())
        for record in manifest['files'].values():
            self.assertEqual(hashlib.sha256((build / 'payload' / record['file']).read_bytes()).hexdigest(), record['sha256'])
        self.assertEqual(len([a for a in commands if a[0] == '/usr/bin/hdiutil']), 1)

    def testTrustedToolTimeoutIsReapedAndDoesNotLeaveLog(self):
        with self.assertRaisesRegex(media.MediaError, 'tool-deadline'):
            media.run_fixed(['/usr/bin/python3', '-c', 'import time;time.sleep(30)'],
                            self.root, seconds=0.05)
        self.assertEqual(list(self.root.glob('.tool-*')), [])

    def testRecipeSyntaxAndNoCredentialOrLicenseAutoAcceptance(self):
        recipe = Path(__file__).with_name('guest-build.sh')
        subprocess.run(['/bin/bash', '-n', str(recipe)], check=True)
        text = recipe.read_text()
        self.assertNotIn('__clean', text)
        wrapper, body = text.split("<<'OFFLINE_GUEST_RECIPE'\n", 1)
        self.assertNotIn('if ', wrapper)
        self.assertIn('exec /usr/bin/env -i ', wrapper)
        self.assertIn('/bin/bash --noprofile --norc -s -- "$@"', wrapper)
        self.assertTrue(body.startswith('set -euo pipefail\numask 077\n[ "$#" -eq 2 ] || exit 64\n'))
        self.assertIn('-license check', text)
        self.assertIn('build-for-testing', text)
        self.assertNotIn('-license accept', text)
        self.assertNotIn('sudo ', text)
        self.assertNotIn('-allowProvisioningUpdates', text)


if __name__ == '__main__':
    unittest.main()
