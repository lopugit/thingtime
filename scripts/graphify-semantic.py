"""Run Graphify's incremental extractor with independently checked semantic units.

The adapter only narrows dispatch; upstream detection, cache I/O, graph merge,
shrink protection, and manifest writing remain in charge.
"""

import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

from graphify import cache, detect, llm
from graphify.__main__ import main as graphify_main


SEMANTIC_TYPES = ("document", "paper", "image")


def source_path(root, value):
    return (root / value).resolve()


def scoped_detection(result, root, selected):
    """Filter dispatch queues without excluding files from the live corpus."""
    discovered = {
        source_path(root, file)
        for kind in SEMANTIC_TYPES
        for file in result.get("files", {}).get(kind, [])
    }
    if missing := selected - discovered:
        raise ValueError(
            "Graphify cannot semantically index: "
            + ", ".join(str(file.relative_to(root)) for file in sorted(missing))
        )
    for queue in ("new_files", "unchanged_files"):
        for kind in SEMANTIC_TYPES:
            entries = result.get(queue, {}).get(kind, [])
            if entries:
                result[queue][kind] = [
                    file for file in entries if source_path(root, file) in selected
                ]
    return result


def strict_extract(extract, files, *, root, **options):
    """Reject clean-looking omissions, including an omitted slice of a covered file."""
    callback = options.pop("on_chunk_done", None)
    # Match the upstream dispatch order before enabling one unit per request.
    units = llm.expand_oversized_files(files, llm._FILE_CHAR_CAP)
    omitted = []

    def validate(index, total, result):
        unit = units[index]
        source = llm.unit_path(unit).resolve()
        if not any(
            (value := node.get("source_file"))
            and source_path(root, value) == source
            for node in result.get("nodes", [])
        ):
            part = f" (slice {unit.index + 1}/{unit.total})" if isinstance(unit, llm.FileSlice) else ""
            omitted.append(f"{source.relative_to(root)}{part}")
        if callback:
            callback(index, total, result)

    result = extract(
        files, root=root, **(options | {
            "token_budget": None, "chunk_size": 1, "on_chunk_done": validate,
        }),
    )
    if omitted or result.get("failed_chunks") or llm._partial_source_files(result):
        detail = f": {', '.join(sorted(omitted))}" if omitted else ""
        raise ValueError(f"Graphify semantic extraction did not cover every requested unit{detail}")
    return result


def cached_markdown_units(extract, cache_root):
    """Reuse only complete, byte-identical Markdown slices across file edits."""
    def run(chunk, backend, api_key, model, root, max_depth, _depth=0, *, deep_mode=False):
        options = dict(
            backend=backend, api_key=api_key, model=model, root=root,
            max_depth=max_depth, _depth=_depth, deep_mode=deep_mode,
        )
        unit = chunk[0] if len(chunk) == 1 else None
        if _depth or not isinstance(unit, llm.FileSlice) or unit.path.suffix.lower() != ".md":
            return extract(chunk, **options)
        source = unit.path.relative_to(root).as_posix()
        # Include the exact excerpt, its position, source identity, and extraction
        # policy. Earlier/later source facts cannot leak into a changed slice.
        key = hashlib.sha256(json.dumps([
            source, unit.start, llm.read_slice_text(unit), backend,
            model or llm._default_model_for_backend(backend),
            llm._extraction_system(deep=deep_mode),
        ], ensure_ascii=False).encode()).hexdigest()
        entry = cache_root / f"{key}.json"

        def complete(result):
            return (
                not llm._partial_source_files(result)
                and any(
                    (value := node.get("source_file"))
                    and source_path(root, value) == unit.path.resolve()
                    for node in result.get("nodes", [])
                )
            )

        try:
            cached = json.loads(entry.read_text(encoding="utf-8"))
            if complete(cached):
                return cached | {"input_tokens": 0, "output_tokens": 0}
        except (OSError, ValueError, AttributeError, TypeError):
            pass

        result = extract(chunk, **options)
        if complete(result):
            # Local checkpoints survive a failed large run without ever making
            # an incomplete per-file result visible to Graphify's manifest.
            try:
                cache_root.mkdir(parents=True, exist_ok=True)
                with NamedTemporaryFile(dir=cache_root, mode="w", encoding="utf-8", delete=False) as handle:
                    try:
                        json.dump(result, handle, ensure_ascii=False)
                        handle.flush()
                        os.replace(handle.name, entry)
                    finally:
                        Path(handle.name).unlink(missing_ok=True)
            except OSError as error:
                print(f"[thingtime graphify] could not checkpoint semantic slice: {error}", file=sys.stderr)
        return result
    return run


