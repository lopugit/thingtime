#!/usr/bin/env python3
"""Safe local review: syntax + mocked cleanup assertions, NEVER hosted execution."""
import ast
import argparse
import hashlib
import importlib.util
import json
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
    assert 'native-lifecycle-{0}' in workflow
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
