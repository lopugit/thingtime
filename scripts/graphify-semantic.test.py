"""Offline regression for Graphify semantic dispatch and per-slice coverage."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch

from graphify import llm

adapter = runpy.run_path(str(Path(__file__).with_name("graphify-semantic.py")))


class SemanticRefresh(unittest.TestCase):
    def test_incremental_scope_keeps_live_corpus_and_other_tiers(self):
        root = Path("/fixture")
        target, historical, other = [
            str(root / file) for file in ("changed.md", "unstamped.md", "other.md")
        ]
        result = {
            "files": {"document": [target, historical, other], "code": ["live.py"]},
            "new_files": {"document": [target, historical], "code": ["live.py"]},
            "unchanged_files": {"document": [other]},
            "deleted_files": ["removed.py"],
        }
        actual = adapter["scoped_detection"](result, root, {Path(target)})
        self.assertEqual(actual["files"]["document"], [target, historical, other])
        self.assertEqual(actual["new_files"], {"document": [target], "code": ["live.py"]})
        self.assertEqual(actual["unchanged_files"]["document"], [])
        self.assertEqual(actual["deleted_files"], ["removed.py"])

    def test_document_coverage_cannot_hide_a_missing_later_slice(self):
        with TemporaryDirectory() as scratch:
            root = Path(scratch).resolve()
            source = root / "manual.md"
            source.write_text("# Start\n\n" + "first procedure\n" * 1500 + "\n## Tail recovery\n", encoding="utf-8")
            offered = []

            def simulated_completion(units, **options):
                self.assertEqual(len(units), 1)
                unit = units[0]
                content = llm.read_slice_text(unit)
                offered.append(content)
                return {"nodes": [] if "Tail recovery" in content else [
                    {"id": "start", "label": "Start", "source_file": source.name},
                ], "edges": [], "hyperedges": [], "input_tokens": 0, "output_tokens": 0}

            with (
                patch.dict(os.environ, {"GRAPHIFY_NO_INCREMENTAL_CACHE": "1"}),
                patch.object(llm, "_extract_with_adaptive_retry", simulated_completion),
            ):
                upstream = llm.extract_corpus_parallel(
                    [source], root=root, token_budget=None, chunk_size=1, max_concurrency=1,
                )
                self.assertEqual(upstream["uncovered_files"], [])
                offered.clear()
                with self.assertRaisesRegex(ValueError, r"manual\.md \(slice \d+/\d+\)"):
                    adapter["strict_extract"](
                        llm.extract_corpus_parallel, [source], root=root, max_concurrency=1,
                    )
                self.assertEqual("".join(offered), source.read_text(encoding="utf-8"))

                def complete(units, **options):
                    result = simulated_completion(units, **options)
                    if not result["nodes"]:
                        result["nodes"] = [
                            {"id": "tail", "label": "Tail recovery", "source_file": source.name},
                        ]
                    return result

                with patch.object(llm, "_extract_with_adaptive_retry", complete):
                    result = adapter["strict_extract"](
                        llm.extract_corpus_parallel, [source], root=root, max_concurrency=1,
                    )
                    self.assertIn("tail", [node["id"] for node in result["nodes"]])


    def test_wrapper_preserves_scope_and_manifest_through_real_cli_dispatch(self):
        wrapper = Path(__file__).with_name("graphify").resolve()
        seen = []
        class FixtureProvider(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                prompt = req["messages"][-1]["content"]
                paths = re.findall(r'<untrusted_source path="([^"]+)"', prompt)
                self.server.seen.append((paths, req["messages"][0]["content"]))
                nodes = [{
                    "id": f"verified_{name.replace('.', '_')}", "label": f"Verified {name}",
                    "file_type": "document", "source_file": name,
                } for name in paths]
                body = json.dumps({
                    "id": "fixture", "object": "chat.completion", "created": 1, "model": "fixture",
                    "choices": [{"index": 0, "finish_reason": "stop", "message": {
                        "role": "assistant", "content": json.dumps({"nodes": nodes, "edges": [], "hyperedges": []}),
                    }}],
                    "usage": {"prompt_tokens": 30, "completion_tokens": 20, "total_tokens": 50},
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        with TemporaryDirectory() as scratch, ThreadingHTTPServer(("127.0.0.1", 0), FixtureProvider) as server:
            server.seen = seen
            runner = Thread(target=server.serve_forever, daemon=True)
            runner.start()
            root = Path(scratch)
            try:
                env = dict(os.environ, GRAPHIFY_PYTHON=sys.executable, OPENAI_API_KEY="synthetic-fixture",
                           OPENAI_BASE_URL=f"http://127.0.0.1:{server.server_port}/v1",
                           GRAPHIFY_OPENAI_MODEL="fixture", GRAPHIFY_MAX_RETRIES="0")
                env.pop("PYTHONHASHSEED", None)
                def run(*args):
                    outcome = subprocess.run(args, cwd=root, env=env, capture_output=True, text=True, timeout=40)
                    self.assertEqual(outcome.returncode, 0, outcome.stdout + outcome.stderr)
                    return outcome.stdout
                run("git", "init", "-q")
                for file in ["scope.md", "historical.md"]:
                    (root / file).write_text(f"# {file}\n\nSynthetic content specific to {file}.\n")
                run(str(wrapper), "update", ".")
                scoped = run(str(wrapper), "extract", ".", "--backend", "openai", "--semantic-file", "scope.md")
                self.assertIn("verified semantic hash for scope.md", scoped)
                self.assertEqual([entry[0] for entry in seen], [["scope.md"]])
                self.assertIn("Analyze the entire supplied excerpt", seen[0][1])
                complete = run(str(wrapper), "extract", ".", "--backend", "openai")
                self.assertIn("verified semantic hash for historical.md", complete)
                self.assertEqual([entry[0] for entry in seen], [["scope.md"], ["historical.md"]])
                manifest = json.loads((root / "graphify-out" / "manifest.json").read_text())
                self.assertTrue(all(manifest[file]["semantic_hash"] for file in ["scope.md", "historical.md"]))
                cas = root / "graphify-out" / "cache" / "semantic-cas" / "v1"
                self.assertEqual(len(list(cas.glob("p*/*/*.json"))), 2)
            finally:
                server.shutdown()
                runner.join()


if __name__ == "__main__":
    unittest.main()