def main():
    installed = version("graphifyy")
    if installed != "0.9.89":
        raise ValueError(
            f"Scoped semantic extraction supports Graphify 0.9.89; found {installed}. "
            "Verify the adapter against the new upstream dispatch API before upgrading."
        )
    root = Path.cwd().resolve()
    output = Path(os.environ["GRAPHIFY_OUT"])
    selected = {
        source_path(root, file)
        for file in json.loads(os.environ["THINGTIME_GRAPHIFY_SEMANTIC_FILES"])
    }
    if selected and not (output / "graph.json").is_file():
        raise ValueError("Scoped semantic extraction requires an existing graph")
    if any(not file.is_relative_to(root) for file in selected):
        raise ValueError("Semantic files must stay inside the repository")

    original_detection = detect.detect_incremental
    original_extract = llm.extract_corpus_parallel
    original_prompt = llm._extraction_system
    expected = {}
    original_cache_check = cache.check_semantic_cache
    original_cache_load = cache.load_cached

    def expect(files):
        for file in files:
            source = source_path(root, file)
            expected[source] = detect._md5_file(source)

    def check_cache(files, *args, **options):
        expect(files)
        return original_cache_check(files, *args, **options)

    def load_cache(*args, **options):
        # Upstream permits legacy entries with no prompt provenance by default.
        if options.get("kind", "").startswith("semantic"):
            options["allow_legacy"] = False
        return original_cache_load(*args, **options)

    def detect_scoped(*args, **kwargs):
        result = scoped_detection(original_detection(*args, **kwargs), root, selected)
        for kind in SEMANTIC_TYPES:
            for file in result["files"].get(kind, []):
                source = source_path(root, file)
                if source in selected:
                    expect([source])
        return result

    def extract_scoped(files, **options):
        if selected and not {source_path(root, file) for file in files} <= selected:
            raise ValueError("Refusing to dispatch semantic sources outside the selected scope")
        expect(files)
        return strict_extract(original_extract, files, **options)

    def complete_prompt(*, deep=False):
        # This prompt change also isolates verified results from older cache
        # entries that may contain just one slice of the same file.
        return original_prompt(deep=deep) + (
            "\nAnalyze the entire supplied excerpt independently, including its final lines. "
            "Extract the main subject and each substantial named section or procedure present, "
            "with precise labels and meaningful relationships grounded in the supplied text."
        )

    if selected:
        detect.detect_incremental = detect_scoped
    cache.check_semantic_cache = check_cache
    cache.load_cached = load_cache
    llm.extract_corpus_parallel = extract_scoped
    llm._extraction_system = complete_prompt
    llm._extract_with_adaptive_retry = cached_markdown_units(
        llm._extract_with_adaptive_retry,
        root / "graphify-out" / "cache" / "semantic-units" / "v1",
    )
    # A per-chunk cache entry is only a fragment of a long document. Let
    # upstream save the file cache once all of its slices pass validation.
    os.environ["GRAPHIFY_NO_INCREMENTAL_CACHE"] = "1"
    try:
        graphify_main()
    except SystemExit as exit_signal:
        # The Graphify entry point exits even when dispatch succeeded.
        if exit_signal.code not in (None, 0):
            raise

    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    graph = json.loads((output / "graph.json").read_text(encoding="utf-8"))
    coverage = {
        source_path(root, node["source_file"])
        for node in graph["nodes"]
        if node.get("_origin") == "semantic" and node.get("source_file")
    }
    for source in sorted(selected | expected.keys()):
        relative = source.relative_to(root).as_posix()
        current = detect._md5_file(source)
        if (
            expected.get(source) != current
            or manifest.get(relative, {}).get("semantic_hash") != current
            or source not in coverage
        ):
            raise ValueError(f"Graphify did not verify current semantic coverage for {relative}")
        print(f"[thingtime graphify] verified semantic hash for {relative}: {current}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
