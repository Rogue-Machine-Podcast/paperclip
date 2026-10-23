#!/usr/bin/env python3
"""Exercise only scratch copies, including corruption and partial-write failures."""
import contextlib
import importlib.util
import io
import itertools
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch as mock_patch

HERE = Path(__file__).resolve().parent
base = Path(os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR', os.environ.get('PAPERCLIP_SCRATCH_DIR', str(HERE/'checks'))))
base.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='rog1333-round-trip-', dir=base))
kit = work/'kit'
shutil.copytree(HERE, kit, ignore=shutil.ignore_patterns('checks', '__pycache__', '.git', '.kit.lock'))
spec = importlib.util.spec_from_file_location('tested_kit', kit/'patch.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work/'dist'
root.mkdir()
replacements = module.artifacts()
count = 0

def reset(kind='original'):
    for name, original, patched in module.FILES:
        p = root/name
        p.parent.mkdir(parents=True, exist_ok=True)
        if replacements[kind][name] is None:
            p.unlink(missing_ok=True)
        else:
            p.write_bytes(replacements[kind][name])


def command(cmd, success):
    env = {**os.environ, 'PAPERCLIP_DIST_ROOT': str(root)}
    result = subprocess.run([sys.executable,str(kit/'patch.py'),cmd],env=env,capture_output=True,text=True)
    assert (result.returncode == 0) is success, (cmd,result.stdout,result.stderr)
    return (result.stdout+result.stderr).strip()


def unchanged(before):
    assert module.snapshot(root) == before
    assert not list(root.rglob('*.rog1333-*'))


def refused(cmd):
    global count
    before = module.snapshot(root)
    command(cmd,False)
    unchanged(before)
    count += 1

reset()
original = module.snapshot(root)
print(command('verify',True))
print(command('apply',True))
assert module.state(root) == 'patched'
refused('apply')
print(command('rollback',True))
assert module.snapshot(root) == original
assert not (root/module.FILES[-1][0]).exists()
refused('rollback')
print('PASS scratch round trip: original -> patched -> original; 4 originals byte-identical; new file absent')
for name, original_sha, patched_sha in module.FILES:
    for suffix in (['.orig','.patched'] if original_sha else ['']):
        artifact = kit/(name+suffix)
        saved = artifact.read_bytes()
        try:
            artifact.write_bytes(saved+b'corruption')
            for kind, cmd in [('original','apply'),('patched','rollback')]:
                reset(kind)
                assert module.state(root) == kind  # state depends on pinned constants, not candidates
                refused(cmd)
        finally:
            artifact.write_bytes(saved)
print('PASS corrupted artifacts: all 9 replacements/backups refused in both directions; no target bytes changed')
for bits in itertools.product([False,True],repeat=5):
    if all(bits) or not any(bits):
        continue
    reset()
    for bit,(name,orig,patched) in zip(bits,module.FILES):
        if bit:
            (root/name).write_bytes(replacements['patched'][name])
    assert module.state(root) == 'mixed'
    refused('apply')
    refused('rollback')
print('PASS mixed state: all 30 original/patched combinations refused by apply and rollback; no bytes changed')
for name, original_sha, patched_sha in module.FILES:
    reset()
    (root/name).write_bytes(b'unknown')
    assert module.state(root) == 'unknown'
    refused('apply')
    refused('rollback')
reset()
(root/module.FILES[-1][0]).write_bytes(b'')
assert module.state(root) == 'unknown'
refused('apply')
refused('rollback')
print('PASS unknown state: corrupt target and present empty new file refused; no bytes changed')
for kind, cmd in [('original','apply'),('patched','rollback')]:
    # Apply has five os.replace writes. Rollback has four writes and a fifth-path unlink.
    targets = [root/name for name,orig,patched in module.FILES if replacements['patched' if cmd=='apply' else 'original'][name] is not None]
    for target in targets:
        for timing in ['before','after']:
            reset(kind)
            before = module.snapshot(root)
            real_replace = os.replace
            fired = [False]
            def faulty_replace(src, dst):
                if Path(dst) == target and not fired[0]:
                    fired[0] = True
                    if timing == 'after':
                        real_replace(src,dst)
                    raise OSError('injected replace failure')
                return real_replace(src,dst)
            with mock_patch.object(module.os,'replace',faulty_replace):
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        module.replace_all(root,cmd)
                    raise AssertionError('injection did not fail')
                except OSError as e:
                    assert 'injected' in str(e)
            assert fired[0]
            unchanged(before)
            count += 1
# Fail just after rollback removes the fifth path.
reset('patched')
before = module.snapshot(root)
real_unlink = Path.unlink
fired = [False]
def faulty_unlink(path, *args, **kwargs):
    result = real_unlink(path,*args,**kwargs)
    if path == root/module.FILES[-1][0] and not fired[0]:
        fired[0] = True
        raise OSError('injected removal failure')
    return result
with mock_patch.object(Path,'unlink',faulty_unlink):
    try:
        module.replace_all(root,'rollback')
        raise AssertionError('injection did not fail')
    except OSError:
        pass
assert fired[0]
unchanged(before)
count += 1
print('PASS partial-write recovery: failures before/after every replacement and after new-file removal restore exact prior bytes')
# Verify replacement temp corruption is detected before any installation.
reset()
before = module.snapshot(root)
real_stage = module.stage
calls = [0]
def corrupted_stage(target,data,mode):
    result = real_stage(target,data,mode)
    calls[0] += 1
    if calls[0] == 2:
        result.write_bytes(b'corrupt temporary replacement')
    return result
with mock_patch.object(module,'stage',corrupted_stage):
    try:
        module.replace_all(root,'apply')
        raise AssertionError('temp corruption not detected')
    except ValueError as e:
        assert 'Temporary replacement hash mismatch' in str(e)
unchanged(before)
count += 1
print('PASS temporary replacement hash mismatch: refused before target writes')
print(f'PASS {count} corruption/state/failure checks plus round trip; live install never targeted')
