#!/usr/bin/env python3
"""Create a fresh symlink mirror and run assertions against the patched dist."""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--scratch', type=Path, default=Path(os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR', os.environ.get('PAPERCLIP_SCRATCH_DIR', str(HERE / 'checks')))))
parser.add_argument('--server', type=Path, default=Path.home()/'.paperclip/cli/installs/npm/2026.1005.0/node_modules/@paperclipai/server')
parser.add_argument('--postgres-data', type=Path)
parser.add_argument('--postgres-port', type=int, default=5432)
args = parser.parse_args()
args.scratch.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='rog1333-dist-', dir=args.scratch))
server = args.server.resolve(strict=True)
mirror = work / 'server'
mirror.mkdir()
spec = importlib.util.spec_from_file_location('kit_patch', HERE/'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
candidates = patch.artifacts()['patched']

def mirror_dir(source, destination):
    destination.mkdir(exist_ok=True)
    for path in source.iterdir():
        target = destination / path.name
        if path.is_dir() and not path.is_symlink():
            mirror_dir(path, target)
        else:
            target.symlink_to(path)

mirror_dir(server/'dist', mirror/'dist')
for name in ['package.json', 'node_modules', 'skills', 'ui-dist']:
    if (server/name).exists():
        (mirror/name).symlink_to(server/name)
(work/'node_modules').symlink_to(server.parent.parent)
for name, data in candidates.items():
    target = mirror/'dist'/name
    if target.is_symlink():
        target.unlink()
    target.write_bytes(data)
    subprocess.run(['node','--check',str(target)],check=True)
print('PASS node --check: 5/5 patched files', flush=True)
shutil.copy2(HERE/'check_queries.mjs', mirror/'check_queries.mjs')
query_command = ['node','--preserve-symlinks',str(mirror/'check_queries.mjs'),str(mirror/'dist')]
if args.postgres_data:
    query_command.extend([str(args.postgres_data),str(args.postgres_port)])
subprocess.run(query_command,check=True,timeout=120,cwd=mirror)
subprocess.run(['node','--preserve-symlinks',str(HERE/'check_dist.mjs'),str(mirror/'dist')],check=True,timeout=50,cwd=mirror)
print('PASS patched-dist behavior and route import', flush=True)
