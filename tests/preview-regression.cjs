const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8").replace(/\nstartApp\(\);\s*$/, "");

function makeElement() {
  return {
    style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {} },
    setAttribute() {}, pause() {}, load() {}, play() { return Promise.resolve(); },
    value: 0, min: 0, max: 100, readyState: 1, currentTime: 0, src: "", textContent: "",
  };
}

function testContext(oldShell) {
  const elements = new Map();
  const element = (id) => {
    if (oldShell && ["mixTransitionFreeze", "mixPreviewOverlays"].includes(id)) return null;
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const video = element("mixPreviewVideo");
  let plays = 0;
  video.play = () => { plays += 1; return Promise.resolve(); };
  element("burnCaptions").checked = false;
  element("musicVolume").value = 18;
  element("narrationVolume").value = 100;
  const location = { href: "http://127.0.0.1:43121/", protocol: "http:", hostname: "127.0.0.1" };
  const document = {
    currentScript: { src: `${location.href}app.js` },
    documentElement: { dataset: { appVersion: oldShell ? undefined : "1.9" } },
    querySelector(selector) { return element(selector.slice(1)); },
    querySelectorAll() { return []; },
    body: { innerHTML: "" },
  };
  const context = vm.createContext({ document, window: {}, location, URL, console,
    requestAnimationFrame: () => 13, cancelAnimationFrame() {},
  });
  vm.runInContext(source, context);
  return { context, video, document, get plays() { return plays; } };
}

async function checkPlayback(oldShell) {
  const harness = testContext(oldShell);
  vm.runInContext(`state.preview.segments = [{ index: 0, start: 0, end: 5, clip: {
    id: "clip-1", name: "clip.mp4", url: "blob:clip", start: 0, end: 5,
    volume: 100, transition: "none"
  }}]; state.preview.total = 5; state.preview.index = 0;
  refs.mixPreviewVideo.src = "blob:clip";`, harness.context);
  await vm.runInContext("playMixPreview()", harness.context);
  assert.equal(harness.plays, 1, "click must play the video");
  assert.equal(vm.runInContext("state.preview.playing", harness.context), true);
  harness.video.currentTime = 1;
  vm.runInContext("runMixPreviewFrame()", harness.context);
  assert.equal(vm.runInContext("state.preview.globalTime", harness.context), 1);
}

async function main() {
  await checkPlayback(true);  // 1.6 HTML with newer preview JavaScript
  await checkPlayback(false); // matching 1.9 HTML and JavaScript
  const stale = testContext(true);
  let replacement = "";
  stale.context.fetch = async () => ({ ok: true, text: async () => '<html data-app-version="1.9">' });
  stale.context.location.replace = (url) => { replacement = url; };
  await vm.runInContext("startApp()", stale.context);
  assert.match(replacement, /flow2short-ui=1\.9-/, "old shell must reload fresh markup");
  console.log("Preview play and time progression pass for old and current markup.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
