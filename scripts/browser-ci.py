"""One bounded public-runner packet. Browser tooling lives outside the checkout."""
import base64
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
import zlib

ROOT = Path(__file__).resolve().parent.parent
assert os.environ.get('CI') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
SCRATCH = Path(tempfile.mkdtemp(prefix='tl-', dir='/tmp'))
SCRATCH_ID = SCRATCH.stat()
assert len(str(SCRATCH).encode()) <= 20, 'Keep Chromium Unix socket roots short.'
os.environ['TRACELET_SCRATCH'] = str(SCRATCH)
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(SCRATCH / 'browsers')
os.environ['npm_config_cache'] = str(SCRATCH / 'npm-cache')
os.environ['TMPDIR'] = str(SCRATCH)
TOOLING = SCRATCH / 'tooling'
TOOLING.mkdir(mode=0o700)
os.environ['PLAYWRIGHT_MODULE'] = (TOOLING / 'node_modules/playwright/index.mjs').as_uri()
report = {'kind': 'tracelet-browser-ci', 'startedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'commands': [], 'guards': [], 'cleanup': {}, 'errors': []}
groups = []
interrupted = False
output_identity = None
baseline = None

def interrupt(signum, frame):
    global interrupted
    interrupted = True

for owned_signal in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
    signal.signal(owned_signal, interrupt)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

def vector():
    rows = []
    for name in git('ls-files', '-z').split('\0'):
        if not name:
            continue
        path = ROOT / name
        info = path.lstat()
        assert stat.S_ISREG(info.st_mode) and not path.is_symlink(), name
        rows.append({'path': name, 'mode': stat.S_IMODE(info.st_mode), 'bytes': info.st_size,
                     'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return sorted(rows, key=lambda row: row['path'])

def group_gone(pid):
    try:
        os.killpg(pid, 0)
        return False
    except ProcessLookupError:
        return True

def run(label, args, cap=120, output_cap=256 * 1024):
    item = {'label': label, 'args': args, 'startedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    report['commands'].append(item)
    child = subprocess.Popen(args, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    groups.append(child.pid)
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    poll = selectors.DefaultSelector()
    for pipe, key in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]:
        os.set_blocking(pipe.fileno(), False)
        poll.register(pipe, selectors.EVENT_READ, key)
    deadline = time.monotonic() + cap
    try:
        while poll.get_map():
            if interrupted:
                raise InterruptedError(label + ' interrupted')
            if time.monotonic() > deadline:
                raise TimeoutError(label + ' work cap exceeded')
            for entry, _ in poll.select(0.1):
                data = os.read(entry.fileobj.fileno(), 8192)
                if not data:
                    poll.unregister(entry.fileobj)
                    continue
                streams[entry.data].extend(data)
                if len(streams[entry.data]) > output_cap:
                    raise RuntimeError(label + ' output cap exceeded')
        child.wait(timeout=10)
        item['completeEOF'] = True
    except Exception as error:
        item['error'] = str(error)
        if not group_gone(child.pid):
            os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
        deadline = time.monotonic() + 5
        while not group_gone(child.pid) and time.monotonic() < deadline:
            time.sleep(0.05)
        if not group_gone(child.pid):
            os.killpg(child.pid, signal.SIGKILL)
    finally:
        item['exitCode'] = child.poll()
        settle = time.monotonic() + 5
        while not group_gone(child.pid) and time.monotonic() < settle:
            time.sleep(0.05)
        item['processGroupGone'] = group_gone(child.pid)
        for key, value in streams.items():
            raw = bytes(value[:output_cap])
            item[key] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                         'zlibBase64': base64.b64encode(zlib.compress(raw)).decode()}
        item['finishedAtUTC'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        poll.close()
        child.stdout.close()
        child.stderr.close()
    if item.get('error') or item['exitCode'] != 0 or not item.get('completeEOF') or not item['processGroupGone']:
        raise RuntimeError(label + ' failed; preserved output belongs to this attempt')
    return bytes(streams['stdout']).decode('utf8')

try:
    baseline = vector()
    report['head'] = git('rev-parse', 'HEAD')
    report['tree'] = git('rev-parse', 'HEAD^{tree}')
    report['preparation'] = os.environ['TRACELET_PREPARATION_SHA']
    assert git('rev-parse', 'HEAD^') == report['preparation']
    assert git('diff', '--name-only', report['preparation'], 'HEAD') == '.github/workflows/tracelet-acceptance.yml'
    assert not git('status', '--porcelain=v1', '--untracked-files=all')
    output = ROOT / 'site/downloads'
    assert not os.path.lexists(output), 'Generated output must be absent before this task.'
    output.mkdir(mode=0o700)
    owned_output = output.lstat()
    output_identity = (owned_output.st_dev, owned_output.st_ino)
    report['guards'].append({'stage': 'before', 'files': baseline, 'matched': True})
    run('static', ['node', 'scripts/check.mjs'])
    run('package', ['node', 'scripts/package.mjs'])
    run('browser-tooling', ['npm', 'install', '--prefix', str(TOOLING), '--no-save', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', 'playwright@1.64.1'], cap=180)
    runtime_program = 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(' + json.dumps(str(TOOLING / 'node_modules/playwright/package.json')) + ',"utf8")); if(p.version!=="1.64.1")throw Error("Unexpected browser tooling version"); console.log(JSON.stringify({node:process.version,playwright:p.version}));'
    report['runtime'] = json.loads(run('runtime-identity', ['node', '-e', runtime_program]))
    run('chromium-install', ['node', str(TOOLING / 'node_modules/playwright/cli.js'), 'install', '--with-deps', 'chromium'], cap=300)
    run('native-input-tooling', ['sudo', 'apt-get', 'install', '-y', 'xdotool'], cap=120)
    assert vector() == baseline
    report['guards'].append({'stage': 'before-browser', 'matched': True})
    browser = run('installed-workspace', ['node', 'tests/browser.mjs'], cap=180)
    records = [line.removeprefix('TRACELET_BROWSER_REPORT=') for line in browser.splitlines() if line.startswith('TRACELET_BROWSER_REPORT=')]
    assert len(records) == 1
    report['browser'] = json.loads(records[0])
    assert report['browser']['passed'] == 2 and report['browser']['failed'] == 0
    capture = run('actual-tab-capture', ['xvfb-run', '-a', 'node', 'tests/capture.browser.mjs'], cap=180)
    records = [line.removeprefix('TRACELET_CAPTURE_REPORT=') for line in capture.splitlines() if line.startswith('TRACELET_CAPTURE_REPORT=')]
    assert len(records) == 1
    report['capture'] = json.loads(records[0])
    assert report['capture']['status'] == 'passed'
except Exception as error:
    report['errors'].append(str(error))
finally:
    report['guards'].append({'stage': 'after-working-bytes', 'matched': baseline is not None and vector() == baseline})
    report['cleanup']['commandGroupsGone'] = all(group_gone(pid) for pid in groups)
    try:
        output = ROOT / 'site/downloads'
        output = ROOT / 'site/downloads'
        if output_identity is not None and os.path.lexists(output):
            observed_output = output.lstat()
            assert stat.S_ISDIR(observed_output.st_mode) and not output.is_symlink()
            assert (observed_output.st_dev, observed_output.st_ino) == output_identity
            assert set(x.name for x in output.iterdir()).issubset({'integrity.json', 'tracelet-0.1.0.zip'})
            for path in output.iterdir():
                assert path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1
                path.unlink()
            output.rmdir()
        report['cleanup']['generatedOutputRemoved'] = output_identity is not None and not os.path.lexists(output)
        git_unchanged = git('rev-parse', 'HEAD') == report.get('head') and git('rev-parse', 'HEAD^{tree}') == report.get('tree') and git('write-tree') == report.get('tree')
        clean = not git('status', '--porcelain=v1', '--untracked-files=all') and not git('ls-files', '--others', '--ignored', '--exclude-standard', '-z')
        report['guards'].append({'stage': 'after-git-head-index-status-ignored', 'matched': git_unchanged and clean})
        current = SCRATCH.lstat()
        assert stat.S_ISDIR(current.st_mode) and not SCRATCH.is_symlink() and (current.st_dev, current.st_ino) == (SCRATCH_ID.st_dev, SCRATCH_ID.st_ino)
        # Browser drivers acknowledge context closure before deleting their profiles.
        owned_browser_residue = [p.name for p in SCRATCH.iterdir() if p.name.startswith(('tracelet-B', 'tracelet-C'))]
        assert not owned_browser_residue, 'Browser-owned residue retained: ' + repr(owned_browser_residue)
        assert report['cleanup']['commandGroupsGone'], 'An owned command group remains.'
        shutil.rmtree(SCRATCH)
        report['cleanup']['scratchRemoved'] = not SCRATCH.exists()
    except Exception as error:
        report['errors'].append('cleanup: ' + str(error))
    report['finishedAtUTC'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    report['interrupted'] = interrupted
    report['passed'] = not interrupted and not report['errors'] and all(g['matched'] for g in report['guards']) and all(report['cleanup'].values())
    print('TRACELET_CI_REPORT=' + json.dumps(report), flush=True)
raise SystemExit(0 if report['passed'] else 1)
