#!/usr/bin/env python3
"""Safe local regression tests: no privileged operations, networking or jobs."""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / '.github/scripts/native-persistent-denial-experiment.py'
WORKFLOW = ROOT / '.github/workflows/native-persistent-denial-experiment.yml'
spec = importlib.util.spec_from_file_location('persistent_denial', HELPER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SafeTests(unittest.TestCase):
    def test_label_full_sha_and_platform_limit(self):
        self.assertEqual(m.label('a' * 40), 'tt-pd-' + 'a' * 40)
        self.assertLessEqual(len(m.label('a' * 40)), 50)
        for value in ('a' * 39, 'a' * 41, 'A' * 40, ''):
            with self.assertRaises(ValueError): m.label(value)

    def test_admission_rejects_extra_fields_and_digest_or_head_substitution(self):
        value = {'actor': 'lopugit', 'label': m.label('a' * 40), 'helperSha': 'b' * 40,
                 'reviewedHeadSha': 'a' * 40, 'workflowSha': 'c' * 40, 'workflowSha256': 'd' * 64,
                 'helperSha256': hashlib.sha256(b'fixed').hexdigest(),
                 'workflowBytesEqual': True, 'candidateCheckout': False}
        self.assertEqual(m.validate_admission(value, b'fixed'), value)
        for changes in ({'unexpected': 'never-publish'}, {'candidateCheckout': True},
                        {'reviewedHeadSha': 'e' * 40}, {'helperSha256': 'f' * 64}, {'workflowSha': '0' * 40}):
            with self.assertRaises(RuntimeError): m.validate_admission({**value, **changes}, b'fixed')

    def test_rules_allow_only_transport_and_deny_every_other_protocol(self):
        rules, roles = m.firewall_rules(501, 5500, [65, 0])
        passing = [line for line in rules.splitlines() if line.startswith('pass ')]
        self.assertEqual(len(passing), 4)
        self.assertTrue(all('user 501' in line for line in passing))
        self.assertEqual(roles, {'fixture': 5500, 'root': 0, 'broker0': 65})
        self.assertEqual(rules.splitlines()[-2:], ['block drop out quick inet all label "pd_default4"',
                                                 'block drop out quick inet6 all label "pd_default6"'])
        for args in [(501, 501, [65]), (501, 5500, [501]), (0, 5500, [65])]:
            with self.assertRaises(ValueError): m.firewall_rules(*args)

    def test_counter_parser_never_invents_missing_or_unknown_counts(self):
        self.assertEqual(m.label_packets('pd_x 10 2 180 0 0 2 180\n', ['pd_x']), {'pd_x': 2})
        for value in ('', 'pd_x 10 2\n', 'pd_y 10 2 180 0 0 2 180\n', 'pd_x 1 -1 0 0 0 0 0\n',
                      'pd_x 1 2 0 0 0 0 0\npd_x 1 2 0 0 0 0 0\n'):
            with self.assertRaises(RuntimeError): m.label_packets(value, ['pd_x'])

    def test_https_control_uses_numeric_addresses_and_preserves_hostname_tls(self):
        from unittest.mock import MagicMock
        raw = MagicMock(); stream = MagicMock()
        raw.__enter__.return_value = raw
        stream.__enter__.return_value = stream
        stream.recv.return_value = b'HTTP/1.1 200 OK\r\n'
        context = MagicMock(); context.wrap_socket.return_value = stream
        with patch.object(m.socket, 'getaddrinfo', side_effect=AssertionError('DNS forbidden after policy')), \
             patch.object(m.socket, 'socket', return_value=raw), \
             patch.object(m.ssl, 'create_default_context', return_value=context):
            result = m.https_control([[socket.AF_INET, '192.0.2.1']])
        raw.connect.assert_called_once_with(('192.0.2.1', 443))
        context.wrap_socket.assert_called_once_with(raw, server_hostname='api.github.com')
        self.assertFalse(result['dnsResolutionDuringControl'])
        self.assertTrue(result['tlsVerified'])

    def test_sanitized_failure_codes_preserve_specific_cause(self):
        self.assertEqual(m.failure_code(RuntimeError('required-policy-labels-not-loaded')), 'required-policy-labels-not-loaded')
        self.assertEqual(m.failure_code(RuntimeError('private value /path')), 'unexpected-runtimeerror')
        self.assertEqual(m.failure_code(subprocess.TimeoutExpired(['do-not-copy-arguments'], 3)), 'command-timeout')
        self.assertEqual(m.failure_code(PermissionError(13, 'do-not-copy-message')), 'os-error-13')

    def test_child_failure_code_is_bounded_and_retained(self):
        from unittest.mock import Mock
        process = Mock(returncode=1)
        process.communicate.return_value = (b'{"failureCode":"normal-sudo-refusal-not-observed"}', None)
        with self.assertRaisesRegex(RuntimeError, '^fixed-probe-normal-sudo-refusal-not-observed$'):
            m.receive(process)
        process.communicate.return_value = (b'{"failureCode":"bad /path"}', None)
        with self.assertRaisesRegex(RuntimeError, '^fixed-probe-failed-without-diagnostic$'):
            m.receive(process)

    def test_positive_ipv6_route_failure_is_not_denial(self):
        class Socket:
            def settimeout(self, _): pass
            def connect(self, _): raise OSError('no route')
            def close(self): pass
        with patch.object(m.socket, 'socket', return_value=Socket()):
            for expectation in ('positive', 'denied'):
                with self.assertRaisesRegex(RuntimeError, 'network-error-is-not-denial'):
                    m.network_probe('tcp6', expectation)

    def test_timeouts_only_count_for_negative_probe(self):
        class Socket:
            def settimeout(self, _): pass
            def connect(self, _): raise socket.timeout()
            def close(self): pass
        with patch.object(m.socket, 'socket', return_value=Socket()):
            self.assertTrue(m.network_probe('tcp4', 'denied')['observed'])
            with self.assertRaisesRegex(RuntimeError, 'positive-control-timeout'):
                m.network_probe('tcp4', 'positive')

    def test_timeout_without_counter_delta_never_passes(self):
        state = {'labels': ['pd_fixture_tcp4']}
        with patch.object(m, 'snapshot', return_value={'pd_fixture_tcp4': 0}), \
             patch.object(m, 'launch'), patch.object(m, 'receive', return_value={'part': 'tcp4', 'expected': 'denied', 'observed': True}):
            with self.assertRaisesRegex(RuntimeError, 'without-labeled-policy-attribution'):
                m.attributed_denials(Path('/unused'), state, 'fixture', 5500)

    def test_loaded_policy_change_fails_before_counter_claim(self):
        def cmd(phase, argv):
            return subprocess.CompletedProcess(argv, 0, b'Status: Enabled' if phase == 'pf-enabled' else b'altered')
        with patch.object(m, 'command', side_effect=cmd):
            with self.assertRaisesRegex(RuntimeError, 'loaded-policy-changed'):
                m.snapshot(Path('/unused'), {'loadedRulesSha256': hashlib.sha256(b'original').hexdigest()})

    def test_runner_identity_conflict_and_missing_broker_fail(self):
        valid = '1 0 501 /a/Runner.Listener\n2 1 501 /a/Runner.Worker\n3 0 65 /a/mDNSResponder'
        self.assertEqual(m.runner_identities(valid, 501), [65])
        for text in (valid.replace('65', '501'), valid.replace('2 1 501', '2 1 502'), valid.split('\n3')[0]):
            with self.assertRaises(RuntimeError): m.runner_identities(text, 501)

    def test_report_mode_survives_private_umask_and_replacement(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            old = os.umask(0o077)
            try:
                m.write_json(path, {'one': True}); m.write_json(path, {'two': True})
            finally: os.umask(old)
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
            self.assertEqual(json.loads(path.read_text()), {'two': True})

    def test_terminal_receipt_does_not_claim_platform_or_disposal_acceptance(self):
        for activation in ({}, {'policyActivationAttempted': True}, {'policyActivated': True}):
            result = m.terminal_result({'admission': {}, **activation}, 'test-failure')
            for key in ('candidateExecuted', 'nativeCompileAdmitted', 'platformAcceptance', 'policyRestored',
                        'pfEnableReferenceReleased', 'providerDestructionObserved'):
                self.assertIs(result[key], False)
            self.assertTrue(result['providerDisposalRequired'])
            self.assertIn('stock-service-delegation-enforcement', result['unproven'])
        self.assertIsNone(m.terminal_result({'admission': {}, 'policyActivationAttempted': True})['policyChanged'])

    def test_no_policy_restoration_domain_teardown_or_candidate_entry(self):
        source = HELPER.read_text()
        ast.parse(source)
        for forbidden in ('/etc/pf.conf', "'-X'", "'-d'", 'bootout', 'bootstrap_subset', 'security find-', 'tarfile', 'shutil.rmtree'):
            self.assertNotIn(forbidden, source)
        with self.assertRaises(ValueError): m.main(['native'])

    def test_unusable_ipv6_prevents_every_policy_mutation(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            admission = {'actor': 'lopugit', 'reviewedHeadSha': 'a' * 40,
                         'helperSha': 'b' * 40, 'workflowSha': 'c' * 40, 'workflowSha256': 'd' * 64,
                         'label': m.label('a' * 40), 'workflowBytesEqual': True,
                         'candidateCheckout': False, 'helperSha256': hashlib.sha256(HELPER.read_bytes()).hexdigest()}
            (base / 'admission.json').write_text(json.dumps(admission))
            calls = []
            def command(phase, argv, **kwargs):
                calls.append(argv)
                output = b'1 0 501 /a/Runner.Listener\n2 1 501 /a/Runner.Worker\n3 0 65 /a/mDNSResponder' if phase == 'runner-inventory' else b'20'
                return subprocess.CompletedProcess(argv, 0, output, b'')
            def receive(process):
                mode, arguments = process
                if mode == 'network' and arguments[0] == 'tcp6':
                    raise RuntimeError('no-ipv6-positive-control')
                return {'part': arguments[0], 'expected': 'positive', 'observed': True} if mode == 'network' else {}
            private_work = base / 'private-work'; private_work.mkdir()
            old_umask = os.umask(0o077)
            try:
                with patch.object(m, 'require_hosted', return_value=501), \
                     patch.dict(m.os.environ, {'RUNNER_TEMP': str(base)}), \
                     patch.object(m.tempfile, 'mkdtemp', return_value=str(private_work)), \
                     patch.object(m, 'start_watchdog', return_value=99), \
                     patch.object(m.signal, 'alarm'), patch.object(m, 'command', side_effect=command), \
                     patch.object(m, 'allocate_numeric_identity', return_value=5500), \
                     patch.object(m, 'ipc_probe', return_value=[]), \
                     patch.object(m, 'launch', side_effect=lambda work, uid, gid, mode, *args: (mode, args)), \
                     patch.object(m, 'receive', side_effect=receive):
                    with self.assertRaisesRegex(RuntimeError, 'inert-observation-failed'):
                        m.supervise(base / 'report', base / 'admission.json')
            finally:
                os.umask(old_umask)
            self.assertFalse(any('/sbin/pfctl' in argv for argv in calls))
            result = json.loads((base / 'report/result.json').read_text())
            self.assertEqual(result['failureStage'], 'positive-tcp6')
            self.assertEqual(result['failureCode'], 'no-ipv6-positive-control')
            self.assertIs(result['policyChanged'], False)
            self.assertIs(result['candidateAdmission'], False)
            self.assertEqual((base / 'report').stat().st_mode & 0o777, 0o755)

    def test_unarmed_parent_loss_never_attempts_policy_or_claims_success(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory); (work / 'control').mkdir(); (work / 'report').mkdir()
            state = {'parentPid': 12345, 'deadline': 100, 'admission': {}, 'report': str(work / 'report')}
            (work / 'control/state.json').write_text(json.dumps(state))
            with patch.object(m.signal, 'alarm'), patch.object(m.os, 'write'), patch.object(m.os, 'close'), \
                 patch.object(m.os, 'kill', side_effect=ProcessLookupError), \
                 patch.object(m.time, 'monotonic', return_value=0), patch.object(m, 'command') as command:
                m.watchdog(work, 99)
            command.assert_not_called()
            result = json.loads((work / 'report/result.json').read_text())
            self.assertEqual(result['result'], 'inert-observation-failed')
            self.assertIs(result['candidateAdmission'], False)
            self.assertEqual(result['failureStage'], 'parent-loss')
            self.assertEqual(result['failureCode'], 'supervisor-lost-before-parent-loss-checkpoint')

    def test_authority_success_or_timeout_is_not_a_denial(self):
        with patch.object(m.os, 'geteuid', return_value=5500), \
             patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(m.os, 'open') as opened:
            with self.assertRaisesRegex(RuntimeError, 'normal-sudo-refusal-not-observed'):
                m.authority_probe(Path('/synthetic'), Path('/synthetic'), 501, 5500)
            opened.assert_not_called()
        with patch.object(m.os, 'geteuid', return_value=5500), \
             patch.object(m.subprocess, 'run', side_effect=subprocess.TimeoutExpired([], 3)):
            with self.assertRaises(subprocess.TimeoutExpired):
                m.authority_probe(Path('/synthetic'), Path('/synthetic'), 501, 5500)

    def test_workflow_exact_head_and_allowlisted_publication_contract(self):
        text = WORKFLOW.read_text()
        self.assertEqual(text.count('runs-on:'), 1)
        self.assertIn('runs-on: macos-15', text)
        self.assertNotIn('matrix:', text)
        self.assertNotIn('secrets:', text)
        self.assertNotIn('actions/cache', text)
        self.assertIn("assert reviewed_bytes == executed_bytes", text)
        self.assertIn("current['head']['sha'] == head", text)
        self.assertIn('persist-credentials: false', text)
        self.assertIn('contents: read\n  pull-requests: read', text)
        paths = text.split('name: inert-persistent-denial\n', 1)[1].split('if-no-files-found:', 1)[0]
        self.assertEqual(re.findall(r'\$\{\{ runner.temp \}\}/([^\n]+)', paths),
                         ['inert-pd-report/provenance.json', 'inert-pd-report/result.json'])
        self.assertIn('if-no-files-found: error', text)
        self.assertIn('steps.evidence.outputs.artifact-id', text)


def verify_pins(helper_commit, draft):
    text = WORKFLOW.read_text()
    pins = re.findall(r"(?:EXPERIMENT_HELPER_SHA:|ref:) '([0-9a-f]{40})'", text)
    digest = re.search(r"assert digest == '([0-9a-f]{64})'", text).group(1)
    if draft:
        if pins != ['0' * 40] * 2 or digest != '0' * 64:
            raise AssertionError('draft placeholders differ; use final verification once pinned')
    else:
        if not helper_commit or helper_commit == '0' * 40 or pins != [helper_commit] * 2:
            raise AssertionError('two literal immutable E1 pins required')
        data = subprocess.run(['git', '-C', str(ROOT), 'show', helper_commit + ':.github/scripts/native-persistent-denial-experiment.py'],
                              check=True, capture_output=True).stdout
        if data != HELPER.read_bytes() or hashlib.sha256(data).hexdigest() != digest:
            raise AssertionError('reviewed E1 helper bytes/digest mismatch')
    return {'draft': draft, 'helperPins': pins, 'helperSha256': hashlib.sha256(HELPER.read_bytes()).hexdigest(),
            'workflowSha256': hashlib.sha256(WORKFLOW.read_bytes()).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--draft', action='store_true')
    choice.add_argument('--final', metavar='E1')
    args = parser.parse_args()
    print(json.dumps(verify_pins(args.final, args.draft)))
    unittest.main(argv=[sys.argv[0]])
