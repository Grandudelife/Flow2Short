const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8").replace(/\nstartApp\(\);\s*$/, "");

function makeElement() {
  const element = {
    style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    pause() {}, load() {}, play() { return Promise.resolve(); },
    value: "", min: 0, max: 100, readyState: 1, currentTime: 0, src: "", textContent: "",
  };
  element.parentElement = element;
  element.querySelector = () => makeElement();
  element.querySelectorAll = () => [];
  return element;
}

function testContext(oldShell) {
  const elements = new Map();
  const element = (id) => {
    if (oldShell && ["mixTransitionFreeze", "mixPreviewOverlays"].includes(id)) return null;
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const video = element("mixPreviewVideo");
  element("thumbnailCanvas").getContext = () => ({
    clearRect() {}, fillRect() {}, drawImage() {}, strokeText() {}, fillText() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  let plays = 0;
  video.play = () => { plays += 1; return Promise.resolve(); };
  element("burnCaptions").checked = false;
  element("musicVolume").value = 18;
  element("narrationVolume").value = 100;
  const location = { href: "http://127.0.0.1:43121/", protocol: "http:", hostname: "127.0.0.1" };
  const document = {
    currentScript: { src: `${location.href}app.js` },
    documentElement: { dataset: { appVersion: oldShell ? undefined : "2.3.0" } },
    querySelector(selector) { return element(selector.slice(1)); },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: { innerHTML: "" },
  };
  const context = vm.createContext({ document, window: {}, location, URL, File, Blob, console,
    setTimeout: () => 1, clearTimeout() {},
    navigator: { userAgent: "Test", platform: "Test", maxTouchPoints: 0 },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    IntersectionObserver: class { observe() {} },
    addEventListener() {},
    requestAnimationFrame: () => 13, cancelAnimationFrame() {},
  });
  vm.runInContext(source, context);
  return { context, video, document, element, get plays() { return plays; } };
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
  const fresh = testContext(false);
  vm.runInContext("init()", fresh.context);
  vm.runInContext(`state.overlays = [{kind:"image",text:"",name:"a.png",sizeBytes:10,start:0,end:3,position:"top",size:35,radius:16,x:.62,y:.3}]; state.thumbnail.title="Hello startup";`, fresh.context);
  const recipe = vm.runInContext("getRecipe()", fresh.context);
  assert.equal(recipe.project.overlays[0].radius, 16);
  assert.equal(recipe.project.overlays[0].x, 0.62);
  assert.equal(recipe.project.overlays[0].y, 0.3);
  assert.equal(recipe.project.thumbnail.title, "Hello startup");
  vm.runInContext("Object.assign(state.thumbnail,{ratio:'wide',fit:'contain',zoom:145,panX:.35,subtitle:'Three key lessons',textStyle:'box'});", fresh.context);
  const thumbnailRecipe = vm.runInContext("getRecipe().project.thumbnail", fresh.context);
  assert.equal(thumbnailRecipe.ratio, "wide");
  assert.equal(thumbnailRecipe.zoom, 145);
  assert.equal(thumbnailRecipe.subtitle, "Three key lessons");
  vm.runInContext("restoreThumbnail({ratio:'wide',fit:'contain',zoom:145,panX:.35,subtitle:'Three key lessons',textStyle:'box'})", fresh.context);
  assert.equal(vm.runInContext("state.thumbnail.panX", fresh.context), 0.35);
  const logoCalls = { positions: [], radii: [] };
  fresh.element("thumbnailCanvas").getContext = () => ({
    clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, clip() {},
    roundRect(...args) { logoCalls.radii.push(args[4]); },
    drawImage(_image, x, y) { logoCalls.positions.push([x, y]); },
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  vm.runInContext("Object.assign(state.thumbnail,{title:'',logoSource:'watermark',logoX:.28,logoY:.6,logoRadius:12}); state.logo={bitmap:{width:1000,height:500}}; drawThumbnail()", fresh.context);
  assert.equal(logoCalls.positions.length, 1);
  assert.ok(logoCalls.positions[0][0] > 0 && logoCalls.positions[0][1] > 0, "logo uses manual position");
  assert.ok(logoCalls.radii[0] > 0, "logo rounding is applied to the exported canvas");
  assert.equal(JSON.stringify(recipe).includes("api-key"), false);
  fresh.element("transcribeSource").value = "narration";
  fresh.context.fetch = async () => ({ ok: true, json: async () => ({ cues: [{ start: 0.12, end: 0.4, text: "Hello" }] }) });
  vm.runInContext('state.narration = {file: new File(["sound"], "voice.mp3", {type:"audio/mpeg"})}; state.captionStyle.offsetMs=130;', fresh.context);
  await vm.runInContext("generateCaptionsFromAudio()", fresh.context);
  assert.equal(vm.runInContext("state.caption.cues[0].start", fresh.context), 0.12);
  assert.equal(vm.runInContext("state.captionStyle.offsetMs", fresh.context), 0);
  const standard = vm.runInContext("buildStandardCaptionEvents([{start:0.1,end:0.3,text:'Hello'},{start:0.4,end:0.8,text:'world.'}])", fresh.context);
  assert.equal(standard[0].text, "Hello world.");
  assert.equal(vm.runInContext("buildCaptionEvents([{start:0.1,end:0.3,text:'Hello'},{start:0.4,end:0.8,text:'world.'}], 'standard', true)[0].text", fresh.context), "Hello world.");
  fresh.context.fetch = async () => ({ ok: true, json: async () => ({ cues: [] }) });
  await vm.runInContext("generateCaptionsFromAudio()", fresh.context);
  assert.equal(vm.runInContext("state.caption.cues[0].text", fresh.context), "Hello", "a failed transcription preserves prior subtitles");
  const independentAudio = new File(["voice"], "outside.mp3", { type: "audio/mpeg" });
  fresh.element("transcribeSource").value = "file";
  fresh.element("transcribeFile").files = [independentAudio];
  vm.runInContext("state.narration = null", fresh.context);
  let submittedAudio;
  fresh.context.fetch = async (_url, options) => {
    submittedAudio = options.body;
    return { ok: true, json: async () => ({ cues: [{ start: 0, end: 0.5, text: "Independent" }] }) };
  };
  await vm.runInContext("generateCaptionsFromAudio()", fresh.context);
  assert.equal(submittedAudio, independentAudio, "a separate audio file must work without project narration");
  assert.equal(vm.runInContext("state.caption.cues[0].text", fresh.context), "Independent");
  fresh.element("ttsScript").value = "Hello world.";
  fresh.element("ttsVoice").value = "Kore";
  fresh.element("ttsModel").value = "gemini-3.8-flash-tts";
  fresh.element("ttsTone").value = "warm";
  fresh.element("ttsPace").value = "speaking slowly";
  fresh.element("ttsWithCaptions").checked = false;
  let speechRequest;
  fresh.context.fetch = async (_url, options) => {
    speechRequest = JSON.parse(options.body);
    return { ok: true, headers: { get: () => "audio/wav" }, blob: async () => new Blob([Buffer.alloc(44)], { type: "audio/wav" }) };
  };
  vm.runInContext("setAudio = async (kind, file) => { state[kind] = {file, url:'blob:generated'}; }", fresh.context);
  await vm.runInContext("generateNarration()", fresh.context);
  assert.equal(speechRequest.voice, "Kore");
  assert.match(speechRequest.style, /speaking slowly/);
  assert.equal(vm.runInContext("state.narration.file.name.endsWith('.wav')", fresh.context), true);
  assert.equal(fresh.element("ttsPlayer").hidden, false);
  fresh.element("ttsWithCaptions").checked = true;
  vm.runInContext("generateCaptionsFromAudio = () => new Promise(() => {})", fresh.context);
  await vm.runInContext("generateNarration()", fresh.context);
  assert.equal(fresh.element("ttsGenerate").disabled, false, "voice stays usable while accurate captions finish separately");
  await checkPlayback(true);  // 1.6 HTML with newer preview JavaScript
  await checkPlayback(false); // matching current HTML and JavaScript
  const stale = testContext(true);
  let replacement = "";
  stale.context.fetch = async () => ({ ok: true, text: async () => '<html data-app-version="2.3.0">' });
  stale.context.location.replace = (url) => { replacement = url; };
  await vm.runInContext("startApp()", stale.context);
  assert.match(replacement, /flow2short-ui=2\.3\.0-/, "old shell must reload fresh markup");
  console.log("Preview play and time progression pass for old and current markup.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
