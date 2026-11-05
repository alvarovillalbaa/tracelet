"""Bounded, dependency-free execution of the authored Node packet."""
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / 'docs/results/2026/11-05'

def vector():
    rows = []
    for folder, directories, files in os.walk(ROOT, followlinks=False):
        directories[:] = sorted(x for x in directories if x not in {'.git', 'node_modules', '.vercel', 'downloads', 'results'})
        for name in sorted(files):
            path = Path(folder) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                raise RuntimeError('Non-regular source path')
            rows.append({'path': str(path.relative_to(ROOT)), 'mode': stat.S_IMODE(info.st_mode),
                         'bytes': info.st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return sorted(rows, key=lambda row: row['path'])

before = vector()
scratch = Path(tempfile.mkdtemp(prefix='tracelet-local-', dir='/private/tmp'))
identity = scratch.stat()
node = str(Path(shutil.which('node')).resolve())
command = [node, '--experimental-vm-modules', '--test', 'tests/recording.test.mjs', 'tests/workflow.test.mjs']
report = {'kind': 'tracelet-local-checks', 'command': command, 'node': subprocess.check_output([node, '--version'], text=True).strip(),
          'nodeSHA256': hashlib.sha256(Path(node).read_bytes()).hexdigest(), 'sourceBefore': before,
          'startedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'stdout': '', 'stderr': ''}
process = None
try:
    process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True, env={'PATH': str(Path(node).parent) + ':/usr/bin:/bin', 'TZ': 'UTC', 'TMPDIR': str(scratch)})
    selector = selectors.DefaultSelector()
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    for pipe, key in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, key)
    deadline = time.monotonic() + 120
    failure = None
    while selector.get_map():
        if time.monotonic() > deadline:
            failure = '120-second work cap exceeded'
            break
        for entry, _ in selector.select(0.1):
            chunk = os.read(entry.fileobj.fileno(), 8192)
            if not chunk:
                selector.unregister(entry.fileobj)
                continue
            streams[entry.data].extend(chunk)
            if len(streams[entry.data]) > 128 * 1024:
                failure = '128 KiB stream cap exceeded'
                break
        if failure:
            break
    if failure:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    else:
        process.wait(timeout=5)
    report.update({key: bytes(value[:128 * 1024]).decode('utf-8', errors='strict') for key, value in streams.items()})
    report.update(exitCode=process.returncode, failure=failure, completeEOF=not selector.get_map())
    selector.close()
    try:
        os.killpg(process.pid, 0)
        report['processGroupGone'] = False
    except ProcessLookupError:
        report['processGroupGone'] = True
finally:
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    for pipe in [process.stdout, process.stderr] if process else []:
        pipe.close()
    report['sourceAfter'] = vector()
    report['sourceUnchanged'] = before == report['sourceAfter']
    current = scratch.lstat()
    if (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino) or not stat.S_ISDIR(current.st_mode):
        raise RuntimeError('Scratch identity changed; preserving it')
    shutil.rmtree(scratch)
    report['scratchRemoved'] = not scratch.exists()
    report['finishedAtUTC'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    RESULTS.mkdir(parents=True, exist_ok=True)
    output = RESULTS / 'local-checks.json'
    if output.exists():
        raise RuntimeError('Preserve the first receipt; choose a new attempt filename before rerun')
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report.get(key) for key in ['node', 'exitCode', 'failure', 'completeEOF', 'processGroupGone', 'sourceUnchanged', 'scratchRemoved']}))
raise SystemExit(0 if report.get('exitCode') == 0 and report.get('sourceUnchanged') and report.get('processGroupGone') and report.get('completeEOF') else 1)
