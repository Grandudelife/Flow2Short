// Exercise the real editor render pipeline against the packaged native service.
// DOM stubs only supply control values; uploads, probing, encoding, transitions,
// ASS subtitles, download bytes, and cancellation use the actual executables.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

async function main() {
  const resources = process.argv[2];
  const fixtures = process.argv[3];
  assert.ok(resources && fixtures, 'Pass app Resources and fixture directories');
  const token = randomUUID() + randomUUID();
  const executable = name => path.join(resources, name + (process.platform === 'win32' ? '.exe' : ''));
  const service = spawn(executable('flow2short-server'), ['--desktop'], {
    cwd: resources, env: { ...process.env, FLOW2SHORT_DESKTOP_TOKEN: token, XDG_CONFIG_HOME: path.join(fixtures, 'test-config'), ...(process.platform === 'win32' ? {APPDATA:path.join(fixtures, 'test-config')} : {}) }, stdio: ['pipe', 'pipe', 'inherit']
  });
  const base = await new Promise((resolve, reject) => {
    let line = '';
    service.stdout.on('data', data => { line += data; if (line.includes('\n')) resolve(line.split('\n')[0]); });
    service.on('error', reject); service.on('exit', code => reject(new Error(`Service exited: ${code}`)));
  });
  const originalFetch = global.fetch;
  global.fetch = (input, options = {}) => {
    const url = new URL(input, base);
    const headers = new Headers(options.headers);
    if (url.pathname.startsWith('/__')) headers.set('X-Flow2Short-Desktop', token);
    return originalFetch(url, { ...options, headers });
  };
  try {
    assert.equal((await originalFetch(new URL('/__native/load', base), { method: 'POST' })).status, 403);
    const { FFmpeg } = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(resources, 'app/native-ffmpeg.js')).toString('base64'));
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        value: '', checked: false, disabled: false, hidden: false, dataset: {}, style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, removeAttribute() {}, append() {}, appendChild() {}, prepend() {}, addEventListener() {},
        showModal() {}, close() {}, querySelector() { return element('child'); }, querySelectorAll() { return []; }
      });
      return elements.get(id);
    };
    const document = {
      currentScript: { src: new URL('app.js', base).href }, querySelector: s => element(s.slice(1)),
      querySelectorAll: () => [], createElement: () => element(randomUUID()),
      documentElement: { dataset: { appVersion: '2.3.0' } }, body: { append() {} }
    };
    const location = { href: base, protocol: 'http:', hostname: '127.0.0.1' };
    const context = vm.createContext({ document, location, window: { FLOW2SHORT_DESKTOP: true, NativeFFmpeg: FFmpeg },
      URL, File, Blob, TextEncoder, TextDecoder, Uint8Array, DOMException, fetch: global.fetch, console,
      setTimeout, clearTimeout, navigator: {}, localStorage: { setItem() {}, getItem() { return null; } },
      addEventListener() {}, requestAnimationFrame() {}, cancelAnimationFrame() {}
    });
    let source = fs.readFileSync(path.join(resources, 'app/app.js'), 'utf8').replace(/\nstartApp\(\);\s*$/, '');
    source = source.replace(/const \{ FFmpeg \} = await import\([^\n]+\);/, 'const FFmpeg = window.NativeFFmpeg;');
    vm.runInContext(source, context);
    element('resolution').value = '720'; element('quality').value = 'fast'; element('fitMode').value = 'contain';
    element('burnCaptions').checked = true; element('outputName').value = 'Native-Render-Test';
    context.clipOne = new File([fs.readFileSync(path.join(fixtures, 'clip-one.mp4'))], 'clip-one.mp4', { type: 'video/mp4' });
    context.clipTwo = new File([fs.readFileSync(path.join(fixtures, 'clip-two-silent.mp4'))], 'clip-two.mp4', { type: 'video/mp4' });
    vm.runInContext(`
      state.clips = [
        {id:'a',name:'one',file:clipOne,start:.25,end:1.5,duration:2,volume:60,transition:'fade',transitionDuration:.3},
        {id:'b',name:'two',file:clipTwo,start:0,end:1.75,duration:2,volume:100,transition:'none'}
      ];
      state.caption = {name:'test.srt',cues:[{start:.1,end:.8,text:'Hello'},{start:.8,end:1.4,text:'native'},{start:1.4,end:2.9,text:'Mac!'}]};
      state.caption.displayCues = state.caption.cues;
    `, context);
    await vm.runInContext('renderVideo()', context);
    const outputURL = vm.runInContext('state.outputUrl', context);
    assert.ok(outputURL, 'Real editor render failed: ' + element('renderMessage').textContent);
    const bytes = Buffer.from(await (await originalFetch(outputURL)).arrayBuffer());
    const outputPath = path.join(fixtures, 'native-render-test.mp4'); fs.writeFileSync(outputPath, bytes);
    const probe = JSON.parse(execFileSync(executable('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath]));
    const video = probe.streams.find(s => s.codec_type === 'video');
    assert.equal(video.width, 720); assert.equal(video.height, 1280);
    assert.equal(video.codec_name, 'h264'); assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
    assert.ok(Math.abs(Number(probe.format.duration) - 3) < .1, 'Unexpected output duration');
    assert.equal((await global.fetch('/__native/file?name=input-0.mp4')).status, 404, 'Input temporary file leaked');
    assert.equal((await global.fetch('/__native/file?name=final.mp4')).status, 404, 'Output temporary file leaked');
    console.log('Real editor render: 720×1280 H.264/AAC, two trimmed clips (one silent), fade transition, burned ASS captions, duration 3 seconds; media cleanup passed.');

    const engine = new FFmpeg(); await engine.load();
    await engine.writeFile('input-0.mp4', new Uint8Array(await context.clipOne.arrayBuffer()));
    const pending = engine.exec(['-stream_loop', '-1', '-i', 'input-0.mp4', '-t', '3600', '-c:v', 'libx264', '-preset', 'slow', 'cancelled.mp4']);
    setTimeout(() => engine.terminate(), 250);
    await assert.rejects(pending, error => error.name === 'AbortError');
    await engine.pendingStop;
    assert.equal((await global.fetch('/__native/file?name=input-0.mp4')).status, 404);
    const next = new FFmpeg(); await next.load();
    await next.writeFile('input-0.mp4', new Uint8Array(await context.clipOne.arrayBuffer()));
    assert.equal(await next.exec(['-i', 'input-0.mp4', '-t', '0.3', '-c', 'copy', 'retry.mp4']), 0);
    console.log('Native cancellation, cleanup, and subsequent render passed.');
    URL.revokeObjectURL(outputURL);
  } finally {
    global.fetch = originalFetch;
    service.stdin.end();
    await new Promise(resolve => service.once('exit', resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
