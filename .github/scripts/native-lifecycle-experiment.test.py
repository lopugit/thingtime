#!/usr/bin/env python3
"""Safe local review: syntax + mocked cleanup assertions, NEVER hosted execution."""
import ast
import argparse
import hashlib
import importlib.util
import json
import os
import stat
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
HELPER = ROOT / 'native-lifecycle-experiment.py'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workflow', type=Path, default=ROOT.parent / 'workflows/native-lifecycle-experiment.yml')
parser.add_argument('--helper-only', action='store_true')
parser.add_argument('--final', metavar='HELPER_SHA')
options = parser.parse_args()
WORKFLOW = options.workflow
source = HELPER.read_text()
workflow = '' if options.helper_only else WORKFLOW.read_text()
ast.parse(source)
if not options.helper_only:
    assert 'HELPER_CONTENT_SHA256' not in workflow
    assert hashlib.sha256(HELPER.read_bytes()).hexdigest() in workflow
    assert 'pull_request:\n    types: [labeled]' in workflow
    assert 'permissions:\n  contents: read' in workflow
    assert 'persist-credentials: false' in workflow
    assert 'timeout-minutes: 8' in workflow and 'max-parallel: 1' in workflow
    assert 'reviewed_bytes == executed_bytes' in workflow
    assert 'current[\'head\'][\'sha\'] == head' in workflow
    assert 'tt-life-{0}' in workflow
    for expression in ('pull_request_target:', 'workflow_dispatch:', 'secrets:', 'secrets.', 'secrets: inherit',
                       'actions/cache@', 'contents: write', 'pull-requests: write'):
        assert expression not in workflow, expression
    uses = re.findall(r'uses: ([^\n]+)', workflow)
    assert uses == ['actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
                    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02']
    # Syntax-check the exact runner Python snippets without invoking their APIs.
    lines = workflow.splitlines()
    for index, line in enumerate(lines):
        if "<<'PY'" in line:
            block = []
            for following in lines[index + 1:]:
                if following.strip() == 'PY':
                    break
                block.append(following[10:])
            ast.parse('\n'.join(block))
    if options.final:
        sha = options.final
        assert re.fullmatch('[0-9a-f]{40}', sha)
        assert 'REVIEWED_HELPER_SHA' not in workflow
        assert workflow.count(sha) == 2
    else:
        assert workflow.count('REVIEWED_HELPER_SHA') == 2

spec = importlib.util.spec_from_file_location('inert_experiment_review', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)  # Definitions only; __main__ is not executed.


class CleanupReview(unittest.TestCase):
    def scenario(self, uid=5500, alive=False, domain=113, ownership_error=False, command_error=False):
        with tempfile.TemporaryDirectory(prefix='inert-review-only-') as temporary:
            work = Path(temporary)
            report = work / 'report'
            report.mkdir()
            (work / 'cleanup.lock').touch()
            (work / 'platform-fixture-passed').touch()
            resource = {'uid': uid, 'user': '_ttlife_mock', 'home': str(work / 'unused-home'),
                        'domainAttempted': True}
            (work / 'state.json').write_text(json.dumps({'runnerUid': 501, 'case': 'normal',
                'report': str(report), 'resources': [resource]}))
            calls = []
            def fake_command(label, args, allowed=(0,)):
                calls.append(args)
                if command_error:
                    raise RuntimeError('mock-platform-error')
                return types.SimpleNamespace(returncode=0, stdout=b'')
            # Ordinary filesystem reads/writes in a new temporary folder only.
            # No system mutation, process inventory, signals, sleep or privileged command runs.
            with patch.object(module, 'command', side_effect=fake_command), \
                 patch.object(module, 'verify_resource', side_effect=RuntimeError('mock-owner-mismatch') if ownership_error else None), \
                 patch.object(module, 'pids', return_value=[99] if alive else []), \
                 patch.object(module, 'domain_status', return_value=domain), \
                 patch.object(module.time, 'monotonic', side_effect=[0, 0, 0, 61]), \
                 patch.object(module.time, 'sleep'):
                module.cleanup(work)
            return json.loads((report / 'result.json').read_text()), calls

    def test_report_is_runner_readable_under_private_supervisor_umask(self):
        with tempfile.TemporaryDirectory(prefix='inert-report-mode-review-') as temporary:
            report = Path(temporary) / 'report'
            previous = os.umask(0o077)
            try:
                control = Path(temporary) / 'mkdir-control'
                control.mkdir(mode=0o755)
                self.assertEqual(stat.S_IMODE(control.stat().st_mode), 0o700)
                module.prepare_report_directory(report)
                module.write_json(report / 'provenance.json', {'fixed': 'safe'}, 0o644)
            finally:
                os.umask(previous)
            directory_mode = stat.S_IMODE(report.stat().st_mode)
            self.assertEqual(directory_mode, 0o755)
            self.assertEqual(directory_mode & (stat.S_IROTH | stat.S_IXOTH), stat.S_IROTH | stat.S_IXOTH)
            self.assertEqual(stat.S_IMODE((report / 'provenance.json').stat().st_mode), 0o644)
            self.assertEqual(json.loads((report / 'provenance.json').read_text()), {'fixed': 'safe'})

    def test_existing_report_is_not_repermissioned(self):
        with tempfile.TemporaryDirectory(prefix='inert-existing-report-review-') as temporary:
            report = Path(temporary) / 'report'
            report.mkdir(mode=0o700)
            with self.assertRaises(FileExistsError):
                module.prepare_report_directory(report)
            self.assertEqual(stat.S_IMODE(report.stat().st_mode), 0o700)

    def test_allocator_reports_numeric_search_skips_without_raw_records(self):
        diagnostics = {}
        def fake_command(label, args, allowed=(0,)):
            return types.SimpleNamespace(stdout=b'private-record-name' if args[3] == '/Users' else b'', returncode=0)
        with tempfile.TemporaryDirectory(prefix='inert-allocation-review-') as temporary, \
             patch.object(module, 'command', side_effect=fake_command), \
             patch.object(module, 'pids', side_effect=AssertionError('must short-circuit')), \
             patch.object(module, 'domain_status', side_effect=AssertionError('must short-circuit')):
            with self.assertRaisesRegex(RuntimeError, 'bounded-fresh-identity-range-exhausted'):
                module.allocate(Path(temporary), set(), diagnostics)
        self.assertEqual(diagnostics['scanned'], 200)
        self.assertEqual(diagnostics['userNumericSearchMatch'], 200)
        self.assertEqual(diagnostics['groupNumericSearchMatch'], 0)
        self.assertEqual(diagnostics['existingPid'], 0)
        self.assertEqual(diagnostics['existingDomain'], 0)
        self.assertEqual(diagnostics['outcome'], 'range-exhausted')
        self.assertNotIn('private-record-name', json.dumps(diagnostics))

    def test_allocator_distinguishes_group_process_and_domain_skips(self):
        diagnostics = {}
        def fake_command(label, args, allowed=(0,)):
            matched = label == 'fresh-numeric-identity' and args[3] == '/Groups' and args[-1] == '5501'
            return types.SimpleNamespace(stdout=b'private-group-name' if matched else b'', returncode=0)
        with tempfile.TemporaryDirectory(prefix='inert-allocation-review-') as temporary, \
             patch.object(module, 'command', side_effect=fake_command), \
             patch.object(module, 'pids', side_effect=lambda uid: [123] if uid == 5502 else []), \
             patch.object(module, 'domain_status', side_effect=lambda uid: 0 if uid == 5503 else 113):
            result = module.allocate(Path(temporary), {5500}, diagnostics)
        self.assertEqual(result['uid'], 5504)
        self.assertEqual(diagnostics['scanned'], 5)
        self.assertEqual(diagnostics['excludedUsed'], 1)
        self.assertEqual(diagnostics['groupNumericSearchMatch'], 1)
        self.assertEqual(diagnostics['existingPid'], 1)
        self.assertEqual(diagnostics['existingDomain'], 1)
        self.assertEqual(diagnostics['available'], 1)
        self.assertEqual(diagnostics['outcome'], 'identity-allocated')
        self.assertNotIn('private-group-name', json.dumps(diagnostics))

    def test_unknown_domain_status_still_fails_instead_of_becoming_absence(self):
        with patch.object(module.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1, stdout=b'', stderr=b'')):
            with self.assertRaisesRegex(RuntimeError, 'domain-observation-unexpected-status-1'):
                module.domain_status(5500)

    def test_full_head_label_fits_github_name_limit_without_truncation(self):
        head = '0123456789abcdef' * 2 + '01234567'
        label = module.review_label(head)
        self.assertEqual(label, 'tt-life-' + head)
        self.assertEqual(len(label), 48)
        self.assertLessEqual(len(label), 50)
        self.assertNotEqual(label, module.review_label(head[:-1] + '8'))
        with self.assertRaises(ValueError):
            module.review_label(head + '0')

    def test_success_tears_down_only_exact_owned_user_domain_and_uid(self):
        result, calls = self.scenario()
        self.assertTrue(result['platformAcceptance'])
        self.assertEqual(calls, [
            ['/bin/launchctl', 'bootout', 'user/5500'],
            ['/usr/bin/pkill', '-KILL', '-u', '5500'],
            ['/usr/bin/dscl', '.', '-delete', '/Users/_ttlife_mock'],
            ['/usr/bin/dscl', '.', '-delete', '/Groups/_ttlife_mock']])
        self.assertFalse(result['nativeCompileTested'])
        self.assertFalse(result['networkIsolationTested'])
        self.assertFalse(result['realJobCancellationTested'])

    def test_runner_identity_is_never_signalled_or_booted_out(self):
        result, calls = self.scenario(uid=501)
        self.assertFalse(result['platformAcceptance'])
        self.assertEqual(calls, [])

    def test_root_is_never_signalled_or_booted_out(self):
        result, calls = self.scenario(uid=0)
        self.assertFalse(result['platformAcceptance'])
        self.assertEqual(calls, [])

    def test_uncertain_ownership_prevents_all_cleanup_commands(self):
        result, calls = self.scenario(ownership_error=True)
        self.assertFalse(result['platformAcceptance'])
        self.assertEqual(calls, [])

    def test_remaining_process_prevents_account_deletion(self):
        result, calls = self.scenario(alive=True)
        self.assertFalse(result['platformAcceptance'])
        self.assertFalse(any('-delete' in args for args in calls))

    def test_remaining_domain_prevents_account_deletion(self):
        result, calls = self.scenario(domain=0)
        self.assertFalse(result['platformAcceptance'])
        self.assertFalse(any('-delete' in args for args in calls))

    def test_platform_error_never_becomes_absence_or_success(self):
        result, calls = self.scenario(command_error=True)
        self.assertFalse(result['platformAcceptance'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(result['failure'], 'mock-platform-error')

    def test_command_timeout_raises_instead_of_passing(self):
        with patch.object(module.subprocess, 'run', side_effect=subprocess.TimeoutExpired('mock', 10)):
            with self.assertRaises(subprocess.TimeoutExpired):
                module.command('mock', ['/not/executed'])


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CleanupReview)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print(json.dumps({'safeReviewOnly': True, 'tests': result.testsRun,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'draftPinUnresolved': 'REVIEWED_HELPER_SHA' in workflow,
                      'hostedCommandsExecuted': False}))
    raise SystemExit(not result.wasSuccessful())
