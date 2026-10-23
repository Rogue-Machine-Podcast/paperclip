#!/usr/bin/env python3
"""Emit the pinned new TS module with the repository compiler and compare its bytes."""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--tsc',type=Path,required=True,help='Path to repository node_modules/typescript/bin/tsc')
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('kit_patch', HERE/'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
patch.artifacts()
base = Path(os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR',os.environ.get('PAPERCLIP_SCRATCH_DIR',str(HERE/'checks'))))
base.mkdir(parents=True,exist_ok=True)
out = Path(tempfile.mkdtemp(prefix='rog1333-tsc-',dir=base))
subprocess.run(['node',str(args.tsc),'--ignoreConfig','--noCheck','--noResolve','--target','es2022','--module','esnext',
    '--outDir',str(out),str(HERE/'source/issue-execution-participant-availability.ts')],check=True)
assert (out/'issue-execution-participant-availability.js').read_bytes() == (HERE/'services/issue-execution-participant-availability.js').read_bytes()
print('PASS new availability module: repository tsc output is byte-identical to pinned JS; ES2022/ESNext syntax emit')
