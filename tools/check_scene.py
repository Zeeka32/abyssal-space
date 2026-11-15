"""Exercise real WebGPU in installed Chrome using only Python's standard library.

python tools/check_scene.py --screenshots --benchmark
Runs dev.html (build:dev first), checks every destination, planet collisions,
shader validation, controls, audio and the 60 second camera path. Artifacts
go to .checks/ (ignored). No browser automation packages are needed.
"""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.checks'


class CDP:
    def __init__(self, url):
        from urllib.parse import urlparse
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n'
                           f'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                           'Sec-WebSocket-Version: 13\r\n\r\n').encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += self.sock.recv(1)
        assert header.startswith(b'HTTP/1.1 101 '), header
        self.seq = 0
        self.events = []

    def read(self, n):
        data = b''
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError('Chrome closed the debugging connection')
            data += chunk
        return data

    def send(self, data, opcode=1):
        payload = json.dumps(data).encode() if isinstance(data, dict) else data
        size = len(payload)
        header = bytes([0x80 | opcode])
        header += bytes([0x80 | size]) if size < 126 else bytes([0xfe]) + struct.pack('!H', size) if size < 65536 else bytes([0xff]) + struct.pack('!Q', size)
        mask = os.urandom(4)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def receive(self):
        chunks = []
        while True:
            first, second = self.read(2)
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.read(8))[0]
            mask = self.read(4) if second & 128 else None
            data = self.read(size)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if first & 15 == 9:
                self.send(data, 10)
                continue
            if first & 15 == 8:
                raise ConnectionError('WebSocket closed')
            chunks.append(data)
            if first & 128:
                return json.loads(b''.join(chunks))

    def call(self, method, params=None):
        self.seq += 1
        self.send({'id': self.seq, 'method': method, 'params': params or {}})
        while True:
            message = self.receive()
            if message.get('id') == self.seq:
                if 'error' in message:
                    raise RuntimeError(message['error'])
                return message.get('result', {})
            self.events.append(message)

    def evaluate(self, expression):
        result = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--screenshots', action='store_true')
    parser.add_argument('--benchmark', action='store_true')
    parser.add_argument('--quality', type=int, choices=[0, 1, 2], default=0)
    parser.add_argument('--width', type=int, default=2560)
    parser.add_argument('--height', type=int, default=1440)
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    chrome = Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe'
    port = 9247
    log = (OUT / 'chrome.log').open('w')
    proc = subprocess.Popen([str(chrome), '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
                             '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
                             '--autoplay-policy=no-user-gesture-required', f'--remote-debugging-port={port}',
                             f'--user-data-dir={OUT / "chrome-profile"}', '--window-size=1440,900', 'about:blank'],
                            stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    cdp = None
    try:
        for _ in range(100):
            try:
                pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1))
                page = next(p for p in pages if p['type'] == 'page')
                break
            except (OSError, StopIteration):
                time.sleep(.1)
        else:
            raise RuntimeError('Chrome did not start; inspect .checks/chrome.log')
        cdp = CDP(page['webSocketDebuggerUrl'])
        print('BROWSER', json.dumps(cdp.call('Browser.getVersion')), flush=True)
        cdp.call('Runtime.enable')
        cdp.call('Log.enable')
        cdp.call('Page.enable')
        cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': "window.__gpuRequests=0;if(navigator.gpu){const request=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=(...args)=>{window.__gpuRequests++;return request(...args)}}"})
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': args.width, 'height': args.height, 'deviceScaleFactor': 1, 'mobile': False})
        cdp.call('Page.navigate', {'url': (ROOT / 'dev.html').as_uri()})
        # Set the quality on this file origin, then reload before the scene builds.
        time.sleep(.5)
        cdp.evaluate(f"localStorage.astral='{(args.quality+1)%3}'; localStorage.removeItem('astralLoad'); location.reload()")
        time.sleep(1)
        welcome = cdp.evaluate("({stage:document.body.dataset.stage,requests:window.__gpuRequests,generated:!!window.__astral,width:document.getElementById('c').width})")
        assert welcome == {'stage':'welcome','requests':0,'generated':False,'width':300}, welcome
        cdp.evaluate(f"document.querySelectorAll('#q button')[{(3-args.quality)%3}].click();document.querySelectorAll('#q button')[{2-args.quality}].click()")
        assert cdp.evaluate('window.__gpuRequests') == 0, 'Quality selection started generation'
        if args.screenshots:
            image = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (OUT / f'welcome-q{args.quality}.png').write_bytes(base64.b64decode(image['data']))
        cdp.evaluate("document.getElementById('d').click()")
        for _ in range(180):
            time.sleep(.25)
            state = cdp.evaluate("window.__astral ? __astral.state() : {loading:document.getElementById('s')?.textContent,body:document.body.className}")
            if state.get('ready'):
                break
            if state.get('body') == 'l e':
                raise RuntimeError(state)
        else:
            raise RuntimeError(f'Scene did not become ready: {state}')
        print('READY', json.dumps(state), flush=True)
        assert state['quality'] == args.quality, 'Unexpected quality fallback'
        assert state['samples'] == (1 if args.quality == 2 else 4), 'Pre-start quality choice did not update antialiasing'
        assert state['time'] < 2, 'Simulation time includes pre-start waiting'
        assert cdp.evaluate('window.__gpuRequests') == 1, 'Expected exactly one post-click adapter request'
        assert cdp.evaluate('document.title') == 'Abyssal Space', 'Rename missing'
        assert cdp.evaluate("document.getElementById('credit').href") == 'https://github.com/Noniv/abyssal-garden', 'Credit missing'
        assert cdp.evaluate("document.getElementById('repo').href") == 'https://github.com/Zeeka32/abyssal-space', 'Project repository link missing'
        time.sleep(.5)
        print('AUDIO', json.dumps(cdp.evaluate('__astral.state()')), flush=True)
        assert cdp.evaluate('__astral.state().audio') == 'running'
        cdp.evaluate('__astral.pose(1)')
        tracked_before = cdp.evaluate('__astral.state()')
        time.sleep(.4)
        tracked_after = cdp.evaluate('__astral.state()')
        assert math.dist(tracked_before['centers'][1], tracked_after['centers'][1]) > 1, 'Planets are stationary'
        offset_before = [a-b for a,b in zip(tracked_before['camera'], tracked_before['centers'][1])]
        offset_after = [a-b for a,b in zip(tracked_after['camera'], tracked_after['centers'][1])]
        assert math.dist(offset_before, offset_after) < .001, 'Viewpoint is not following its planet'
        assert tracked_after['propulsion']['drive'] == 0, 'Orbit tracking incorrectly fires propulsion'
        cdp.evaluate('__astral.pose(0)')
        before = cdp.evaluate('__astral.state().camera')
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': 'KeyW', 'key': 'w'})
        time.sleep(.35)
        assert cdp.evaluate('__astral.state().propulsion.drive') > .2, 'Cruise audio failed'
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': 'ShiftLeft', 'key': 'Shift'})
        time.sleep(.35)
        assert cdp.evaluate('__astral.state().propulsion.boost'), 'Warp audio failed'
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': 'ShiftLeft', 'key': 'Shift'})
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': 'KeyW', 'key': 'w'})
        after = cdp.evaluate('__astral.state().camera')
        assert math.dist(before, after) > 1, 'WASD movement failed'
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': 'KeyM', 'key': 'm'})
        assert cdp.evaluate('__astral.state().muted'), 'Mute failed'
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': 'KeyM', 'key': 'm'})
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': 'Escape', 'key': 'Escape'})
        assert cdp.evaluate('__astral.state().menu'), 'Menu failed'
        cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': 'Escape', 'key': 'Escape'})
        if args.screenshots:
            time.sleep(.6)
            image = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (OUT / f'menu-q{args.quality}.png').write_bytes(base64.b64decode(image['data']))
        cdp.evaluate('__astral.pause(true)')
        cdp.evaluate('__astral.pose(0)')
        labels = ['THE SOLAR SYSTEM', 'VERDANT', 'SELENE', 'CINDER', 'VEIL', 'KESTREL', 'NADIR']
        for i in range(7):
            cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': f'Digit{i+1}', 'key': str(i+1)})
            cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': f'Digit{i+1}', 'key': str(i+1)})
            assert cdp.evaluate("document.getElementById('sector').textContent") == labels[i], 'Destination shortcut failed'
            time.sleep(1.1 if i == 0 else .3)
            if args.screenshots:
                image = cdp.call('Page.captureScreenshot', {'format': 'png'})
                (OUT / f'pose-{i+1}-q{args.quality}.png').write_bytes(base64.b64decode(image['data']))
        bodies = cdp.evaluate('__astral.bodies')
        # Collision tests sweep all the way through each body at faster than a normal frame.
        for b in bodies:
            x, y, z = b['p']
            radius = b['r']
            p = cdp.evaluate(f'__astral.collide({x},{y},{z+radius+25},0,0,{-2*(radius+25)})')
            assert math.dist(p, b['p']) >= radius + 2.99, (b['name'], p)
        paths = cdp.evaluate('Array.from({length:601},(_,i)=>__astral.path(i/10))')
        intersections = [(i/10, b['name']) for i, p in enumerate(paths) for b in bodies if math.dist(p, b['p']) < b['r']+3]
        assert not intersections, f'Camera path intersects bodies: {intersections[:10]}'
        star = cdp.evaluate('__astral.star')[:3]
        distant_before = cdp.evaluate('__astral.distant()')
        samples = cdp.evaluate('Array.from({length:421},(_,i)=>__astral.orbits(i*10))')
        primary = [b for b in samples[0] if b['parent'] < 0]
        phases = sorted(math.atan2(b['p'][2]-star[2], b['p'][0]-star[0]) % math.tau for b in primary)
        gaps = [(phases[(i+1)%len(phases)]-a) % math.tau for i,a in enumerate(phases)]
        assert max(gaps) < math.pi, 'Initial planets are clustered on one side of the sun'
        assert all(abs(b['p'][1]-star[1]) < b['radius']*.031 for b in primary), 'Initial planets are below the ecliptic'
        assert cdp.evaluate('__astral.distant()') == distant_before, 'Background planets are orbiting with the system'
        assert len(distant_before) == 3, 'Missing distant background planets'
        for system in samples:
            for i, b in enumerate(system):
                parent = star if b['parent'] < 0 else system[b['parent']]['p']
                assert abs(math.dist(b['p'], parent) - b['radius']) < .000001, 'Orbit radius changed'
                for other in system[i+1:]:
                    assert math.dist(b['p'], other['p']) > b['r'] + other['r'] + 6, 'Planetary orbits collide'
        hole = cdp.evaluate('__astral.hole')
        x,y,z = hole['p']
        radius = hole['r']*1.22
        p = cdp.evaluate(f'__astral.collide({x},{y},{z+radius+25},0,0,{-2*(radius+25)})')
        assert math.dist(p, hole['p']) >= radius + 2.99, 'Black hole horizon collision failed'
        print('PASS: deferred generation, sun-centered starting layout, fixed background planets, seven destinations, orbital tracking, 421 orbital configurations, cruise/warp audio, credits, collisions, camera path', flush=True)
        cdp.evaluate('__astral.pause(false)')
        cdp.evaluate('__astral.pose(0)')
        if args.benchmark:
            cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'code': 'KeyB', 'key': 'b'})
            cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': 'KeyB', 'key': 'b'})
            for second in range(66):
                time.sleep(1)
                report = cdp.evaluate("document.getElementById('i').textContent")
                if 'Fly-through' in report:
                    break
                if second % 15 == 0:
                    print('BENCHMARK', second, json.dumps(cdp.evaluate('__astral.state()')), flush=True)
            assert 'Fly-through' in report, 'Benchmark did not finish'
            print(report, flush=True)
            (OUT / f'benchmark-q{args.quality}.txt').write_text(report, encoding='utf-8')
        # The shipped minified bundle must also compile and work directly from disk.
        cdp.call('Page.navigate', {'url': (ROOT / 'index.html').as_uri()})
        for _ in range(120):
            time.sleep(.25)
            production = cdp.evaluate("({body:document.body.className,status:document.getElementById('s')?.textContent})")
            if 'welcome' in production['body']:
                break
            assert production['body'] != 'l e', production
        else:
            raise RuntimeError(f'Production failed to load: {production}')
        assert cdp.evaluate("typeof window.__astral === 'undefined'"), 'Dev hooks leaked into production'
        assert cdp.evaluate('window.__gpuRequests') == 0, 'Production requested GPU before Start'
        cdp.evaluate("document.getElementById('d').click()")
        for _ in range(120):
            time.sleep(.25)
            stage = cdp.evaluate('document.body.dataset.stage')
            if stage == 'ready': break
            assert cdp.evaluate("document.body.className") != 'l e', 'Production startup failed'
        else: raise RuntimeError('Production startup timed out')
        assert cdp.evaluate("document.body.className.startsWith('g')"), 'Production launch failed'
        if args.screenshots:
            image = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (OUT / f'production-q{args.quality}.png').write_bytes(base64.b64decode(image['data']))
        print('PASS: offline minified index.html, production launch, no development hooks', flush=True)
        errors = []
        for e in cdp.events:
            method, params = e.get('method'), e.get('params', {})
            if method == 'Runtime.exceptionThrown' or method == 'Log.entryAdded' and params['entry']['level'] == 'error':
                errors.append(e)
            if method == 'Runtime.consoleAPICalled' and params.get('type') == 'error':
                errors.append(e)
        (OUT / f'errors-q{args.quality}.json').write_text(json.dumps(errors, indent=2), encoding='utf-8')
        assert not errors, json.dumps(errors, indent=2)
        print('PASS: no WebGPU validation, console or page errors', flush=True)
    finally:
        if cdp:
            try:
                cdp.call('Browser.close')
            except (OSError, RuntimeError):
                pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.terminate()
        log.close()


if __name__ == '__main__':
    main()
