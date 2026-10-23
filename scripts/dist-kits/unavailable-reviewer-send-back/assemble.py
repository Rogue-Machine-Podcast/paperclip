#!/usr/bin/env python3
"""Assemble a new local kit from the pinned installed originals. Never writes the install."""
import argparse
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kit_patch', HERE/'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=patch.DEFAULT_ROOT)
parser.add_argument('--output',type=Path,required=True)
args = parser.parse_args()
root = args.root.expanduser().resolve(strict=True)
output = args.output.expanduser().absolute()
originals = patch.snapshot(root)
if patch.state_of(originals) != 'original':
    sys.exit('REFUSED: assembly requires all four pinned originals and absent new module')
if output.exists():
    sys.exit('REFUSED: output already exists; choose a new kit directory')
shutil.copytree(HERE,output,ignore=shutil.ignore_patterns('*.orig','*.patched','__pycache__','.kit.lock','checks','checks.txt'))
for name,data in originals.items():
    if data is not None:
        target = output/(name+'.orig')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(data)
subprocess.run([sys.executable,str(output/'rebuild.py')],check=True)
subprocess.run([sys.executable,str(output/'patch.py'),'verify','--root',str(root)],check=True)
print(f'PASS kit assembled: {output}; install unchanged')
