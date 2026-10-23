#!/usr/bin/env python3
"""Reconstruct patched kit artifacts from pinned originals and exact PR 13 edits."""
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kit_patch', HERE/'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
edits = json.loads((HERE/'port-edits.json').read_text())
outputs = {}
for name, original, patched in patch.FILES:
    if original is None:
        continue
    data = patch.read_regular(HERE/(name+'.orig'))
    if patch.digest(data) != original:
        sys.exit(f'Original hash mismatch: {name}')
    text = data.decode()
    for old, new in edits[name]:
        if text.count(old) != 1:
            sys.exit(f'Non-unique port anchor in {name}')
        text = text.replace(old,new,1)
    data = text.encode()
    if patch.digest(data) != patched:
        sys.exit(f'Output hash mismatch: {name}')
    outputs[name] = data
# Compare first. Rebuilding never overwrites an existing artifact with different bytes.
for name, data in outputs.items():
    target = HERE/(name+'.patched')
    if target.exists() and patch.read_regular(target) != data:
        sys.exit(f'Existing artifact differs: {target}')
for name, data in outputs.items():
    target = HERE/(name+'.patched')
    if not target.exists():
        target.write_bytes(data)
print('PASS exact-anchor rebuild: 4/4 artifacts match pinned patched SHA-256 constants')
