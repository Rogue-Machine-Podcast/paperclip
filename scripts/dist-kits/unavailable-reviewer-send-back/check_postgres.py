#!/usr/bin/env python3
"""Run patched-dist queries against an isolated, freshly migrated PostgreSQL cluster."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--postgres-bin', type=Path, required=True, help='Directory containing initdb and pg_ctl')
parser.add_argument('--server', type=Path, default=Path.home()/'.paperclip/cli/installs/npm/2026.1005.0/node_modules/@paperclipai/server')
args = parser.parse_args()
base = Path(os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR', os.environ.get('PAPERCLIP_SCRATCH_DIR', str(HERE/'checks'))))
base.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='rog1333-pg-', dir=base)).resolve()
data = work/'data'
log = work/'postgres.log'
env = {key: value for key, value in os.environ.items() if not key.startswith('PG') and key != 'DATABASE_URL'}
subprocess.run([str(args.postgres_bin/'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '-E', 'UTF8'],
    check=True, stdout=subprocess.DEVNULL, env=env)
with socket.socket() as reservation:
    reservation.bind(('127.0.0.1', 0))
    port = str(reservation.getsockname()[1])
try:
    subprocess.run([str(args.postgres_bin/'pg_ctl'), '-D', str(data), '-l', str(log),
        '-o', f"-F -h 127.0.0.1 -k '' -p {port}", '-w', 'start'], check=True, stdout=subprocess.DEVNULL, env=env)
    subprocess.run([sys.executable, str(HERE/'check_dist.py'), '--server', str(args.server),
        '--postgres-data', str(data), '--postgres-port', port], check=True, env=env)
finally:
    if (data/'postmaster.pid').exists():
        subprocess.run([str(args.postgres_bin/'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'],
            check=True, stdout=subprocess.DEVNULL, env=env)
print('PASS scratch PostgreSQL stopped; fresh loopback port and verified data directory; live database never connected', flush=True)
