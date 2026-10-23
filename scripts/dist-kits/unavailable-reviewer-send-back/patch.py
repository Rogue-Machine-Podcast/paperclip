#!/usr/bin/env python3
"""Port PR 13 into Paperclip 2026.1005.0. ENG applies after review. Never restarts."""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = Path.home() / ".paperclip/cli/installs/npm/2026.1005.0/node_modules/@paperclipai/server/dist"
# name, original SHA-256 (None requires absence), patched SHA-256.
AVAILABILITY_SOURCE_SHA = '0a73c325dc62de3aba6ae6ec97e61a1a46866ab2bd53461b42cdb6dfb7c8d2b9'
FILES = (
    ('routes/issues.js', '5089ec331830eaa31a6f166721f9f5d7746531d2a698862900696db573b30964', 'baa808a570500d5de01b7f8afc0bf100fbcf9a4b1efe4a0332fc6ec56258de2c'),
    ('services/issue-execution-policy.js', '69cf5576be806043c123d7494a4060b7e66f0b59a64a4a0d4be07c4102763bad', '161bbc3d8ad0729792d2a0f18b85066da65a81f7d4539671b14cf985c92b2a53'),
    ('services/issues.js', '0fa69b29c66acf9aaafc073ad5ebfb4bc9238c81a25066a0de1011bfe2e46073', '9aaf2da2d3cc9dfaa2df9143ca94f2b00b2203675f21a3f1b597e652d5c731e6'),
    ('services/recovery/issue-graph-liveness.js', 'be472a82ad60b77a13508ad7482f87c3a14bab29d7adff6a1bf67f6ec467f466', 'd205bf98bf96a9b0fb908d30a1c65e5048548e492bdb4cb06bca49170382f163'),
    ('services/issue-execution-participant-availability.js', None, '4ec6fc9f4549bc88bb3cae341c70568785a1698f1a229bd9ef8c00f59f947668'),
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Expected a regular file: {path}")
    return path.read_bytes()


def target_path(root, name):
    target = root / name
    for parent in [target, *target.parents]:
        if parent.is_symlink():
            raise ValueError(f"Symlink target refused: {parent}")
        if parent == root:
            break
    if not target.parent.is_dir():
        raise ValueError(f"Missing target directory: {target.parent}")
    return target


def snapshot(root):
    result = {}
    for name, original_sha, patched_sha in FILES:
        target = target_path(root, name)
        result[name] = read_regular(target) if target.exists() else None
    return result


def state_of(contents):
    actual = {name: digest(data) if data is not None else None for name, data in contents.items()}
    if all(actual[name] == original for name, original, patched in FILES):
        return "original"
    if all(actual[name] == patched for name, original, patched in FILES):
        return "patched"
    if all(actual[name] in (original, patched) for name, original, patched in FILES):
        return "mixed"
    return "unknown"


def state(root):
    return state_of(snapshot(root))


def artifacts():
    if digest(read_regular(HERE / "source/issue-execution-participant-availability.ts")) != AVAILABILITY_SOURCE_SHA:
        raise ValueError("Availability TypeScript source hash mismatch")
    replacements = {"original": {}, "patched": {}}
    for name, original_sha, patched_sha in FILES:
        for kind, expected in [("original", original_sha), ("patched", patched_sha)]:
            if expected is None:
                replacements[kind][name] = None
                continue
            suffix = ".orig" if kind == "original" else (".patched" if original_sha else "")
            path = HERE / (name + suffix)
            data = read_regular(path)
            if digest(data) != expected:
                raise ValueError(f"Kit hash mismatch: {name}{suffix}")
            replacements[kind][name] = data
    return replacements


def stage(target, data, mode):
    fd, name = tempfile.mkstemp(prefix=f".{target.name}.rog1333-", dir=target.parent)
    path = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
        if digest(read_regular(path)) != digest(data):
            raise ValueError(f"Temporary file hash mismatch: {target.name}")
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def replace_all(root, command):
    before = snapshot(root)
    required, desired = ("original", "patched") if command == "apply" else ("patched", "original")
    current = state_of(before)
    if current != required:
        raise ValueError(f"live: {current}; {command} needs {required}; no files changed")
    candidates = artifacts()[desired]
    staged, recovery, changed = {}, {}, []
    try:
        for name, original_sha, patched_sha in FILES:
            target = target_path(root, name)
            mode = stat.S_IMODE(target.stat().st_mode) if before[name] is not None else 0o644
            if before[name] is not None:
                recovery[name] = stage(target, before[name], mode)
            if candidates[name] is not None:
                staged[name] = stage(target, candidates[name], mode)
                expected = patched_sha if desired == "patched" else original_sha
                if digest(read_regular(staged[name])) != expected:
                    raise ValueError(f"Temporary replacement hash mismatch: {name}")
        if snapshot(root) != before:
            raise ValueError("Live files changed during staging; no files changed by this command")
        for name, original_sha, patched_sha in FILES:
            target = target_path(root, name)
            changed.append(name)
            if candidates[name] is None:
                target.unlink()
            else:
                expected = patched_sha if desired == "patched" else original_sha
                if digest(read_regular(staged[name])) != expected:
                    raise ValueError(f"Temporary replacement hash mismatch: {name}")
                os.replace(staged[name], target)
        if state(root) != desired:
            raise ValueError("Post-write state mismatch")
    except BaseException as error:
        failures = []
        for name in reversed(changed):
            target = root / name
            try:
                if before[name] is None:
                    target.unlink(missing_ok=True)
                else:
                    if digest(read_regular(recovery[name])) != digest(before[name]):
                        raise ValueError("Recovery temporary file hash mismatch")
                    os.replace(recovery[name], target)
            except BaseException as restore_error:
                failures.append(f"{name}: {restore_error}")
        if failures:
            # Keep surviving recovery files for the operator if the filesystem refuses restoration.
            recovery.clear()
            raise RuntimeError("RESTORATION FAILED: " + "; ".join(failures)) from error
        if snapshot(root) != before:
            raise RuntimeError("RESTORATION FAILED: original bytes differ") from error
        raise
    finally:
        for path in [*staged.values(), *recovery.values()]:
            path.unlink(missing_ok=True)
    print(f"live: {desired}; {command} complete; no restart performed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["verify", "apply", "rollback"], nargs="?", default="verify")
    parser.add_argument("--root", type=Path, default=Path(os.environ.get("PAPERCLIP_DIST_ROOT", str(DEFAULT_ROOT))))
    args = parser.parse_args()
    root = args.root.expanduser().resolve(strict=True)
    with (HERE / ".kit.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == "verify":
            current = state(root)
            artifacts()
            print(f"live: {current}; kit: verified (10 SHA-256 digests; new-file original: absent)")
            if current not in ("original", "patched"):
                return 1
        else:
            replace_all(root, args.command)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        sys.exit(1)
