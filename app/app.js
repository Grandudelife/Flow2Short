const APP_BASE_URL = new URL("./", document.currentScript?.src || location.href);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  clips: [],
  narration: null,
  music: null,
  caption: null,
  logo: null,
  logoStyle: { position: "top-right", sizePercent: 18 },
  overlays: [],
  audioMix: { duck: true, duckPercent: 30, fades: true },
  thumbnail: { background: null, logo: null, imageName: "", logoName: "", frameClip: "", frameTime: 0,
    title: "", titleSize: 78, titleColor: "#ffffff", titlePosition: "bottom", shade: 35,
    logoSource: "none", logoPosition: "top-right", logoSize: 18,
    ratio: "short", backgroundColor: "#122c3c", fit: "cover", zoom: 100, panX: 0, panY: 0,
    subtitle: "", textStyle: "outline", textAlign: "center", logoRadius: 0, logoX: 0.90, logoY: 0.08 },
  remembered: { narration: null, music: null, caption: null, logo: null },
  captionStyle: {
    preset: "impact",
    fontSize: 58,
    position: "bottom",
    color: "#ffdc42",
    offsetMs: 0,
    groupSize: 3,
  },
  ffmpeg: null,
  ffmpegLoaded: false,
  rendering: false,
  cancelled: false,
  outputUrl: null,
  deferredInstallPrompt: null,
  preview: {
    segments: [],
    total: 0,
    index: -1,
    globalTime: 0,
    playing: false,
    frame: 0,
    loadToken: 0,
    audioContext: null,
    audioConnected: false,
    gains: null,
    freezeCache: new Map(),
    freezePending: new Map(),
    overlaysKey: "",
  },
  settings: {
    autosave: true,
    leaveWarning: true,
  },
};

const refs = {
  projectTitle: $("#projectTitle"),
  clipInput: $("#clipInput"),
  dropZone: $("#dropZone"),
  clipList: $("#clipList"),
  emptyClips: $("#emptyClips"),
  previewStrip: $("#previewStrip"),
  clipPreview: $("#clipPreview"),
  previewName: $("#previewName"),
  previewMeta: $("#previewMeta"),
  narrationInput: $("#narrationInput"),
  musicInput: $("#musicInput"),
  captionInput: $("#captionInput"),
  logoInput: $("#logoInput"),
  previewLogoInput: $("#previewLogoInput"),
  logoPosition: $("#logoPosition"),
  logoSize: $("#logoSize"),
  previewLogoPosition: $("#previewLogoPosition"),
  previewLogoSize: $("#previewLogoSize"),
  logoStageVideo: $("#logoStageVideo"),
  logoStageMark: $("#logoStageMark"),
  mixPreviewLogo: $("#mixPreviewLogo"),
  captionGroupSize: $("#captionGroupSize"),
  captionOffsetMs: $("#captionOffsetMs"),
  previewCaptionOffsetMs: $("#previewCaptionOffsetMs"),
  previewCaptionGroupSize: $("#previewCaptionGroupSize"),
  previewCaptionStatus: $("#previewCaptionStatus"),
  captionSyncStatus: $("#captionSyncStatus"),
  captionStylePreview: $("#captionStylePreview"),
  captionFontSize: $("#captionFontSize"),
  captionPosition: $("#captionPosition"),
  captionColor: $("#captionColor"),
  mixPreviewButton: $("#mixPreviewButton"),
  mixPreviewDialog: $("#mixPreviewDialog"),
  mixPreviewVideo: $("#mixPreviewVideo"),
  mixTransitionFreeze: $("#mixTransitionFreeze"),
  mixPreviewNarration: $("#mixPreviewNarration"),
  mixPreviewMusic: $("#mixPreviewMusic"),
  mixPreviewCaption: $("#mixPreviewCaption"),
  mixPreviewStage: $("#mixPreviewStage"),
  mixPreviewPlay: $("#mixPreviewPlay"),
  mixPreviewSeek: $("#mixPreviewSeek"),
  mixPreviewCurrent: $("#mixPreviewCurrent"),
  mixPreviewTotal: $("#mixPreviewTotal"),
  mixPreviewClipName: $("#mixPreviewClipName"),
  renderButton: $("#renderButton"),
  totalDuration: $("#totalDuration"),
  clipCount: $("#clipCount"),
  outputSummary: $("#outputSummary"),
  outputName: $("#outputName"),
  resolution: $("#resolution"),
  fitMode: $("#fitMode"),
  quality: $("#quality"),
  renderDialog: $("#renderDialog"),
  renderTitle: $("#renderTitle"),
  renderMessage: $("#renderMessage"),
  renderProgressBar: $("#renderProgressBar"),
  renderProgressRing: $("#renderProgressRing"),
  renderPercent: $("#renderPercent"),
  renderLog: $("#renderLog"),
  cancelRenderButton: $("#cancelRenderButton"),
  downloadButton: $("#downloadButton"),
  closeRenderButton: $("#closeRenderButton"),
  toast: $("#toast"),
};

const toFaDigits = (value) => String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);

const TRANSITIONS = {
  none: { label: "بدون ترنزیشن", ffmpeg: null },
  fade: { label: "محو نرم", ffmpeg: "fade" },
  zoom: { label: "زوم", ffmpeg: "zoomin" },
  slide: { label: "حرکت به چپ", ffmpeg: "slideleft" },
  wipe: { label: "پاک‌شدن به راست", ffmpeg: "wiperight" },
  black: { label: "محو به سیاه", ffmpeg: "fadeblack" },
};
const TRANSITION_DURATIONS = [0.3, 0.4, 0.6];

function selectedTransition(clip, nextClip) {
  if (!nextClip || !clip || !TRANSITIONS[clip.transition]?.ffmpeg) return null;
  const duration = TRANSITION_DURATIONS.includes(Number(clip.transitionSeconds)) ? Number(clip.transitionSeconds) : 0.4;
  if (clipDuration(nextClip) < duration + 0.08) throw new Error(`کلیپ «${nextClip.name}» برای ترنزیشن ${toFaDigits(duration)} ثانیه‌ای کوتاه است.`);
  return { type: clip.transition, duration };
}

const CAPTION_PRESETS = {
  impact: { name: "بولد پاپ", color: "#ffdc42", outline: 5, shadow: 1, bold: true, borderStyle: 1 },
  clean: { name: "تمیز", color: "#ffffff", outline: 2.5, shadow: 1, bold: true, borderStyle: 1 },
  boxed: { name: "باکس", color: "#ffffff", outline: 0, shadow: 0, bold: true, borderStyle: 3, background: "#10213c" },
  mint: { name: "مینت", color: "#35d3a0", textColor: "#10213c", outline: 0, shadow: 0, bold: true, borderStyle: 3, background: "#35d3a0" },
  neon: { name: "نئون", color: "#ffffff", outline: 3, shadow: 2, bold: true, borderStyle: 1, outlineColor: "#12a875" },
  minimal: { name: "مینیمال", color: "#ffffff", outline: 1, shadow: 0, bold: false, borderStyle: 1 },
};

function formatTime(seconds, persian = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  const text = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return persian ? toFaDigits(text) : text;
}

function formatDecimal(seconds) {
  return Number(seconds || 0).toFixed(2);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "۰ مگابایت";
  const mb = bytes / (1024 * 1024);
  return `${toFaDigits(mb < 10 ? mb.toFixed(1) : Math.round(mb))} مگابایت`;
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function safeFileName(value) {
  return String(value || "YouTube-Short-Final")
    .replace(/\.mp4$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim() || "YouTube-Short-Final";
}

function parseSrtTime(value) {
  const match = String(value).trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function parseSrt(text) {
  return String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return null;
      const [startText, endText] = lines[timingIndex].split("-->");
      const start = parseSrtTime(startText);
      const end = parseSrtTime(endText);
      const cueText = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]+>/g, "").trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !cueText) return null;
      return { start, end, text: cueText };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function buildCaptionEvents(cues, groupSize, wordByWord) {
  if (wordByWord && groupSize === "standard") {
    return buildStandardCaptionEvents(cues);
  }
  if (!wordByWord || groupSize === 1) {
    return cues.map((cue, index) => ({ ...cue, previousText: "", word: cue.text, groupId: index }));
  }

  const events = [];
  let words = [];
  let groupId = 0;
  for (const cue of cues) {
    const previous = events.at(-1);
    const newGroup = words.length === 0 || words.length >= groupSize ||
      /[.!?؟。！？;؛:,،]$/u.test(previous.word) || cue.start - previous.end > 0.55;
    if (newGroup) {
      words = [];
      if (previous) groupId += 1;
      if (previous && previous.end > cue.start) previous.end = cue.start;
    } else {
      // Keep the words already shown visible until the next word arrives.
      previous.end = cue.start;
    }
    const previousText = words.join(" ");
    words.push(cue.text);
    events.push({ start: cue.start, end: cue.end, text: words.join(" "), previousText, word: cue.text, groupId });
  }
  return events.filter((cue) => cue.end > cue.start);
}

function buildStandardCaptionEvents(cues) {
  const events = [];
  let group = [];
  const finish = () => {
    if (!group.length) return;
    const first = group[0], last = group.at(-1);
    events.push({ start: first.start, end: last.end, text: group.map((item) => item.text).join(" "),
      previousText: "", word: last.text, groupId: events.length });
    group = [];
  };
  for (const cue of cues) {
    if (group.length && cue.start - group.at(-1).end > 0.65) finish();
    group.push(cue);
    if (group.length >= 9 || cue.end - group[0].start >= 4 || /[.!?؟。！？]$/u.test(cue.text)) finish();
  }
  finish();
  return events;
}

function refreshCaptionDisplay() {
  $$('[data-download-caption]').forEach((button) => { button.disabled = !state.caption?.cues?.length; });
  if (!state.caption) return;
  state.caption.wordByWord = state.caption.cues.length > 0 && state.caption.cues.every((cue) => !/\s/u.test(cue.text.trim()));
  state.caption.displayCues = buildCaptionEvents(state.caption.cues, state.captionStyle.groupSize, state.caption.wordByWord);
  const mode = state.caption.wordByWord
    ? state.captionStyle.groupSize === "standard" ? "زیرنویس استاندارد" : state.captionStyle.groupSize === 1 ? "نمایش تک‌کلمه‌ای" : `پانچ ${toFaDigits(state.captionStyle.groupSize)} کلمه‌ای`
    : "زیرنویس معمولی";
  $("#captionMeta").textContent = `${toFaDigits(state.caption.cues.length)} ${state.caption.wordByWord ? "کلمه" : "زیرنویس"} · ${mode} · ${formatBytes(state.caption.file.size)}`;
  const firstGroup = state.caption.displayCues.filter((cue) => cue.groupId === state.caption.displayCues[0]?.groupId);
  refs.captionStylePreview.textContent = firstGroup.at(-1)?.text || "YOUR NEXT BIG IDEA";
  refs.captionStylePreview.setAttribute("aria-label", "نمونه عبارت کامل: " + refs.captionStylePreview.textContent);
  refs.previewCaptionGroupSize.value = String(state.captionStyle.groupSize);
  refs.mixPreviewCaption.dataset.cue = "";
  updatePreviewCaption(state.preview.globalTime);
  renderCaptionEditor();
}

function renderCaptionEditor() {
  const list = $("#captionCueList");
  const cues = state.caption?.cues || [];
  $("#captionEditorCount").textContent = cues.length ? `(${toFaDigits(cues.length)})` : "";
  $("#captionEditor").classList.toggle("is-empty", !cues.length);
  list.innerHTML = cues.map((cue, index) => `<div class="caption-cue" data-cue-index="${index}">
    <button type="button" data-cue-action="jump" title="رفتن به این زیرنویس">${toFaDigits(index + 1)} ▶</button>
    <label>شروع <input type="number" data-cue-field="start" min="0" step="0.01" value="${cue.start.toFixed(2)}" dir="ltr" /></label>
    <label>پایان <input type="number" data-cue-field="end" min="0.01" step="0.01" value="${cue.end.toFixed(2)}" dir="ltr" /></label>
    <label class="cue-text">متن <input type="text" data-cue-field="text" value="${escapeHtml(cue.text).replace(/"/g, "&quot;")}" dir="auto" /></label>
    <button type="button" data-cue-action="delete" aria-label="حذف زیرنویس ${toFaDigits(index + 1)}">حذف</button>
  </div>`).join("") || "<p>ابتدا فایل SRT وارد کنید.</p>";
}

function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function downloadEditedSrt(standard = false) {
  if (!state.caption?.cues.length) return showToast("ابتدا زیرنویس را وارد کنید.");
  const shift = state.captionStyle.offsetMs / 1000;
  const source = standard && state.caption.wordByWord ? buildStandardCaptionEvents(state.caption.cues) : state.caption.cues;
  const adjusted = source.map((cue) => ({ ...cue, start: Math.max(0, cue.start + shift), end: cue.end + shift })).filter((cue) => cue.end > cue.start);
  const content = adjusted.map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`).join("\n\n") + "\n";
  downloadBlob(new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" }), `Flow2Short-${standard ? "standard" : "word-by-word"}.srt`);
}

function hexToAssColor(hex, alpha = "00") {
  const value = String(hex || "#ffffff").replace("#", "").padEnd(6, "f").slice(0, 6);
  return `&H${alpha}${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase();
}

function formatAssTime(seconds) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor((total % 360000) / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const centiseconds = total % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function buildAssCaptions(width, height) {
  const preset = CAPTION_PRESETS[state.captionStyle.preset] || CAPTION_PRESETS.clean;
  const alignment = { top: 8, center: 5, bottom: 2 }[state.captionStyle.position] || 2;
  const margin = Math.round(height * (state.captionStyle.position === "bottom" ? 0.24 : 0.08));
  const fontSize = Math.max(28, Math.round(state.captionStyle.fontSize * (width / 1080)));
  const primary = hexToAssColor(preset.textColor || state.captionStyle.color || preset.color);
  const outlineBase = preset.borderStyle === 3
    ? (state.captionStyle.preset === "mint" ? state.captionStyle.color : preset.background)
    : (preset.outlineColor || "#07111f");
  const outlineAlpha = preset.borderStyle === 3 ? "18" : (state.captionStyle.preset === "minimal" ? "80" : "20");
  const outline = hexToAssColor(outlineBase, outlineAlpha);
  const background = hexToAssColor(preset.background || "#07111f", preset.borderStyle === 3 ? "28" : "80");
  const outlineWidth = preset.borderStyle === 3 ? Math.max(7, preset.outline) : preset.outline;
  const isWordByWord = state.caption.wordByWord && state.captionStyle.groupSize !== "standard";
  const events = state.caption.displayCues.map((cue) => {
    const start = Math.max(0, cue.start + state.captionStyle.offsetMs / 1000);
    const end = cue.end + state.captionStyle.offsetMs / 1000;
    if (end <= start) return "";
    const popDuration = Math.min(100, Math.max(0, Math.round((end - start) * 500)));
    const escapeAss = (value) => value
      .replace(/\\/g, "\\\\")
      .replace(/{/g, "\\{")
      .replace(/}/g, "\\}")
      .replace(/\n/g, "\\N");
    const text = isWordByWord
      ? `${cue.previousText ? `${escapeAss(cue.previousText)} ` : ""}{\\fscx84\\fscy84\\t(0,${popDuration},\\fscx100\\fscy100)}${escapeAss(cue.word)}`
      : `{\\fad(120,120)}${escapeAss(cue.text)}`;
    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Flow2Short,,0,0,0,,${text}`;
  }).filter(Boolean).join("\n");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Flow2Short,DejaVu Sans,${fontSize},${primary},${primary},${outline},${background},${preset.bold ? -1 : 0},0,0,0,100,100,0,0,${preset.borderStyle},${outlineWidth},${preset.shadow},${alignment},70,70,${margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let toastTimer;
function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove("is-visible"), 3200);
}

function setRangeVisual(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const progress = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${progress}%`);
}

function applyCaptionStyle() {
  if (!CAPTION_PRESETS[state.captionStyle.preset]) state.captionStyle.preset = "clean";
  state.captionStyle.fontSize = Math.max(36, Math.min(84, Number(state.captionStyle.fontSize) || 58));
  if (!["top", "center", "bottom"].includes(state.captionStyle.position)) state.captionStyle.position = "bottom";
  state.captionStyle.groupSize = state.captionStyle.groupSize === "standard" ? "standard" : [1, 3, 4].includes(Number(state.captionStyle.groupSize)) ? Number(state.captionStyle.groupSize) : 3;
  if (!/^#[0-9a-f]{6}$/i.test(state.captionStyle.color || "")) state.captionStyle.color = CAPTION_PRESETS[state.captionStyle.preset].color;
  const preset = CAPTION_PRESETS[state.captionStyle.preset] || CAPTION_PRESETS.clean;
  const elements = [refs.captionStylePreview, refs.mixPreviewCaption];
  elements.forEach((element) => {
    element.dataset.preset = state.captionStyle.preset;
    element.style.setProperty("--caption-color", state.captionStyle.color || preset.color);
    element.style.setProperty("--caption-font-px", `${Math.round(state.captionStyle.fontSize * 0.34)}px`);
  });
  refs.captionStylePreview.parentElement.dataset.position = state.captionStyle.position;
  refs.mixPreviewStage.dataset.position = state.captionStyle.position;
  refs.captionFontSize.value = state.captionStyle.fontSize;
  refs.captionPosition.value = state.captionStyle.position;
  refs.captionColor.value = state.captionStyle.color || preset.color;
  refs.captionGroupSize.value = String(state.captionStyle.groupSize);
  refs.previewCaptionGroupSize.value = String(state.captionStyle.groupSize);
  $("#captionFontSizeValue").textContent = toFaDigits(state.captionStyle.fontSize);
  $("#captionPresetName").textContent = preset.name;
  $$('[data-caption-preset]').forEach((button) => {
    const selected = button.dataset.captionPreset === state.captionStyle.preset;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  setRangeVisual(refs.captionFontSize);
}

function setCaptionPreset(name) {
  const preset = CAPTION_PRESETS[name];
  if (!preset) return;
  state.captionStyle.preset = name;
  state.captionStyle.color = preset.color;
  applyCaptionStyle();
  saveDraft();
}

const LOGO_POSITIONS = new Set([
  "top-left", "top-center", "top-right", "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

function logoDimensions(frameWidth, frameHeight, imageWidth, imageHeight) {
  const maxWidth = Math.round(frameWidth * state.logoStyle.sizePercent / 100);
  const maxHeight = Math.round(frameHeight * 0.30);
  const ratio = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  return { width: Math.max(1, Math.round(imageWidth * ratio)), height: Math.max(1, Math.round(imageHeight * ratio)) };
}

function logoCoordinates(frameWidth, frameHeight, logoWidth, logoHeight) {
  const position = state.logoStyle.position;
  const marginX = Math.round(frameWidth * 0.05);
  const marginY = Math.round(frameHeight * 0.04);
  return {
    x: position.endsWith("left") ? marginX : position.endsWith("right") ? frameWidth - logoWidth - marginX : Math.round((frameWidth - logoWidth) / 2),
    y: position.startsWith("top") ? marginY : position.startsWith("bottom") ? frameHeight - logoHeight - marginY : Math.round((frameHeight - logoHeight) / 2),
  };
}

function applyLogoStyle() {
  if (!LOGO_POSITIONS.has(state.logoStyle.position)) state.logoStyle.position = "top-right";
  state.logoStyle.sizePercent = Math.max(5, Math.min(35, Number(state.logoStyle.sizePercent) || 18));
  refs.logoPosition.value = state.logoStyle.position;
  refs.previewLogoPosition.value = state.logoStyle.position;
  refs.logoSize.value = state.logoStyle.sizePercent;
  refs.previewLogoSize.value = state.logoStyle.sizePercent;
  $("#logoSizeValue").textContent = `${toFaDigits(state.logoStyle.sizePercent)}٪`;
  $("#previewLogoSizeValue").textContent = `${toFaDigits(state.logoStyle.sizePercent)}٪`;
  setRangeVisual(refs.logoSize);
  setRangeVisual(refs.previewLogoSize);
  const width = state.logo ? `${logoDimensions(1080, 1920, state.logo.width, state.logo.height).width / 1080 * 100}%` : "";
  [refs.logoStageMark, refs.mixPreviewLogo].forEach((element) => {
    element.dataset.position = state.logoStyle.position;
    element.style.width = width;
    element.hidden = !state.logo;
  });
  $("#previewLogoName").textContent = state.logo ? state.logo.file.name : "هنوز لوگویی انتخاب نشده است.";
}

async function setLogo(file) {
  if (!file) return;
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 12 * 1024 * 1024) {
    refs.logoInput.value = "";
    refs.previewLogoInput.value = "";
    return showToast("لوگو باید PNG، JPG یا WebP و حداکثر ۱۲ مگابایت باشد.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error("ابعاد تصویر لوگو بیش از حد بزرگ است.");
    const width = bitmap.width;
    const height = bitmap.height;
    if (state.logo?.url) URL.revokeObjectURL(state.logo.url);
    state.logo?.bitmap?.close();
    state.logo = { file, width, height, bitmap, url: URL.createObjectURL(file) };
    bitmap = null;
    state.remembered.logo = { name: file.name, size: file.size };
    refs.mixPreviewLogo.src = state.logo.url;
    refs.logoStageMark.src = state.logo.url;
    $("#logoName").textContent = file.name;
    $("#logoMeta").textContent = `${toFaDigits(width)} × ${toFaDigits(height)} · ${formatBytes(file.size)}`;
    $("#removeLogo").hidden = false;
    applyLogoStyle();
    drawThumbnail();
    saveDraft();
  } catch (error) {
    refs.logoInput.value = "";
    refs.previewLogoInput.value = "";
    showToast(error.message || "تصویر لوگو خوانده نشد.");
  } finally {
    refs.logoInput.value = "";
    refs.previewLogoInput.value = "";
    bitmap?.close();
  }
}

function removeLogo(persist = true) {
  if (state.logo?.url) URL.revokeObjectURL(state.logo.url);
  state.logo?.bitmap?.close();
  state.logo = null;
  state.remembered.logo = null;
  refs.logoInput.value = "";
  refs.previewLogoInput.value = "";
  refs.mixPreviewLogo.removeAttribute("src");
  refs.logoStageMark.removeAttribute("src");
  $("#logoName").textContent = "فایلی انتخاب نشده";
  $("#logoMeta").textContent = "PNG، JPG یا WebP";
  $("#removeLogo").hidden = true;
  applyLogoStyle();
  drawThumbnail();
  if (persist) saveDraft();
}

async function logoPngBytes(frameWidth, frameHeight) {
  const bitmap = await createImageBitmap(state.logo.file);
  try {
    const { width, height } = logoDimensions(frameWidth, frameHeight, bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((image) => image ? resolve(image) : reject(new Error("آماده‌سازی لوگو ممکن نشد.")), "image/png"));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

function thumbnailControls() {
  const item = state.thumbnail;
  const get = (name) => $(`#thumbnail${name}`);
  item.title = get("Title").value.trim();
  item.titleSize = Number(get("TitleSize").value);
  item.titleColor = get("TitleColor").value;
  item.titlePosition = get("TitlePosition").value;
  item.shade = Number(get("Shade").value);
  item.logoSource = get("LogoSource").value;
  item.logoPosition = get("LogoPosition").value;
  item.logoSize = Number(get("LogoSize").value);
  item.logoRadius = Number(get("LogoRadius").value);
  item.logoX = Number(get("LogoX").value) / 100;
  item.logoY = Number(get("LogoY").value) / 100;
  item.ratio = get("Ratio").value;
  item.backgroundColor = get("BackgroundColor").value;
  item.fit = get("Fit").value;
  item.zoom = Number(get("Zoom").value);
  item.subtitle = get("Subtitle").value.trim();
  item.textStyle = get("TextStyle").value;
  item.textAlign = get("TextAlign").value;
  const canvas = $("#thumbnailCanvas");
  const [width, height] = { short: [1080, 1920], wide: [1920, 1080], square: [1080, 1080] }[item.ratio] || [1080, 1920];
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  [["TitleSize", item.titleSize], ["Shade", `${toFaDigits(item.shade)}٪`], ["LogoSize", `${toFaDigits(item.logoSize)}٪`], ["Zoom", `${toFaDigits(item.zoom)}٪`],
    ["LogoRadius", item.logoRadius ? `${toFaDigits(item.logoRadius)}٪` : "۰٪ · بدون گردی"],
    ["LogoX", `${toFaDigits(Math.round(item.logoX * 100))}٪`], ["LogoY", `${toFaDigits(Math.round(item.logoY * 100))}٪`]]
    .forEach(([name, value]) => { get(`${name}Value`).textContent = toFaDigits(value); });
  ["TitleSize", "Shade", "LogoSize", "Zoom", "LogoRadius", "LogoX", "LogoY"].forEach((name) => setRangeVisual(get(name)));
  get("LogoWrap").hidden = item.logoSource !== "file";
  drawThumbnail();
}

function restoreThumbnail(recipe = {}) {
  const item = state.thumbnail;
  item.background?.close();
  item.logo?.close();
  Object.assign(item, { background: null, logo: null, imageName: recipe.imageName || "", logoName: recipe.logoName || "",
    frameClip: recipe.frameClip || "", frameTime: Number(recipe.frameTime) || 0,
    title: String(recipe.title || "").slice(0, 95), titleSize: Math.max(42, Math.min(120, Number(recipe.titleSize) || 78)),
    titleColor: /^#[0-9a-f]{6}$/i.test(recipe.titleColor || "") ? recipe.titleColor : "#ffffff",
    titlePosition: ["top", "center", "bottom"].includes(recipe.titlePosition) ? recipe.titlePosition : "bottom",
    shade: Number.isFinite(Number(recipe.shade)) ? Math.max(0, Math.min(75, Number(recipe.shade))) : 35,
    logoSource: ["none", "watermark", "file"].includes(recipe.logoSource) ? recipe.logoSource : "none",
    logoPosition: ["top-right", "top-left", "bottom-right", "bottom-left", "custom"].includes(recipe.logoPosition) ? recipe.logoPosition : "top-right",
    logoSize: Math.max(8, Math.min(35, Number(recipe.logoSize) || 18)),
    logoRadius: Math.max(0, Math.min(20, Number(recipe.logoRadius) || 0)),
    logoX: Math.max(.05, Math.min(.95, Number(recipe.logoX ?? (recipe.logoPosition?.endsWith("left") ? .10 : .90)))),
    logoY: Math.max(.05, Math.min(.95, Number(recipe.logoY ?? (recipe.logoPosition?.startsWith("bottom") ? .92 : .08)))),
    ratio: ["short", "wide", "square"].includes(recipe.ratio) ? recipe.ratio : "short",
    backgroundColor: /^#[0-9a-f]{6}$/i.test(recipe.backgroundColor || "") ? recipe.backgroundColor : "#122c3c",
    fit: recipe.fit === "contain" ? "contain" : "cover",
    zoom: Math.max(100, Math.min(200, Number(recipe.zoom) || 100)),
    panX: Math.max(-1, Math.min(1, Number(recipe.panX) || 0)), panY: Math.max(-1, Math.min(1, Number(recipe.panY) || 0)),
    subtitle: String(recipe.subtitle || "").slice(0, 65),
    textStyle: ["outline", "box", "plain"].includes(recipe.textStyle) ? recipe.textStyle : "outline",
    textAlign: ["center", "right", "left"].includes(recipe.textAlign) ? recipe.textAlign : "center",
  });
  for (const [name, value] of [["Title", item.title], ["TitleSize", item.titleSize], ["TitleColor", item.titleColor],
    ["TitlePosition", item.titlePosition], ["Shade", item.shade], ["LogoSource", item.logoSource],
    ["LogoPosition", item.logoPosition], ["LogoSize", item.logoSize], ["LogoRadius", item.logoRadius],
    ["LogoX", Math.round(item.logoX * 100)], ["LogoY", Math.round(item.logoY * 100)], ["Time", item.frameTime],
    ["Ratio", item.ratio], ["BackgroundColor", item.backgroundColor], ["Fit", item.fit], ["Zoom", item.zoom],
    ["Subtitle", item.subtitle], ["TextStyle", item.textStyle], ["TextAlign", item.textAlign]]) {
    $(`#thumbnail${name}`).value = value;
  }
  $("#thumbnailImage").value = "";
  $("#thumbnailLogoInput").value = "";
  thumbnailControls();
  if (item.imageName || item.frameClip || (item.logoName && item.logoSource === "file")) {
    $("#thumbnailHint").textContent = "پس از بازکردن پروژه، عکس و لوگوی جداگانه را دوباره انتخاب کنید یا فریم کلیپ را دوباره بگیرید.";
  }
}

function updateThumbnailClipOptions() {
  const select = $("#thumbnailClip");
  const selected = select.value;
  select.innerHTML = state.clips.length
    ? state.clips.map((clip, index) => `<option value="${clip.id}">${toFaDigits(index + 1)} · ${escapeHtml(clip.name)}</option>`).join("")
    : '<option value="">ابتدا کلیپ اضافه کنید</option>';
  select.value = state.clips.some((clip) => clip.id === selected) ? selected : state.clips[0]?.id || "";
}

async function chooseThumbnailBitmap(file, kind) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) return showToast("PNG، JPG یا WebP حداکثر ۲۰ مگابایت انتخاب کنید.");
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 24_000_000) {
      bitmap.close();
      return showToast("ابعاد عکس بیش از حد بزرگ است؛ حداکثر ۲۴ مگاپیکسل.");
    }
    state.thumbnail[kind]?.close();
    state.thumbnail[kind] = bitmap;
    if (kind === "background") {
      state.thumbnail.panX = 0; state.thumbnail.panY = 0;
      state.thumbnail.imageName = file.name;
      $("#thumbnailHint").textContent = `عکس کاور: ${file.name}`;
    } else state.thumbnail.logoName = file.name;
    drawThumbnail();
    saveDraft();
  } catch { showToast("این تصویر قابل خواندن نیست."); }
}

async function captureThumbnailFrame() {
  const clip = state.clips.find((item) => item.id === $("#thumbnailClip").value);
  if (!clip) return showToast("ابتدا یک کلیپ وارد کنید.");
  const button = $("#thumbnailCapture");
  const video = $("#thumbnailFrameVideo");
  button.disabled = true;
  try {
    const offset = Math.max(0, Math.min(Number($("#thumbnailTime").value) || 0, clipDuration(clip) - 0.05));
    video.src = clip.url;
    video.load();
    await waitForMetadata(video);
    const target = Math.max(0.03, Math.min(clip.end - 0.02, clip.start + offset + 0.03));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("خواندن فریم زمان زیادی برد.")), 12000);
      const finish = () => { clearTimeout(timer); resolve(); };
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = target;
      if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) finish();
    });
    const bitmap = await createImageBitmap(video);
    state.thumbnail.background?.close();
    state.thumbnail.background = bitmap;
    state.thumbnail.panX = 0; state.thumbnail.panY = 0;
    state.thumbnail.imageName = "";
    state.thumbnail.frameClip = clip.name;
    state.thumbnail.frameTime = offset;
    $("#thumbnailImage").value = "";
    $("#thumbnailHint").textContent = `فریم ${clip.name} در ثانیهٔ ${formatDecimal(offset)} انتخاب شد.`;
    drawThumbnail();
    saveDraft();
  } catch (error) { showToast(error.message || "گرفتن فریم ممکن نشد."); }
  finally { video.removeAttribute("src"); video.load(); button.disabled = false; }
}

function thumbnailCover(ctx, image, width, height, item) {
  const scale = (item.fit === "contain" ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height)) * item.zoom / 100;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2 + item.panX * Math.abs(width - drawWidth) / 2;
  const y = (height - drawHeight) / 2 + item.panY * Math.abs(height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function thumbnailLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 5);
}

function drawThumbnail() {
  const canvas = $("#thumbnailCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const item = state.thumbnail;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = item.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  if (item.background) thumbnailCover(ctx, item.background, width, height, item);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  const alpha = item.shade / 100;
  gradient.addColorStop(0, `rgba(5,18,28,${(alpha * 0.35).toFixed(2)})`);
  gradient.addColorStop(0.55, `rgba(5,18,28,${(alpha * 0.4).toFixed(2)})`);
  gradient.addColorStop(1, `rgba(5,18,28,${alpha.toFixed(2)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (item.title) {
    ctx.font = `700 ${item.titleSize}px Vazirmatn, sans-serif`;
    ctx.direction = /[\u0600-\u06ff]/.test(item.title) ? "rtl" : "ltr";
    ctx.textAlign = item.textAlign;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(5, item.titleSize * 0.11);
    ctx.strokeStyle = "rgba(5,18,28,.85)";
    ctx.fillStyle = item.titleColor;
    const lines = thumbnailLines(ctx, item.title, width * 0.82);
    const lineHeight = item.titleSize * 1.3;
    const center = item.titlePosition === "top" ? height * 0.23 : item.titlePosition === "center" ? height * 0.5 : height * 0.73;
    const textX = item.textAlign === "right" ? width * 0.91 : item.textAlign === "left" ? width * 0.09 : width / 2;
    if (item.textStyle === "box") {
      ctx.fillStyle = "rgba(5,18,28,.82)";
      const pad = item.titleSize * .6;
      const boxHeight = lines.length * lineHeight + pad * 2 + (item.subtitle ? item.titleSize * .6 : 0);
      ctx.fillRect(width * .04, center - boxHeight / 2, width * .92, boxHeight);
      ctx.fillStyle = item.titleColor;
    }
    lines.forEach((line, index) => {
      const y = center + (index - (lines.length - 1) / 2) * lineHeight;
      if (item.textStyle === "outline") ctx.strokeText(line, textX, y, width * 0.82);
      ctx.fillText(line, textX, y, width * 0.82);
    });
    if (item.subtitle) {
      ctx.font = `600 ${Math.max(28, Math.round(item.titleSize * .43))}px Vazirmatn, sans-serif`;
      ctx.fillStyle = item.titleColor;
      const subtitleY = center + lines.length * lineHeight / 2 + item.titleSize * .47;
      if (item.textStyle === "outline") ctx.strokeText(item.subtitle, textX, subtitleY, width * .82);
      ctx.fillText(item.subtitle, textX, subtitleY, width * .82);
    }
  }
  const logo = item.logoSource === "watermark" ? state.logo?.bitmap : item.logoSource === "file" ? item.logo : null;
  if (logo) {
    const maxWidth = width * item.logoSize / 100;
    const scale = Math.min(maxWidth / logo.width, height * 0.18 / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const x = width * item.logoX - w / 2;
    const y = height * item.logoY - h / 2;
    if (item.logoRadius) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(w, h) * item.logoRadius / 100);
      ctx.clip();
    }
    ctx.drawImage(logo, x, y, w, h);
    if (item.logoRadius) ctx.restore();
  }
}

async function downloadThumbnail() {
  await Promise.all([document.fonts.load(`700 ${state.thumbnail.titleSize}px Vazirmatn`),
    document.fonts.load(`600 ${Math.max(28, Math.round(state.thumbnail.titleSize * .43))}px Vazirmatn`)]);
  drawThumbnail();
  const canvas = $("#thumbnailCanvas");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return showToast("ساخت تصویر کاور ممکن نشد.");
  downloadBlob(blob, `${safeFileName(refs.outputName.value)}-thumbnail.png`);
}

function restoreOverlays(items) {
  for (const overlay of state.overlays) if (overlay.url) URL.revokeObjectURL(overlay.url);
  state.overlays = (Array.isArray(items) ? items : []).filter((item) =>
    ["text", "image"].includes(item.kind) && Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)) && Number(item.end) > Number(item.start)
  ).map((item) => ({
    id: uid(), kind: item.kind, text: String(item.text || "").slice(0, 120),
    name: item.name || "", sizeBytes: item.sizeBytes || 0, file: null, url: null,
    start: Number(item.start), end: Number(item.end),
    position: ["top", "center", "bottom"].includes(item.position) ? item.position : "top",
    x: Number.isFinite(Number(item.x)) ? Math.max(0.05, Math.min(0.95, Number(item.x))) : 0.5,
    y: Number.isFinite(Number(item.y)) ? Math.max(0.05, Math.min(0.95, Number(item.y)))
      : item.position === "bottom" ? 0.68 : item.position === "center" ? 0.5 : 0.22,
    size: [20, 35, 50].includes(Number(item.size)) ? Number(item.size) : 35,
    radius: Math.max(0, Math.min(20, Number(item.radius) || 0)),
  }));
  renderOverlays();
}

function renderOverlays() {
  state.preview.overlaysKey = "";
  $("#overlayList").innerHTML = state.overlays.map((item) => `<div class="overlay-item" data-overlay-id="${item.id}">
    <strong>${escapeHtml(item.kind === "text" ? item.text : item.name || "تصویر")}${item.kind === "image" && !item.file ? " · فایل را دوباره انتخاب کنید" : ""}</strong>
    ${item.kind === "text" ? `<label>متن <input type="text" data-overlay-field="text" maxlength="120" value="${escapeHtml(item.text).replace(/"/g, "&quot;")}" dir="auto" /></label>` : ""}
    <label>شروع <input type="number" data-overlay-field="start" min="0" step="0.05" value="${item.start.toFixed(2)}" dir="ltr" /></label>
    <label>پایان <input type="number" data-overlay-field="end" min="0.05" step="0.05" value="${item.end.toFixed(2)}" dir="ltr" /></label>
    <label>جایگاه <select data-overlay-field="position">${["top", "center", "bottom"].map((position) => `<option value="${position}" ${item.position === position ? "selected" : ""}>${{top:"بالا",center:"وسط",bottom:"پایین"}[position]}</option>`).join("")}</select></label>
    <label>اندازه <select data-overlay-field="size">${[20, 35, 50].map((size) => `<option value="${size}" ${item.size === size ? "selected" : ""}>${toFaDigits(size)}٪</option>`).join("")}</select></label>
    ${item.kind === "image" ? `<label>گردی گوشه <input type="range" data-overlay-field="radius" min="0" max="20" step="1" value="${item.radius || 0}" /><output>${toFaDigits(item.radius || 0)}٪</output></label>` : ""}
    <button type="button" data-overlay-action="preview">دیدن و جابه‌جایی</button>
    ${item.kind === "image" && !item.file ? '<label class="small-action neutral">انتخاب تصویر<input type="file" data-overlay-relink accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden /></label>' : ""}
    <button type="button" data-overlay-action="delete">حذف</button>
  </div>`).join("") || "<p class=\"overlay-help\">هنوز لایه‌ای اضافه نشده است.</p>";
  updatePreviewOverlays(state.preview.globalTime);
  syncPreviewOverlayControls();
  syncPreviewLayerControls();
}

function syncPreviewLayerControls() {
  const select = $("#previewLayerSelect");
  const panel = $("#previewLayerControls");
  panel.hidden = !state.overlays.length;
  if (!state.overlays.length) return;
  const previous = select.value;
  select.innerHTML = state.overlays.map((item, index) => `<option value="${item.id}">${toFaDigits(index + 1)} · ${escapeHtml(item.kind === "text" ? item.text.slice(0, 25) : item.name)}</option>`).join("");
  const active = state.overlays.find((item) => state.preview.globalTime >= item.start && state.preview.globalTime < item.end);
  select.value = state.overlays.some((item) => item.id === previous) ? previous : active?.id || state.overlays[0].id;
  updatePreviewLayerSliders();
}

function updatePreviewLayerSliders() {
  const item = state.overlays.find((overlay) => overlay.id === $("#previewLayerSelect").value);
  if (!item) return;
  for (const [axis, value] of [["X", item.x], ["Y", item.y]]) {
    const input = $(`#previewLayer${axis}`);
    input.value = Math.round(value * 100);
    $(`#previewLayer${axis}Value`).textContent = `${toFaDigits(input.value)}٪`;
    setRangeVisual(input);
  }
}

function syncPreviewOverlayControls() {
  const images = state.overlays.filter((item) => item.kind === "image" && item.file);
  const panel = $("#previewOverlayControls");
  const select = $("#previewOverlaySelect");
  panel.hidden = !images.length;
  if (!images.length) return;
  const previous = select.value;
  select.innerHTML = images.map((item, index) => `<option value="${item.id}">${toFaDigits(index + 1)} · ${escapeHtml(item.name || "تصویر")}</option>`).join("");
  const active = images.find((item) => state.preview.globalTime >= item.start && state.preview.globalTime < item.end);
  select.value = images.some((item) => item.id === previous) ? previous : active?.id || images[0].id;
  const value = images.find((item) => item.id === select.value)?.radius || 0;
  $("#previewOverlayRadius").value = value;
  $("#previewOverlayRadiusValue").textContent = `${toFaDigits(value)}٪`;
  setRangeVisual($("#previewOverlayRadius"));
}

function updatePreviewOverlays(time) {
  const container = $("#mixPreviewOverlays");
  if (!container) return;
  const visible = state.overlays.filter((item) => time >= item.start && time < item.end && (item.kind === "text" || item.url));
  const key = visible.map((item) => `${item.id}:${item.radius}:${item.size}:${item.x}:${item.y}`).join(":");
  if (state.preview.overlaysKey === key) return;
  state.preview.overlaysKey = key;
  container.innerHTML = visible.map((item) => `<div class="preview-overlay" data-free-position data-overlay-id="${item.id}" style="--overlay-x:${(item.x * 100).toFixed(2)}%;--overlay-y:${(item.y * 100).toFixed(2)}%;--overlay-width:${item.size}%">
    ${item.kind === "image" ? `<img src="${item.url}" alt="" draggable="false" />` : `<span dir="auto" style="font-size:clamp(12px,${item.size * 0.9}px,42px)">${escapeHtml(item.text)}</span>`}
  </div>`).join("");
  for (const image of $$(".preview-overlay img", container)) {
    const item = visible.find((entry) => entry.url === image.src);
    if (!item) continue;
    const apply = () => { image.style.borderRadius = `${Math.min(image.clientWidth, image.clientHeight) * item.radius / 100}px`; };
    if (image.complete) apply(); else image.addEventListener("load", apply, { once: true });
  }
}

let overlayInspectorUrl = null;
function updateOverlayInspector() {
  const image = $("#overlayInspectorImage");
  const file = $("#overlayImage").files[0];
  const radius = Number($("#overlayRadius").value);
  if (!file) { image.hidden = true; $("#overlayInspectorPlaceholder").hidden = false; return; }
  if (!overlayInspectorUrl) overlayInspectorUrl = URL.createObjectURL(file);
  image.src = overlayInspectorUrl;
  image.hidden = false;
  $("#overlayInspectorPlaceholder").hidden = true;
  const apply = () => { image.style.borderRadius = `${Math.min(image.clientWidth, image.clientHeight) * radius / 100}px`; };
  if (image.complete) requestAnimationFrame(apply); else image.addEventListener("load", apply, { once: true });
}

async function overlayPngBytes(item, frameWidth, frameHeight) {
  let canvas = document.createElement("canvas");
  const width = Math.round(frameWidth * 0.78);
  if (item.kind === "image") {
    const bitmap = await createImageBitmap(item.file);
    try {
      const scale = Math.min(frameWidth * item.size / 100 / bitmap.width, frameHeight * 0.35 / bitmap.height);
      canvas.width = Math.max(2, Math.round(bitmap.width * scale));
      canvas.height = Math.max(2, Math.round(bitmap.height * scale));
      const draw = canvas.getContext("2d");
      if (item.radius) {
        const radius = Math.min(canvas.width, canvas.height) * item.radius / 100;
        draw.beginPath();
        draw.roundRect(0, 0, canvas.width, canvas.height, radius);
        draw.clip();
      }
      draw.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally { bitmap.close(); }
  } else {
    const fontSize = Math.round(frameWidth * item.size / 350);
    await document.fonts.load(`700 ${fontSize}px Vazirmatn`);
    const context = canvas.getContext("2d");
    context.font = `700 ${fontSize}px Vazirmatn, sans-serif`;
    const lines = [];
    let line = "";
    for (const word of item.text.split(/\s+/u)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > width - 48) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    canvas.width = width;
    canvas.height = Math.max(2, Math.round(lines.length * fontSize * 1.22 + 32));
    const draw = canvas.getContext("2d");
    draw.font = `700 ${fontSize}px Vazirmatn, sans-serif`;
    draw.textAlign = "center";
    draw.textBaseline = "middle";
    draw.lineJoin = "round";
    draw.lineWidth = Math.max(4, fontSize * 0.1);
    draw.strokeStyle = "#10213c";
    draw.fillStyle = "white";
    lines.forEach((text, index) => {
      const y = 18 + fontSize * (index + 0.5) * 1.22;
      draw.strokeText(text, canvas.width / 2, y, canvas.width - 48);
      draw.fillText(text, canvas.width / 2, y, canvas.width - 48);
    });
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((image) => image ? resolve(image) : reject(new Error("ساخت لایهٔ تصویر ممکن نشد.")), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

function getMediaDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`خواندن مشخصات فایل ${file.name} ممکن نیست.`));
    };
    media.src = url;
  });
}

function createVideoThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const finish = (result) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };

    video.onerror = () => finish("");
    video.onloadedmetadata = () => {
      const target = Math.min(Math.max(video.duration * 0.18, 0.1), Math.max(video.duration - 0.1, 0.1));
      try { video.currentTime = target; } catch { finish(""); }
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      if (!context) return finish("");
      const sourceRatio = video.videoWidth / video.videoHeight;
      const targetRatio = canvas.width / canvas.height;
      let sx = 0;
      let sy = 0;
      let sw = video.videoWidth;
      let sh = video.videoHeight;
      if (sourceRatio > targetRatio) {
        sw = video.videoHeight * targetRatio;
        sx = (video.videoWidth - sw) / 2;
      } else {
        sh = video.videoWidth / targetRatio;
        sy = (video.videoHeight - sh) / 2;
      }
      context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      finish(canvas.toDataURL("image/jpeg", 0.78));
    };
    video.src = url;
  });
}

async function addClips(files) {
  const videoFiles = [...files].filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name));
  if (!videoFiles.length) {
    showToast("لطفاً فایل ویدئویی MP4، MOV یا WebM انتخاب کنید.");
    return;
  }

  refs.dropZone.setAttribute("aria-busy", "true");
  let importedRecipe = null;
  try { importedRecipe = JSON.parse(localStorage.getItem("flow2short-imported-recipe") || localStorage.getItem("flow2short-draft") || "null"); } catch { /* ignore */ }
  for (const file of videoFiles) {
    try {
      const [duration, thumbnail] = await Promise.all([getMediaDuration(file), createVideoThumbnail(file)]);
      const existing = state.clips.some((clip) => clip.name === file.name && clip.file.size === file.size);
      if (existing) continue;
      const matching = importedRecipe?.project?.clips?.filter((item) => item.name === file.name && (!item.size || item.size === file.size)) || [];
      for (const remembered of matching.length ? matching : [null]) {
        state.clips.push({
          id: uid(), file, url: URL.createObjectURL(file), name: file.name, duration,
          start: remembered ? Math.max(0, Math.min(duration - 0.05, Number(remembered.start) || 0)) : 0,
          end: remembered ? Math.max(0.05, Math.min(duration, Number(remembered.end) || duration)) : duration,
          volume: remembered ? Math.max(0, Math.min(100, Number(remembered.sourceAudioPercent) || 0)) : 35,
          transition: TRANSITIONS[remembered?.transition] ? remembered.transition : "none",
          transitionSeconds: TRANSITION_DURATIONS.includes(Number(remembered?.transitionSeconds)) ? Number(remembered.transitionSeconds) : 0.4,
          thumbnail,
          recipeOrder: remembered ? importedRecipe.project.clips.indexOf(remembered) : 9999,
        });
      }
    } catch (error) {
      showToast(error.message);
    }
  }
  if (importedRecipe?.project?.clips?.length) {
    state.clips.sort((a, b) => (a.recipeOrder ?? 9999) - (b.recipeOrder ?? 9999));
  }
  refs.dropZone.removeAttribute("aria-busy");
  renderClipCards();
  updateSummary();
  saveDraft();
}

function clipDuration(clip) {
  return Math.max(0.05, Math.min(clip.duration, clip.end) - Math.max(0, clip.start));
}

function renderClipCards() {
  refs.emptyClips.hidden = state.clips.length > 0;
  refs.clipList.innerHTML = state.clips.map((clip, index) => `
    <article class="clip-card" draggable="true" data-id="${clip.id}" aria-label="کلیپ ${toFaDigits(index + 1)}: ${escapeHtml(clip.name)}">
      <button class="drag-handle" type="button" aria-label="گرفتن و جابه‌جایی کلیپ"></button>
      <button class="clip-thumb" type="button" data-action="preview" aria-label="پیش‌نمایش ${escapeHtml(clip.name)}">
        ${clip.thumbnail ? `<img src="${clip.thumbnail}" alt="" />` : ""}
        <span class="play-dot"><svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z"/></svg></span>
        <span class="thumb-time">${formatTime(clipDuration(clip), false)}</span>
      </button>
      <div class="clip-details">
        <strong class="clip-name" dir="ltr" title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</strong>
        <div class="trim-row">
          <span>شروع</span>
          <input data-field="start" type="number" min="0" max="${formatDecimal(Math.max(0, clip.end - 0.05))}" step="0.05" value="${formatDecimal(clip.start)}" aria-label="زمان شروع کلیپ بر حسب ثانیه" />
          <span>پایان</span>
          <input data-field="end" type="number" min="0.05" max="${formatDecimal(clip.duration)}" step="0.05" value="${formatDecimal(clip.end)}" aria-label="زمان پایان کلیپ بر حسب ثانیه" />
        </div>
      </div>
      <label class="clip-volume">
        <span class="clip-volume-head"><span><svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6l-5 4H5Z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>صدای اصلی کلیپ</span><output>${toFaDigits(clip.volume)}٪</output></span>
        <input data-field="volume" type="range" min="0" max="100" value="${clip.volume}" aria-label="درصد صدای اصلی کلیپ" />
      </label>
      <div class="clip-menu">
        <button type="button" data-action="up" aria-label="انتقال یک ردیف به بالا" ${index === 0 ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5"/></svg></button>
        <button type="button" data-action="down" aria-label="انتقال یک ردیف به پایین" ${index === state.clips.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button>
        <button class="delete-clip" type="button" data-action="delete" aria-label="حذف کلیپ"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></svg></button>
      </div>
      <div class="clip-split">
        <label>تقسیم در ثانیهٔ فایل <input data-field="splitAt" type="number" step="0.05" min="${formatDecimal(clip.start + 0.1)}" max="${formatDecimal(clip.end - 0.1)}" value="${formatDecimal((clip.start + clip.end) / 2)}" aria-label="محل تقسیم ${escapeHtml(clip.name)}" /></label>
        <button type="button" data-action="split" ${clipDuration(clip) < 0.22 ? "disabled" : ""}>تقسیم کلیپ</button>
        <button type="button" data-action="join" ${index < state.clips.length - 1 && state.clips[index + 1].file === clip.file && Math.abs(state.clips[index + 1].start - clip.end) < 0.06 && clip.transition === "none" ? "" : "disabled"}>ادغام با بعدی</button>
      </div>
      ${index < state.clips.length - 1 ? `<div class="clip-transition">
        <label>ترنزیشن به کلیپ بعدی <select data-field="transition" aria-label="ترنزیشن بعد از ${escapeHtml(clip.name)}">
          ${Object.entries(TRANSITIONS).map(([key, value]) => `<option value="${key}" ${clip.transition === key ? "selected" : ""}>${value.label}</option>`).join("")}
        </select></label>
        <label>مدت <select data-field="transitionSeconds" aria-label="مدت ترنزیشن بعد از ${escapeHtml(clip.name)}" ${clip.transition === "none" ? "disabled" : ""}>
          ${TRANSITION_DURATIONS.map((duration) => `<option value="${duration}" ${clip.transitionSeconds === duration ? "selected" : ""}>${toFaDigits(duration.toFixed(1))} ثانیه</option>`).join("")}
        </select></label>
        <button type="button" data-action="preview-transition" ${clip.transition === "none" ? "disabled" : ""}>دیدن گذار</button>
      </div>` : ""}
    </article>
  `).join("");

  $$('input[type="range"]', refs.clipList).forEach(setRangeVisual);
  renderTimeline();
  updateLogoStage();
  updateThumbnailClipOptions();
}

function renderTimeline() {
  const timeline = $("#editTimeline");
  if (!timeline) return;
  const total = state.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  let elapsed = 0;
  timeline.hidden = !state.clips.length;
  $("#timelineWrap").hidden = !state.clips.length;
  timeline.innerHTML = state.clips.map((clip, index) => {
    const start = elapsed;
    elapsed += clipDuration(clip);
    return `<button type="button" data-timeline-time="${start.toFixed(3)}" style="flex:${clipDuration(clip)}" title="${escapeHtml(clip.name)} · ${formatTime(start)}" aria-label="نمایش کلیپ ${toFaDigits(index + 1)} در ${formatTime(start)}"><span>${toFaDigits(index + 1)}</span><small>${escapeHtml(clip.name)}</small></button>`;
  }).join("");
  timeline.setAttribute("aria-label", `تایم‌لاین ${formatTime(total)}؛ برای دیدن هر بخش کلیک کنید`);
}

function splitClip(index, at) {
  const clip = state.clips[index];
  if (!clip || !(at > clip.start + 0.08 && at < clip.end - 0.08)) return showToast("محل تقسیم باید دست‌کم ۰٫۱ ثانیه از ابتدا و انتهای برش فاصله داشته باشد.");
  const second = { ...clip, id: uid(), url: URL.createObjectURL(clip.file), start: at };
  clip.end = at;
  clip.transition = "none";
  state.clips.splice(index + 1, 0, second);
  renderClipCards();
  updateSummary();
  saveDraft();
}

function joinClip(index) {
  const first = state.clips[index];
  const second = state.clips[index + 1];
  if (!first || !second || first.file !== second.file || Math.abs(first.end - second.start) > 0.06 || first.transition !== "none") return;
  first.end = second.end;
  first.transition = second.transition;
  first.transitionSeconds = second.transitionSeconds;
  URL.revokeObjectURL(second.url);
  state.clips.splice(index + 1, 1);
  renderClipCards();
  updateSummary();
  saveDraft();
}

function updateLogoStage() {
  const clip = state.clips[0];
  refs.logoStageVideo.style.objectFit = refs.fitMode.value === "contain" ? "contain" : "cover";
  if (!clip) {
    refs.logoStageVideo.pause();
    refs.logoStageVideo.removeAttribute("src");
    refs.logoStageVideo.load();
    refs.logoStageVideo.hidden = true;
    $("#logoStagePlaceholder").hidden = false;
    return;
  }
  refs.logoStageVideo.hidden = false;
  $("#logoStagePlaceholder").hidden = true;
  if (refs.logoStageVideo.src !== clip.url) {
    refs.logoStageVideo.src = clip.url;
    refs.logoStageVideo.load();
  }
  const seek = () => {
    const target = Math.min(clip.start + 0.25, Math.max(0, clip.end - 0.05));
    try { refs.logoStageVideo.currentTime = target; } catch { /* metadata is not ready yet */ }
  };
  if (refs.logoStageVideo.readyState >= 1) seek();
  else refs.logoStageVideo.onloadedmetadata = seek;
}

function updateSummary() {
  const total = state.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  refs.totalDuration.textContent = formatTime(total);
  refs.clipCount.textContent = toFaDigits(state.clips.length);
  refs.mixPreviewButton.disabled = state.clips.length === 0 || state.rendering;
  refs.renderButton.disabled = state.clips.length === 0 || state.rendering || location.protocol === "file:";
  refs.renderButton.title = location.protocol === "file:" ? "برای ساخت خروجی، برنامه را با Start Flow2Short.command باز کنید." : "";
  refs.outputSummary.textContent = refs.resolution.value === "720" ? "۷۲۰ × ۱۲۸۰" : "۱۰۸۰ × ۱۹۲۰";
  updateDeviceReadiness();
}

function updateDeviceReadiness() {
  const box = $("#deviceReadiness");
  const title = $("strong", box);
  const hint = $("#deviceHint");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const totalBytes = state.clips.reduce((sum, clip) => sum + clip.file.size, 0) + (state.narration?.file.size || 0) + (state.music?.file.size || 0);
  if (isIOS && totalBytes > 220 * 1024 * 1024) {
    box.classList.add("is-mobile-warning");
    title.textContent = "پروژه برای موبایل سنگین است";
    hint.textContent = "حجم پروژه برای آیفون سنگین است؛ پروژه را ذخیره و خروجی را روی مک یا ویندوز بسازید.";
  } else if (location.protocol === "file:") {
    box.classList.add("is-mobile-warning");
    title.textContent = "حالت نمایش — خروجی غیرفعال است";
    hint.textContent = "برای ساخت خروجی، Start Flow2Short.command را اجرا کنید تا آدرس با http باز شود.";
  } else {
    box.classList.remove("is-mobile-warning");
    title.textContent = "آماده برای پردازش محلی";
    hint.textContent = `حدود ${formatBytes(totalBytes)} ورودی؛ ساخت خروجی محلی است. فقط رونویسی اختیاری، صدا را به Google می‌فرستد.`;
  }
}

function openPreview(clip) {
  if (!clip) return;
  refs.clipPreview.src = clip.url;
  refs.clipPreview.currentTime = Math.min(clip.start, clip.duration || 0);
  refs.previewName.textContent = clip.name;
  refs.previewMeta.textContent = `${formatTime(clipDuration(clip))} از ${formatTime(clip.duration)} · صدای اصلی ${toFaDigits(clip.volume)}٪`;
  refs.previewStrip.hidden = false;
  refs.previewStrip.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closePreview() {
  refs.clipPreview.pause();
  refs.clipPreview.removeAttribute("src");
  refs.clipPreview.load();
  refs.previewStrip.hidden = true;
}

function buildPreviewSegments() {
  let offset = 0;
  state.preview.segments = state.clips.map((clip, index) => {
    const duration = clipDuration(clip);
    const segment = { clip, index, start: offset, end: offset + duration, duration };
    offset += duration;
    return segment;
  });
  state.preview.total = offset;
  return state.preview.segments;
}

function previewSegmentAt(time) {
  const safeTime = Math.max(0, Math.min(Number(time) || 0, Math.max(0, state.preview.total - 0.001)));
  return state.preview.segments.find((segment) => safeTime >= segment.start && safeTime < segment.end)
    || state.preview.segments.at(-1);
}

function previewTransition(clip, nextClip) {
  try { return selectedTransition(clip, nextClip); }
  catch { return null; } // A short next clip must not prevent preview playback.
}

function updatePreviewCaption(time) {
  const offset = state.captionStyle.offsetMs / 1000;
  const index = $("#burnCaptions").checked
    ? state.caption?.displayCues?.findIndex((item) => time >= item.start + offset && time < item.end + offset) ?? -1
    : -1;
  const cue = index >= 0 ? state.caption.displayCues[index] : null;
  if (cue && refs.mixPreviewCaption.dataset.cue !== String(index)) {
    refs.mixPreviewCaption.dataset.cue = String(index);
    if (state.caption.wordByWord && state.captionStyle.groupSize !== "standard") {
      const word = document.createElement("span");
      word.className = "caption-active-word";
      word.textContent = cue.word;
      refs.mixPreviewCaption.replaceChildren(document.createTextNode(cue.previousText ? `${cue.previousText} ` : ""), word);
    } else {
      refs.mixPreviewCaption.textContent = cue.text;
    }
  }
  if (!cue) {
    refs.mixPreviewCaption.dataset.cue = "";
    refs.mixPreviewCaption.textContent = "";
  }
  refs.mixPreviewCaption.hidden = !cue;
  if (state.caption) {
    const shiftedTime = time - offset;
    refs.previewCaptionStatus.textContent = cue
      ? `${cue.text} · زمان ویدئو ${formatPreciseTime(time)} · زمان SRT ${formatPreciseTime(shiftedTime)}`
      : `در ${formatPreciseTime(time)} زیرنویسی نیست · زمان SRT ${formatPreciseTime(shiftedTime)}`;
  } else {
    refs.previewCaptionStatus.textContent = "برای دیدن زیرنویس، فایل SRT وارد کنید.";
  }
}

function formatPreciseTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return toFaDigits(`${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`);
}

function transitionFreezeKey(clip) {
  return `${clip.id}:${clip.end}:${refs.fitMode.value}`;
}

function prepareTransitionFreeze(clip) {
  const key = transitionFreezeKey(clip);
  if (state.preview.freezeCache.has(key)) return Promise.resolve(state.preview.freezeCache.get(key));
  if (state.preview.freezePending.has(key)) return state.preview.freezePending.get(key);
  const pending = (async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = clip.url;
    try {
      await waitForMetadata(video);
      const target = Math.max(clip.start, Math.min(video.duration - 0.04, clip.end - 0.04));
      await new Promise((resolve, reject) => {
        video.addEventListener("seeked", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("خواندن فریم پایانی ممکن نشد.")), { once: true });
        video.currentTime = target;
        if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) resolve();
      });
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      context.fillStyle = "#07111f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = (refs.fitMode.value === "contain" ? Math.min : Math.max)(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      const image = canvas.toDataURL("image/jpeg", 0.86);
      state.preview.freezeCache.set(key, image);
      return image;
    } finally {
      video.removeAttribute("src");
      video.load();
      state.preview.freezePending.delete(key);
    }
  })();
  state.preview.freezePending.set(key, pending);
  return pending;
}

function updateTransitionPreview(time) {
  const video = refs.mixPreviewVideo;
  const freeze = refs.mixTransitionFreeze;
  video.style.transform = "";
  video.style.opacity = "";
  // Cached pages from earlier versions have no transition image.
  if (!freeze) return;
  freeze.style.transform = "";
  freeze.style.opacity = "";
  freeze.style.clipPath = "";
  freeze.hidden = true;
  const segment = previewSegmentAt(time);
  if (!segment) return;
  const previous = state.preview.segments[segment.index - 1];
  if (!previous) return;
  const transition = previewTransition(previous.clip, segment.clip);
  if (!transition) return;
  if (time < segment.start || time >= segment.start + transition.duration) return;
  const key = transitionFreezeKey(previous.clip);
  const image = state.preview.freezeCache.get(key);
  if (!image) {
    prepareTransitionFreeze(previous.clip).then(() => {
      if (refs.mixPreviewDialog.open) updateTransitionPreview(state.preview.globalTime);
    }).catch(() => {});
    return;
  }
  if (freeze.src !== image) freeze.src = image;
  freeze.hidden = false;
  const progress = Math.max(0, Math.min(1, (time - segment.start) / transition.duration));
  if (transition.type === "fade") freeze.style.opacity = 1 - progress;
  if (transition.type === "zoom") {
    freeze.style.opacity = 1 - progress;
    freeze.style.transform = `scale(${1 + progress * 0.12})`;
    video.style.transform = `scale(${1.12 - progress * 0.12})`;
  }
  if (transition.type === "slide") {
    freeze.style.transform = `translateX(${-progress * 100}%)`;
    video.style.transform = `translateX(${(1 - progress) * 100}%)`;
  }
  if (transition.type === "wipe") freeze.style.clipPath = `inset(0 0 0 ${progress * 100}%)`;
  if (transition.type === "black") {
    freeze.style.opacity = Math.max(0, 1 - 2 * progress);
    video.style.opacity = Math.max(0, Math.min(1, 2 * progress - 1));
  }
}

function updateMixPreviewUI(time) {
  const safeTime = Math.max(0, Math.min(Number(time) || 0, state.preview.total));
  state.preview.globalTime = safeTime;
  refs.mixPreviewSeek.value = safeTime;
  refs.mixPreviewCurrent.textContent = formatTime(safeTime);
  refs.mixPreviewTotal.textContent = formatTime(state.preview.total);
  setRangeVisual(refs.mixPreviewSeek);
  updatePreviewCaption(safeTime);
  updateTransitionPreview(safeTime);
  updatePreviewOverlays(safeTime);
}

function ensurePreviewAudioGraph() {
  if (state.preview.audioConnected) return state.preview.audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  const videoGain = context.createGain();
  const narrationGain = context.createGain();
  const musicGain = context.createGain();
  context.createMediaElementSource(refs.mixPreviewVideo).connect(videoGain).connect(context.destination);
  context.createMediaElementSource(refs.mixPreviewNarration).connect(narrationGain).connect(context.destination);
  context.createMediaElementSource(refs.mixPreviewMusic).connect(musicGain).connect(context.destination);
  refs.mixPreviewVideo.volume = 1;
  refs.mixPreviewNarration.volume = 1;
  refs.mixPreviewMusic.volume = 1;
  state.preview.audioContext = context;
  state.preview.gains = { video: videoGain, narration: narrationGain, music: musicGain };
  state.preview.audioConnected = true;
  return context;
}

function previewMusicGain(time) {
  let gain = Number($("#musicVolume").value) / 100;
  if (state.audioMix.fades && state.preview.total) gain *= Math.max(0, Math.min(1, time / 0.5, (state.preview.total - time) / 0.5));
  if (state.audioMix.duck && state.narration?.duration) {
    const envelope = Math.max(0, Math.min(1, time / 0.25, (state.narration.duration - time) / 0.25));
    gain *= 1 - envelope * (1 - state.audioMix.duckPercent / 100);
  }
  return Math.max(0, gain);
}

function syncPreviewGains(segment, time = state.preview.globalTime) {
  if (!state.preview.gains) {
    refs.mixPreviewVideo.volume = Math.min(1, segment.clip.volume / 100);
    refs.mixPreviewNarration.volume = Math.min(1, Number($("#narrationVolume").value) / 100);
    refs.mixPreviewMusic.volume = Math.min(1, previewMusicGain(time));
    return;
  }
  const now = state.preview.audioContext.currentTime;
  state.preview.gains.video.gain.setTargetAtTime(segment.clip.volume / 100, now, 0.015);
  state.preview.gains.narration.gain.setTargetAtTime(Number($("#narrationVolume").value) / 100, now, 0.015);
  state.preview.gains.music.gain.setTargetAtTime(previewMusicGain(time), now, 0.015);
}

function syncPreviewAudio(time, shouldPlay) {
  const tracks = [
    { element: refs.mixPreviewNarration, media: state.narration, loop: false },
    { element: refs.mixPreviewMusic, media: state.music, loop: true },
  ];
  tracks.forEach(({ element, media, loop }) => {
    if (!media?.url || !media.duration) {
      element.pause();
      return;
    }
    if (!loop && time >= media.duration) {
      element.pause();
      return;
    }
    const target = loop ? time % media.duration : time;
    try {
      if (Math.abs((element.currentTime || 0) - target) > 0.22) element.currentTime = target;
    } catch { /* metadata is still loading */ }
    if (shouldPlay) element.play().catch(() => {});
    else element.pause();
  });
}

function waitForMetadata(media) {
  if (media.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    media.addEventListener("loadedmetadata", resolve, { once: true });
    media.addEventListener("error", () => reject(new Error("پخش این کلیپ در مرورگر ممکن نیست.")), { once: true });
  });
}

async function loadMixPreviewAt(time, shouldPlay = false) {
  if (!state.preview.segments.length) return;
  const safeTime = Math.max(0, Math.min(Number(time) || 0, Math.max(0, state.preview.total - 0.001)));
  const segment = previewSegmentAt(safeTime);
  if (!segment) return;
  const token = ++state.preview.loadToken;
  const clipChanged = state.preview.index !== segment.index || refs.mixPreviewVideo.src !== segment.clip.url;
  state.preview.index = segment.index;
  if (clipChanged) {
    refs.mixPreviewVideo.pause();
    refs.mixPreviewVideo.src = segment.clip.url;
    refs.mixPreviewVideo.load();
    await waitForMetadata(refs.mixPreviewVideo);
    if (token !== state.preview.loadToken) return;
  }
  const clipTime = segment.clip.start + (safeTime - segment.start);
  if (Math.abs(refs.mixPreviewVideo.currentTime - clipTime) > 0.08) refs.mixPreviewVideo.currentTime = clipTime;
  refs.mixPreviewClipName.textContent = segment.clip.name;
  syncPreviewGains(segment, safeTime);
  syncPreviewAudio(safeTime, shouldPlay);
  updateMixPreviewUI(safeTime);
  if (shouldPlay) await refs.mixPreviewVideo.play();
}

function pauseMixPreview() {
  state.preview.playing = false;
  cancelAnimationFrame(state.preview.frame);
  refs.mixPreviewVideo.pause();
  syncPreviewAudio(state.preview.globalTime, false);
  refs.mixPreviewPlay.classList.remove("is-playing");
  refs.mixPreviewPlay.setAttribute("aria-label", "پخش پیش‌نمایش");
}

function runMixPreviewFrame() {
  if (!state.preview.playing) return;
  const segment = state.preview.segments[state.preview.index];
  if (!segment) return pauseMixPreview();
  const time = segment.start + Math.max(0, refs.mixPreviewVideo.currentTime - segment.clip.start);
  if (time >= segment.end - 0.025) {
    const next = state.preview.segments[segment.index + 1];
    if (!next) {
      updateMixPreviewUI(state.preview.total);
      pauseMixPreview();
      return;
    }
    loadMixPreviewAt(next.start, true)
      .then(() => { if (state.preview.playing) state.preview.frame = requestAnimationFrame(runMixPreviewFrame); })
      .catch((error) => { pauseMixPreview(); showToast(error.message); });
    return;
  }
  if (segment.end - time < 0.85 && previewTransition(segment.clip, state.preview.segments[segment.index + 1]?.clip)) {
    prepareTransitionFreeze(segment.clip).catch(() => {});
  }
  updateMixPreviewUI(time);
  syncPreviewAudio(time, true);
  syncPreviewGains(segment, time);
  state.preview.frame = requestAnimationFrame(runMixPreviewFrame);
}

async function playMixPreview() {
  try {
    const context = ensurePreviewAudioGraph();
    // Keep video.play() in the original click activation; awaiting audio
    // resume first can make browsers block the subsequent video play call.
    if (context?.state === "suspended") context.resume().catch((error) => console.warn("Preview audio resume failed", error));
    if (state.preview.globalTime >= state.preview.total - 0.02) state.preview.globalTime = 0;
    state.preview.playing = true;
    refs.mixPreviewPlay.classList.add("is-playing");
    refs.mixPreviewPlay.setAttribute("aria-label", "توقف پیش‌نمایش");
    await loadMixPreviewAt(state.preview.globalTime, true);
    cancelAnimationFrame(state.preview.frame);
    state.preview.frame = requestAnimationFrame(runMixPreviewFrame);
  } catch (error) {
    pauseMixPreview();
    showToast(error.message || "پخش پیش‌نمایش ممکن نشد.");
  }
}

async function openMixPreview(startTime = 0) {
  if (!state.clips.length) return;
  closePreview();
  buildPreviewSegments();
  refs.mixPreviewSeek.max = state.preview.total;
  for (const [element, media] of [[refs.mixPreviewNarration, state.narration], [refs.mixPreviewMusic, state.music]]) {
    if (media?.url) element.src = media.url;
    else element.removeAttribute("src");
    element.load();
  }
  refs.mixPreviewVideo.style.objectFit = refs.fitMode.value === "contain" ? "contain" : "cover";
  state.preview.index = -1;
  state.preview.globalTime = Math.max(0, Math.min(startTime, state.preview.total));
  syncPreviewOverlayControls();
  syncPreviewLayerControls();
  applyCaptionStyle();
  refs.mixPreviewDialog.showModal();
  state.preview.overlaysKey = "";
  const startSegment = previewSegmentAt(state.preview.globalTime);
  await loadMixPreviewAt(state.preview.globalTime, false);
  if (startSegment?.index > 0) await prepareTransitionFreeze(state.preview.segments[startSegment.index - 1].clip).catch(() => {});
  if (startSegment && previewTransition(startSegment.clip, state.preview.segments[startSegment.index + 1]?.clip)) {
    prepareTransitionFreeze(startSegment.clip).catch(() => {});
  }
}

function closeMixPreview() {
  pauseMixPreview();
  state.preview.loadToken += 1;
  refs.mixPreviewVideo.removeAttribute("src");
  refs.mixPreviewVideo.load();
  refs.mixPreviewDialog.close();
}

function moveClip(id, direction) {
  const index = state.clips.findIndex((clip) => clip.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.clips.length) return;
  [state.clips[index], state.clips[target]] = [state.clips[target], state.clips[index]];
  renderClipCards();
  saveDraft();
}

function deleteClip(id) {
  const index = state.clips.findIndex((clip) => clip.id === id);
  if (index < 0) return;
  const [clip] = state.clips.splice(index, 1);
  URL.revokeObjectURL(clip.url);
  if (refs.previewName.textContent === clip.name) closePreview();
  renderClipCards();
  updateSummary();
  saveDraft();
}

function handleClipField(event) {
  const card = event.target.closest(".clip-card");
  if (!card) return;
  const clip = state.clips.find((item) => item.id === card.dataset.id);
  if (!clip) return;
  const field = event.target.dataset.field;
  if (field === "splitAt") return;

  if (field === "volume") {
    clip.volume = Math.round(Number(event.target.value));
    event.target.closest("label").querySelector("output").textContent = `${toFaDigits(clip.volume)}٪`;
    setRangeVisual(event.target);
  }

  if (field === "transition" || field === "transitionSeconds") {
    const previousType = clip.transition;
    const previousDuration = clip.transitionSeconds;
    if (field === "transition") clip.transition = TRANSITIONS[event.target.value] ? event.target.value : "none";
    else clip.transitionSeconds = Number(event.target.value);
    try {
      selectedTransition(clip, state.clips[state.clips.indexOf(clip) + 1]);
    } catch (error) {
      clip.transition = previousType;
      clip.transitionSeconds = previousDuration;
      showToast(error.message);
    }
    renderClipCards();
    saveDraft();
    return;
  }

  if (field === "start") {
    clip.start = Math.max(0, Math.min(Number(event.target.value) || 0, clip.end - 0.05));
    event.target.value = formatDecimal(clip.start);
  }

  if (field === "end") {
    clip.end = Math.min(clip.duration, Math.max(Number(event.target.value) || clip.duration, clip.start + 0.05));
    event.target.value = formatDecimal(clip.end);
  }

  const time = $(".thumb-time", card);
  if (time) time.textContent = formatTime(clipDuration(clip), false);
  updateSummary();
  saveDraft();
}

async function setAudio(kind, file) {
  if (!file) return;
  try {
    const duration = await getMediaDuration(file);
    if (state[kind]?.url) URL.revokeObjectURL(state[kind].url);
    state[kind] = { file, duration, url: URL.createObjectURL(file) };
    if (kind === "narration" && generatedNarration && generatedNarration !== file) {
      generatedNarration = null;
      $("#ttsDownload").disabled = true;
      $("#ttsPlayer").hidden = true;
    }
    state.remembered[kind] = { name: file.name, size: file.size, volume: Number($(`#${kind}Volume`).value) };
    $(`#${kind}Name`).textContent = file.name;
    $(`#${kind}Meta`).textContent = `${formatTime(duration)} · ${formatBytes(file.size)}`;
    $(`[data-remove="${kind}"]`).hidden = false;
    updateSummary();
    saveDraft();
  } catch (error) {
    showToast(error.message);
  }
}

async function setCaption(file) {
  if (!file) return;
  try {
    let cues = parseSrt(await file.text());
    if (!cues.length) throw new Error("زمان‌بندی معتبری داخل فایل SRT پیدا نشد.");
    let saved = null;
    try {
      const draft = JSON.parse(localStorage.getItem("flow2short-draft") || "null")?.project?.caption;
      const imported = JSON.parse(localStorage.getItem("flow2short-imported-recipe") || "null")?.project?.caption;
      saved = state.remembered.caption?.name === file.name ? state.remembered.caption : draft?.name === file.name ? draft : imported;
    } catch { /* ignore */ }
    if (saved?.name === file.name && (!saved.size || saved.size === file.size) && Array.isArray(saved.cues)) {
      const restored = saved.cues.filter((cue) => typeof cue.text === "string" && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
      if (restored.length) cues = restored.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }));
    }
    const wordByWord = cues.every((cue) => !/\s/u.test(cue.text.trim()));
    state.caption = { file, cues, wordByWord, displayCues: [] };
    state.remembered.caption = { name: file.name, size: file.size, burn: $("#burnCaptions").checked, cues };
    $("#captionName").textContent = file.name;
    $('[data-remove="caption"]').hidden = false;
    refreshCaptionDisplay();
    saveDraft();
  } catch (error) {
    refs.captionInput.value = "";
    showToast(error.message || "خواندن زیرنویس ممکن نشد.");
  }
}

function transcriptionMime(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  return { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac" }[extension] || file.type;
}

async function generateCaptionsFromAudio(overrideFile = null, expectedNarration = false) {
  const button = $("#transcribeButton");
  const status = $("#transcribeStatus");
  const source = $("#transcribeSource").value;
  const file = overrideFile || (source === "narration" ? state.narration?.file : $("#transcribeFile").files[0]);
  if (!file) return showToast(source === "narration" ? "ابتدا فایل نریشن پروژه را اضافه کنید." : "یک فایل صوتی انتخاب کنید.");
  if (file.size > 35 * 1024 * 1024) return showToast("حجم صدا باید کمتر از ۳۵ مگابایت باشد.");
  if (state.preview.total && source === "file") status.textContent = "در حال رونویسی؛ زمان فایل صوتی باید از صفر با ویدئو هماهنگ باشد…";
  else status.textContent = "در حال ارسال نریشن و دریافت زمان‌بندی کلمات…";
  button.disabled = true;
  try {
    const response = await fetch(new URL("./__transcribe", APP_BASE_URL), {
      method: "POST", headers: { "Content-Type": transcriptionMime(file) }, body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "رونویسی انجام نشد.");
    const cues = (Array.isArray(data.cues) ? data.cues : []).filter((cue) =>
      Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && String(cue.text || "").trim()
    );
    if (!cues.length) throw new Error("هیچ کلمه‌ای با زمان معتبر دریافت نشد؛ زیرنویس قبلی حفظ شد.");
    if (expectedNarration && state.narration?.file !== file) {
      status.textContent = "نریشن عوض شد؛ زیرنویسِ صدای قبلی کنار گذاشته شد.";
      return false;
    }
    const content = cues.map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`).join("\n\n") + "\n";
    const generated = new File([content], `Flow2Short-auto-${Date.now()}.srt`, { type: "text/plain" });
    const previous = state.caption;
    await setCaption(generated);
    if (state.caption === previous) throw new Error("ثبت زیرنویس خودکار انجام نشد.");
    setCaptionOffset(0);
    status.textContent = `${toFaDigits(cues.length)} کلمه با زمان اختصاصی آماده شد. SRT کلمه‌ای یا استاندارد را از دکمه‌های همین بخش دانلود کنید.`;
    return true;
  } catch (error) {
    status.textContent = error instanceof SyntaxError ? "سرویس رونویسی در لانچر فعلی فعال نیست. برنامه را با لانچر Python همین نسخه باز کنید." : error.message;
    showToast(status.textContent);
  } finally {
    button.disabled = false;
  }
}

async function googleApiRequest(path, options) {
  const response = await fetch(new URL(`./${path}`, APP_BASE_URL), { cache: "no-store", ...options });
  const contentType = response.headers.get("Content-Type") || "";
  if (!response.ok) {
    let message = "سرویس Google در لانچر فعلی فعال نیست؛ برنامه را با لانچر Python یا نسخهٔ مستقل اجرا کنید.";
    if (contentType.includes("application/json")) message = (await response.json()).error || message;
    throw new Error(message);
  }
  return response;
}

async function refreshGoogleConnection() {
  try {
    const response = await googleApiRequest("__google_config");
    const configured = (await response.json()).configured;
    $("#googleKeyStatus").textContent = configured ? "کلید روی همین دستگاه ثبت شده است." : "هنوز کلیدی ثبت نشده است.";
    $("#ttsStatus").textContent = configured ? "اتصال گوگل آماده است. متن و گوینده را انتخاب کنید، سپس دکمهٔ تبدیل را بزنید." : "برای شروع، کلید API گوگل را در تنظیمات برنامه ثبت کنید.";
    if (configured) await loadGoogleVoices();
    else {
      $("#ttsVoice").replaceChildren(new Option("ابتدا کلید Google را تنظیم کنید", ""));
      availableVoices = [];
      renderVoiceGallery();
    }
  } catch (error) {
    $("#googleKeyStatus").textContent = error.message;
  }
}

let availableVoices = [];
let showAllVoices = false;
let voiceLoadSerial = 0;
const voiceSamples = new Map();
let voicePreviewSerial = 0;

function renderVoiceGallery() {
  const search = $("#voiceSearch").value.trim().toLocaleLowerCase();
  const filtered = availableVoices.filter((voice) => `${voice.name} ${voice.description}`.toLocaleLowerCase().includes(search));
  const visible = search || showAllVoices ? filtered : filtered.slice(0, 6);
  $("#voiceGallery").innerHTML = visible.map((voice) => `<div class="voice-card ${$("#ttsVoice").value === voice.id ? "is-selected" : ""}">
    <button type="button" class="voice-card-choice" data-voice-choice="${voice.id}" role="radio" aria-checked="${$("#ttsVoice").value === voice.id}"><strong>${escapeHtml(voice.name)}</strong><small>${escapeHtml(voice.description || "صدای انگلیسی")}</small></button>
    <button type="button" class="voice-card-listen" data-voice-listen="${voice.id}" aria-label="شنیدن نمونهٔ صدای ${escapeHtml(voice.name).replace(/"/g, "&quot;")}">▶ نمونه</button>
  </div>`).join("") || `<p>${availableVoices.length ? "صدایی با این جست‌وجو پیدا نشد." : "پس از اتصال Google، صداها اینجا نمایش داده می‌شوند."}</p>`;
  $("#voiceShowAll").hidden = Boolean(search || showAllVoices || filtered.length <= 6);
  if (!$("#voiceShowAll").hidden) $("#voiceShowAll").textContent = `نمایش همهٔ ${toFaDigits(filtered.length)} صدا`;
}

async function loadGoogleVoices() {
  const select = $("#ttsVoice");
  const former = select.value;
  const serial = ++voiceLoadSerial;
  select.replaceChildren(new Option("در حال بارگذاری صداها…", ""));
  $("#voiceGallery").innerHTML = "<p>در حال بارگذاری صداها…</p>";
  try {
    const gender = $("#ttsGender").value;
    const response = await googleApiRequest(`__voices?gender=${encodeURIComponent(gender)}`);
    const { voices } = await response.json();
    if (serial !== voiceLoadSerial) return;
    availableVoices = (voices || []).filter((voice) => /^[A-Za-z0-9_-]{2,120}$/.test(voice.id || "") && voice.name);
    showAllVoices = false;
    select.replaceChildren(new Option("انتخاب گوینده", ""), ...availableVoices.map((voice) => new Option(voice.name, voice.id)));
    if (former && [...select.options].some((item) => item.value === former)) select.value = former;
    renderVoiceGallery();
    if (select.options.length === 1) $("#ttsStatus").textContent = "صدایی برای این انتخاب پیدا نشد. نوع صدا را تغییر دهید یا اتصال API را بررسی کنید.";
  } catch (error) {
    if (serial !== voiceLoadSerial) return;
    select.replaceChildren(new Option("بارگذاری فهرست صدا ناموفق بود", ""));
    $("#ttsStatus").textContent = error.message;
    $("#voiceGallery").innerHTML = "<p>بارگذاری صداها ممکن نشد؛ اتصال Google را بررسی کنید.</p>";
  }
}

async function listenToVoice(voiceId) {
  const voice = availableVoices.find((item) => item.id === voiceId);
  if (!voice) return;
  const status = $("#voiceSampleStatus");
  const player = $("#voiceSamplePlayer");
  const model = $("#ttsModel").value;
  const cacheKey = `${model}:${voiceId}`;
  const serial = ++voicePreviewSerial;
  let evictedUrl = null;
  try {
    status.textContent = `در حال آماده‌سازی نمونهٔ ${voice.name}…`;
    let url = voiceSamples.get(cacheKey);
    if (!url) {
      const response = await googleApiRequest("__tts", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "This is how your next story could sound.", voice: voiceId,
          style: "warm and conversational, natural pace", model }) });
      const blob = await response.blob();
      if (blob.size < 44 || blob.type !== "audio/wav") throw new Error("نمونهٔ صدا دریافت نشد.");
      url = URL.createObjectURL(blob);
      if (voiceSamples.size >= 12) {
        const [oldKey, oldUrl] = voiceSamples.entries().next().value;
        voiceSamples.delete(oldKey);
        evictedUrl = oldUrl;
      }
      voiceSamples.set(cacheKey, url);
    }
    if (serial !== voicePreviewSerial) { if (evictedUrl) URL.revokeObjectURL(evictedUrl); return; }
    player.src = url;
    if (evictedUrl) URL.revokeObjectURL(evictedUrl);
    player.hidden = false;
    try { await player.play(); }
    catch (error) {
      if (error.name === "NotAllowedError") {
        status.textContent = `نمونهٔ ${voice.name} آماده است؛ دکمهٔ پخشِ زیر کارت‌ها را بزنید.`;
        return;
      }
      throw error;
    }
    status.textContent = `نمونهٔ ${voice.name} در حال پخش است. این درخواست ممکن است از سهمیهٔ Google شما استفاده کند.`;
  } catch (error) { if (serial === voicePreviewSerial) { status.textContent = error.message; showToast(error.message); } }
}

let generatedNarration = null;
async function generateNarration() {
  const button = $("#ttsGenerate"), status = $("#ttsStatus");
  const script = $("#ttsScript").value.trim();
  if (!script || script.length > 5000) return showToast("متن نریشن باید بین ۱ تا ۵۰۰۰ نویسه باشد.");
  const voice = $("#ttsVoice").value;
  if (!voice) return showToast("یک گوینده انتخاب کنید. کلید Google را در تنظیمات ثبت کنید.");
  const style = [$("#ttsTone").value, $("#ttsPace").value, $("#ttsStyle").value.trim()].filter(Boolean).join(", ");
  const createCaptions = $("#ttsWithCaptions").checked;
  button.disabled = true;
  status.textContent = "در حال ساخت صدای نریشن با Google…";
  try {
    const response = await googleApiRequest("__tts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, voice, style, model: $("#ttsModel").value }) });
    const blob = await response.blob();
    if (blob.size < 44 || blob.type !== "audio/wav") throw new Error("فایل WAV معتبری دریافت نشد.");
    const file = new File([blob], `Flow2Short-narration-${Date.now()}.wav`, { type: "audio/wav" });
    await setAudio("narration", file);
    if (state.narration?.file !== file) throw new Error("افزودن نریشن به پروژه ممکن نشد.");
    generatedNarration = file;
    const player = $("#ttsPlayer");
    player.src = state.narration.url;
    player.hidden = false;
    $("#ttsDownload").disabled = false;
    status.textContent = "صدا آماده است؛ همین حالا می‌توانید پخش یا دانلود کنید.";
    button.disabled = false;
    if (createCaptions) {
      status.textContent = "صدا آماده است. زمان‌بندی دقیق کلمات از روی همین صدای واقعی در حال انجام است…";
      generateCaptionsFromAudio(file, true).then((result) => {
        if (state.narration?.file !== file) return;
        status.textContent = result ? "صدا و هر دو نوع SRT آماده‌اند؛ زمان‌ها را در پیش‌نمایش بررسی کنید." : "صدا آماده است؛ ساخت زیرنویس کامل نشد. از بخش کناری دوباره تلاش کنید.";
      });
    }
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally { button.disabled = false; }
}

function removeMedia(kind) {
  if (state[kind]?.url) URL.revokeObjectURL(state[kind].url);
  state[kind] = null;
  state.remembered[kind] = null;
  $(`#${kind}Name`).textContent = "فایلی انتخاب نشده";
  $(`#${kind}Meta`).textContent = kind === "caption" ? "SRT کلمه‌به‌کلمه یا معمولی" : "MP3، WAV یا M4A";
  $(`[data-remove="${kind}"]`).hidden = true;
  $(`#${kind}Input`).value = "";
  if (kind === "caption") {
    refs.captionStylePreview.textContent = "YOUR NEXT BIG IDEA";
    updatePreviewCaption(state.preview.globalTime);
    renderCaptionEditor();
    $$('[data-download-caption]').forEach((button) => { button.disabled = true; });
  } else if (kind === "narration") {
    generatedNarration = null;
    $("#ttsDownload").disabled = true;
    $("#ttsPlayer").hidden = true;
  }
  updateSummary();
  saveDraft();
}

function getRecipe() {
  return {
    app: "Flow2Short Studio",
    version: 1,
    savedAt: new Date().toISOString(),
    project: {
      title: refs.projectTitle.value.trim(),
      clips: state.clips.map((clip) => ({
        name: clip.name,
        size: clip.file.size,
        start: clip.start,
        end: clip.end,
        duration: clip.duration,
        sourceAudioPercent: clip.volume,
        transition: clip.transition,
        transitionSeconds: clip.transitionSeconds,
      })),
      narration: state.narration ? { name: state.narration.file.name, size: state.narration.file.size, volume: Number($("#narrationVolume").value) } : state.remembered.narration,
      music: state.music ? { name: state.music.file.name, size: state.music.file.size, volume: Number($("#musicVolume").value) } : state.remembered.music,
      caption: state.caption ? { name: state.caption.file.name, size: state.caption.file.size, burn: $("#burnCaptions").checked, cues: state.caption.cues } : state.remembered.caption,
      captionStyle: { ...state.captionStyle },
      overlays: state.overlays.map(({ kind, text, name, sizeBytes, start, end, position, size, radius, x, y }) => ({ kind, text, name, sizeBytes, start, end, position, size, radius, x, y })),
      thumbnail: Object.fromEntries(["imageName", "logoName", "frameClip", "frameTime", "title", "titleSize", "titleColor", "titlePosition", "shade", "logoSource", "logoPosition", "logoSize", "ratio", "backgroundColor", "fit", "zoom", "panX", "panY", "subtitle", "textStyle", "textAlign", "logoRadius", "logoX", "logoY"]
        .map((key) => [key, state.thumbnail[key]])),
      audioMix: { ...state.audioMix },
      logo: state.logo ? { name: state.logo.file.name, size: state.logo.file.size } : state.remembered.logo,
      logoStyle: { ...state.logoStyle },
      output: {
        name: safeFileName(refs.outputName.value),
        resolution: refs.resolution.value,
        fitMode: refs.fitMode.value,
        quality: refs.quality.value,
      },
    },
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function saveProject() {
  const recipe = getRecipe();
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${safeFileName(refs.projectTitle.value || "Flow2Short-Project")}.flow2short.json`);
  showToast("فایل پروژه ذخیره شد؛ فایل‌های رسانه‌ای به‌دلیل حفظ حریم خصوصی داخل آن کپی نمی‌شوند.");
}

async function importProject(file) {
  try {
    const recipe = JSON.parse(await file.text());
    if (recipe?.app !== "Flow2Short Studio" || !recipe?.project) throw new Error("این فایل، پروژه معتبر Flow2Short نیست.");
    if (refs.mixPreviewDialog.open) closeMixPreview();
    closePreview();
    state.clips.forEach((clip) => URL.revokeObjectURL(clip.url));
    state.clips = [];
    renderClipCards();
    ["narration", "music", "caption"].forEach((kind) => removeMedia(kind));
    state.remembered = { narration: recipe.project.narration || null, music: recipe.project.music || null, caption: recipe.project.caption || null, logo: recipe.project.logo || null };
    refs.projectTitle.value = recipe.project.title || "پروژه Flow2Short";
    refs.outputName.value = recipe.project.output?.name || "YouTube-Short-Final";
    refs.resolution.value = recipe.project.output?.resolution || "1080";
    refs.fitMode.value = recipe.project.output?.fitMode || "cover";
    refs.quality.value = recipe.project.output?.quality || "balanced";
    $("#narrationVolume").value = recipe.project.narration?.volume ?? 100;
    $("#musicVolume").value = recipe.project.music?.volume ?? 18;
    $("#burnCaptions").checked = recipe.project.caption?.burn ?? true;
    state.captionStyle = { ...state.captionStyle, ...(recipe.project.captionStyle || {}) };
    state.audioMix = { duck: true, duckPercent: 30, fades: true, ...(recipe.project.audioMix || {}) };
    syncAudioMixControls();
    restoreOverlays(recipe.project.overlays);
    restoreThumbnail(recipe.project.thumbnail);
    removeLogo(false);
    state.remembered.logo = recipe.project.logo || null;
    state.logoStyle = { ...state.logoStyle, ...(recipe.project.logoStyle || {}) };
    applyLogoStyle();
    if (recipe.project.logo?.name) {
      $("#logoMeta").textContent = `برای این پروژه دوباره انتخاب کنید: ${recipe.project.logo.name}`;
      $("#previewLogoName").textContent = `لوگو را دوباره انتخاب کنید: ${recipe.project.logo.name}`;
    }
    applyCaptionStyle();
    refreshCaptionDisplay();
    setCaptionOffset(state.captionStyle.offsetMs, false);
    syncGlobalRanges();
    updateSummary();
    localStorage.setItem("flow2short-imported-recipe", JSON.stringify(recipe));
    if (state.settings.autosave) localStorage.setItem("flow2short-draft", JSON.stringify(recipe));
    showToast("تنظیمات پروژه باز شد. حالا فایل‌های رسانه‌ای هم‌نام را دوباره انتخاب کنید.");
    refs.dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showToast(error.message || "بازکردن پروژه ممکن نشد.");
  }
}

function saveDraft() {
  if (!state.settings.autosave) return;
  const draft = getRecipe();
  localStorage.setItem("flow2short-draft", JSON.stringify(draft));
}

function loadPreferences() {
  let rememberedLogoName = "";
  try {
    const settings = JSON.parse(localStorage.getItem("flow2short-settings") || "{}");
    state.settings = { ...state.settings, ...settings };
    $("#autosaveSetting").checked = state.settings.autosave;
    $("#leaveWarningSetting").checked = state.settings.leaveWarning;
    const draft = JSON.parse(localStorage.getItem("flow2short-draft") || "null");
    if (draft?.project) {
      state.remembered = { narration: draft.project.narration || null, music: draft.project.music || null, caption: draft.project.caption || null, logo: draft.project.logo || null };
      refs.projectTitle.value = draft.project.title || refs.projectTitle.value;
      refs.outputName.value = draft.project.output?.name || refs.outputName.value;
      refs.resolution.value = draft.project.output?.resolution || refs.resolution.value;
      refs.fitMode.value = draft.project.output?.fitMode || refs.fitMode.value;
      refs.quality.value = draft.project.output?.quality || refs.quality.value;
      $("#narrationVolume").value = draft.project.narration?.volume ?? 100;
      $("#musicVolume").value = draft.project.music?.volume ?? 18;
      $("#burnCaptions").checked = draft.project.caption?.burn ?? true;
      state.captionStyle = { ...state.captionStyle, ...(draft.project.captionStyle || {}) };
      state.audioMix = { ...state.audioMix, ...(draft.project.audioMix || {}) };
      restoreOverlays(draft.project.overlays);
      restoreThumbnail(draft.project.thumbnail);
      state.logoStyle = { ...state.logoStyle, ...(draft.project.logoStyle || {}) };
      if (draft.project.logo?.name) {
        rememberedLogoName = draft.project.logo.name;
        $("#logoMeta").textContent = `برای ادامه دوباره انتخاب کنید: ${draft.project.logo.name}`;
      }
    }
  } catch {
    localStorage.removeItem("flow2short-draft");
  }
  applyCaptionStyle();
  syncAudioMixControls();
  applyLogoStyle();
  thumbnailControls();
  if (rememberedLogoName) $("#previewLogoName").textContent = `لوگو را دوباره انتخاب کنید: ${rememberedLogoName}`;
  setCaptionOffset(state.captionStyle.offsetMs, false);
}

function syncAudioMixControls() {
  $("#autoDuck").checked = Boolean(state.audioMix.duck);
  $("#audioFades").checked = Boolean(state.audioMix.fades);
  $("#duckPercent").value = Math.max(10, Math.min(75, Number(state.audioMix.duckPercent) || 30));
  $("#duckPercentValue").textContent = `${toFaDigits($("#duckPercent").value)}٪`;
}

function setCaptionOffset(value, persist = true, editingInput = null) {
  const number = Number(value);
  const offset = Number.isFinite(number) ? Math.max(-60000, Math.min(60000, Math.round(number / 10) * 10)) : 0;
  state.captionStyle.offsetMs = offset;
  if (editingInput !== refs.captionOffsetMs) refs.captionOffsetMs.value = offset;
  if (editingInput !== refs.previewCaptionOffsetMs) refs.previewCaptionOffsetMs.value = offset;
  refs.captionSyncStatus.textContent = offset === 0
    ? "بدون جابه‌جایی زمانی"
    : `${toFaDigits(Math.abs(offset))} میلی‌ثانیه ${offset < 0 ? "زودتر" : "دیرتر"}`;
  updatePreviewCaption(state.preview.globalTime);
  if (persist) saveDraft();
}

function syncGlobalRanges() {
  for (const [id, valueId] of [["narrationVolume", "narrationVolumeValue"], ["musicVolume", "musicVolumeValue"]]) {
    const input = $(`#${id}`);
    $(`#${valueId}`).textContent = `${toFaDigits(input.value)}٪`;
    setRangeVisual(input);
  }
}

function updateRenderProgress(value, title, message) {
  const progress = Math.max(0, Math.min(1, value));
  const percentage = Math.round(progress * 100);
  refs.renderProgressBar.style.transform = `scaleX(${progress})`;
  refs.renderProgressRing.style.setProperty("--progress", `${percentage * 3.6}deg`);
  refs.renderPercent.textContent = `${toFaDigits(percentage)}٪`;
  if (title) refs.renderTitle.textContent = title;
  if (message) refs.renderMessage.textContent = message;
}

function addRenderLog(message) {
  const line = document.createElement("div");
  line.textContent = message;
  refs.renderLog.prepend(line);
}

async function fetchFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function ensureFFmpeg() {
  if (state.ffmpegLoaded && state.ffmpeg) return state.ffmpeg;
  if (location.protocol === "file:") {
    throw new Error("موتور ویدئو از فایل مستقیم اجرا نمی‌شود. برنامه را با لانچر Flow2Short باز کنید.");
  }

  updateRenderProgress(0.03, "در حال آماده‌سازی موتور ویدئو", "موتور FFmpeg به‌صورت محلی از داخل برنامه بارگذاری می‌شود.");
  const { FFmpeg } = await import(new URL("./vendor/ffmpeg/index.js", APP_BASE_URL).href);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (/error|invalid|failed/i.test(message)) addRenderLog(message.slice(0, 180));
  });
  state.ffmpeg = ffmpeg;
  await ffmpeg.load({
    classWorkerURL: new URL("./vendor/ffmpeg/worker.js", APP_BASE_URL).href,
    coreURL: new URL("./vendor/core/ffmpeg-core.js", APP_BASE_URL).href,
    wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", APP_BASE_URL).href,
  });
  state.ffmpegLoaded = true;
  return ffmpeg;
}

async function hasAudioStream(ffmpeg, inputName, token) {
  const output = `probe-${token}.txt`;
  try {
    await ffmpeg.ffprobe([
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      inputName,
      "-o", output,
    ]);
    const bytes = await ffmpeg.readFile(output);
    await ffmpeg.deleteFile(output).catch(() => {});
    return new TextDecoder().decode(bytes).trim().length > 0;
  } catch {
    return true;
  }
}

function extensionOf(file, fallback) {
  const match = file.name.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toLowerCase() : fallback;
}

function videoFilter(width, height, mode) {
  if (mode === "contain") {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0b1626,fps=30,format=yuv420p,setsar=1`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p,setsar=1`;
}

function encodeSettings() {
  const quality = refs.quality.value;
  if (quality === "high") return { crf: "20", preset: "veryfast", audio: "192k" };
  if (quality === "fast") return { crf: "28", preset: "ultrafast", audio: "128k" };
  return { crf: "24", preset: "veryfast", audio: "160k" };
}

async function cleanupFiles(ffmpeg, names) {
  for (const name of names) {
    try { await ffmpeg.deleteFile(name); } catch { /* already absent */ }
  }
}

function buildTransitionGraph(clips) {
  const parts = [];
  for (let index = 0; index < clips.length; index += 1) {
    const transition = selectedTransition(clips[index], clips[index + 1]);
    const padding = transition ? `,tpad=stop_mode=clone:stop_duration=${formatDecimal(transition.duration)}` : "";
    parts.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p${padding}[v${index}]`);
  }
  let previous = "[v0]";
  let offset = clipDuration(clips[0]);
  for (let index = 1; index < clips.length; index += 1) {
    const transition = selectedTransition(clips[index - 1], clips[index]);
    const output = `[chain${index}]`;
    if (transition) {
      parts.push(`${previous}[v${index}]xfade=transition=${TRANSITIONS[transition.type].ffmpeg}:duration=${formatDecimal(transition.duration)}:offset=${offset.toFixed(3)}${output}`);
    } else {
      parts.push(`${previous}[v${index}]concat=n=2:v=1:a=0${output}`);
    }
    previous = output;
    offset += clipDuration(clips[index]);
  }
  return { graph: parts.join(";"), output: previous, duration: offset };
}

async function renderVideo() {
  if (!state.clips.length || state.rendering) return;
  const missingImage = state.overlays.find((item) => item.kind === "image" && !item.file);
  if (missingImage) return showToast(`تصویر «${missingImage.name}» را دوباره انتخاب کنید.`);
  state.rendering = true;
  state.cancelled = false;
  refs.renderButton.disabled = true;
  refs.renderDialog.classList.remove("is-complete", "is-error");
  refs.cancelRenderButton.hidden = false;
  refs.downloadButton.hidden = true;
  refs.closeRenderButton.hidden = true;
  refs.renderLog.innerHTML = "";
  updateRenderProgress(0, "در حال آماده‌سازی", "فایل‌ها بررسی می‌شوند.");
  refs.renderDialog.showModal();

  const workingFiles = [];
  try {
    const ffmpeg = await ensureFFmpeg();
    const size = Number(refs.resolution.value);
    const width = size;
    const height = size === 720 ? 1280 : 1920;
    const settings = encodeSettings();
    const segmentNames = [];
    const sourceNames = new Map();
    const sourceAudio = new Map();
    const projectDuration = state.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
    const hasTransitions = state.clips.some((clip, index) => selectedTransition(clip, state.clips[index + 1]));
    const frameExact = state.clips.length > 1;

    for (let index = 0; index < state.clips.length; index += 1) {
      if (state.cancelled) throw new DOMException("پردازش لغو شد.", "AbortError");
      const clip = state.clips[index];
      let inputName = sourceNames.get(clip.file);
      if (!inputName) {
        inputName = `input-${sourceNames.size}.${extensionOf(clip.file, "mp4")}`;
        sourceNames.set(clip.file, inputName);
        workingFiles.push(inputName);
        await ffmpeg.writeFile(inputName, await fetchFileBytes(clip.file));
        sourceAudio.set(inputName, await hasAudioStream(ffmpeg, inputName, sourceNames.size));
      }
      const segmentName = `segment-${String(index).padStart(2, "0")}.mp4`;
      workingFiles.push(segmentName);
      segmentNames.push(segmentName);

      updateRenderProgress(
        0.08 + (index / state.clips.length) * 0.55,
        `آماده‌سازی کلیپ ${toFaDigits(index + 1)} از ${toFaDigits(state.clips.length)}`,
        clip.name,
      );
      const hasAudio = sourceAudio.get(inputName);
      const duration = clipDuration(clip);
      const args = ["-ss", formatDecimal(clip.start), "-t", formatDecimal(duration), "-i", inputName];

      if (hasAudio) {
        args.push(
          "-filter_complex", `[0:v]${videoFilter(width, height, refs.fitMode.value)}[v];[0:a]volume=${(clip.volume / 100).toFixed(2)},aresample=48000,asetpts=PTS-STARTPTS[a]`,
          "-map", "[v]", "-map", "[a]",
        );
      } else {
        args.push(
          "-f", "lavfi", "-t", formatDecimal(duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-filter_complex", `[0:v]${videoFilter(width, height, refs.fitMode.value)}[v]`,
          "-map", "[v]", "-map", "1:a:0",
        );
      }

      args.push(
        "-c:v", "libx264", "-preset", settings.preset, "-crf", settings.crf,
        "-c:a", "aac", "-b:a", settings.audio, "-ar", "48000", "-ac", "2",
        "-t", formatDecimal(duration), "-movflags", "+faststart", segmentName,
      );
      const result = await ffmpeg.exec(args);
      if (result !== 0) throw new Error(`پردازش کلیپ ${index + 1} کامل نشد.`);
    }
    await cleanupFiles(ffmpeg, [...sourceNames.values()]);

    if (frameExact) {
      if (state.cancelled) throw new DOMException("پردازش لغو شد.", "AbortError");
      updateRenderProgress(0.65, hasTransitions ? "ساخت ترنزیشن‌ها" : "اتصال دقیق کلیپ‌ها", "تصویر و صدا با زمان‌بندی دقیق متصل می‌شوند.");
      const { graph, output, duration } = buildTransitionGraph(state.clips);
      workingFiles.push("transitioned.mp4", "joined-audio.m4a");
      const transitionArgs = segmentNames.flatMap((name) => ["-i", name]);
      transitionArgs.push("-filter_complex", graph, "-map", output, "-an", "-c:v", "libx264", "-preset", settings.preset, "-crf", settings.crf, "-r", "30", "-t", formatDecimal(duration), "-movflags", "+faststart", "transitioned.mp4");
      const transitionResult = await ffmpeg.exec(transitionArgs);
      if (transitionResult !== 0) throw new Error("اتصال تصویری کلیپ‌ها کامل نشد. گزارش فنی را بررسی کنید.");
      if (state.cancelled) throw new DOMException("پردازش لغو شد.", "AbortError");
      updateRenderProgress(0.72, "هماهنگ‌سازی صدای کلیپ‌ها", "صدا دقیقاً روی مرز برش‌ها قرار می‌گیرد.");
      const audioParts = state.clips.map((clip, index) => `[${index}:a]atrim=duration=${formatDecimal(clipDuration(clip))},asetpts=PTS-STARTPTS[clipAudio${index}]`);
      audioParts.push(`${state.clips.map((_, index) => `[clipAudio${index}]`).join("")}concat=n=${state.clips.length}:v=0:a=1[clipAudioOut]`);
      const audioArgs = [...segmentNames.flatMap((name) => ["-i", name]), "-filter_complex", audioParts.join(";"), "-map", "[clipAudioOut]", "-c:a", "aac", "-b:a", settings.audio, "-ar", "48000", "-ac", "2", "-t", formatDecimal(projectDuration), "joined-audio.m4a"];
      if (await ffmpeg.exec(audioArgs) !== 0) throw new Error("اتصال صدای کلیپ‌ها کامل نشد.");
    } else {
      const concatList = segmentNames.map((name) => `file '${name}'`).join("\n");
      await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));
      workingFiles.push("concat.txt", "joined.mp4");
      updateRenderProgress(0.65, "اتصال کلیپ‌ها", "تصویر و صدا آماده می‌شوند.");
      const concatResult = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "joined.mp4"]);
      if (concatResult !== 0) throw new Error("اتصال کلیپ‌ها کامل نشد.");
    }
    await cleanupFiles(ffmpeg, [...segmentNames, "concat.txt"]);

    const audioSourceIndex = frameExact ? 1 : 0;
    const finalArgs = frameExact ? ["-i", "transitioned.mp4", "-i", "joined-audio.m4a"] : ["-i", "joined.mp4"];
    const audioLabels = ["[a0]"];
    const filterParts = [`[${audioSourceIndex}:a]volume=1,aresample=48000[a0]`];
    let inputIndex = audioSourceIndex + 1;

    if (state.narration) {
      const name = `narration.${extensionOf(state.narration.file, "mp3")}`;
      await ffmpeg.writeFile(name, await fetchFileBytes(state.narration.file));
      workingFiles.push(name);
      finalArgs.push("-i", name);
      filterParts.push(`[${inputIndex}:a]volume=${(Number($("#narrationVolume").value) / 100).toFixed(2)},aresample=48000[a${inputIndex}]`);
      audioLabels.push(`[a${inputIndex}]`);
      inputIndex += 1;
    }

    if (state.music) {
      const name = `music.${extensionOf(state.music.file, "mp3")}`;
      await ffmpeg.writeFile(name, await fetchFileBytes(state.music.file));
      workingFiles.push(name);
      finalArgs.push("-stream_loop", "-1", "-i", name);
      let musicFilter = `[${inputIndex}:a]volume=${(Number($("#musicVolume").value) / 100).toFixed(2)},aresample=48000`;
      if (state.audioMix.duck && state.narration?.duration) {
        const activity = `max(0,min(1,min(t/0.25,(${state.narration.duration.toFixed(3)}-t)/0.25)))`;
        musicFilter += `,volume='1-(1-${(state.audioMix.duckPercent / 100).toFixed(2)})*${activity}':eval=frame`;
      }
      if (state.audioMix.fades) {
        musicFilter += `,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, projectDuration - 0.5).toFixed(3)}:d=0.5`;
      }
      filterParts.push(`${musicFilter}[a${inputIndex}]`);
      audioLabels.push(`[a${inputIndex}]`);
      inputIndex += 1;
    }

    const burnCaptions = Boolean(state.caption && $("#burnCaptions").checked);
    if (state.caption) {
      await ffmpeg.writeFile("captions.ass", new TextEncoder().encode(buildAssCaptions(width, height)));
      const subtitleFont = new Uint8Array(await fetch(new URL("./vendor/fonts/DejaVuSans.ttf", APP_BASE_URL)).then((response) => response.arrayBuffer()));
      await ffmpeg.writeFile("DejaVuSans.ttf", subtitleFont);
      workingFiles.push("captions.ass", "DejaVuSans.ttf");
    }

    let logoInfo = null;
    let logoInputIndex = -1;
    if (state.logo) {
      logoInfo = await logoPngBytes(width, height);
      logoInputIndex = inputIndex;
      await ffmpeg.writeFile("logo.png", logoInfo.bytes);
      workingFiles.push("logo.png");
      finalArgs.push("-loop", "1", "-framerate", "30", "-i", "logo.png");
      inputIndex += 1;
    }

    const overlayInputs = [];
    for (const [index, item] of state.overlays.entries()) {
      if (item.kind === "image" && !item.file) throw new Error(`تصویر «${item.name}» را در بخش متن و تصویر دوباره انتخاب کنید.`);
      if (item.end <= 0 || item.start >= projectDuration) continue;
      const png = await overlayPngBytes(item, width, height);
      const name = `overlay-${index}.png`;
      await ffmpeg.writeFile(name, png.bytes);
      workingFiles.push(name);
      finalArgs.push("-loop", "1", "-framerate", "30", "-i", name);
      overlayInputs.push({ item, inputIndex, width: png.width, height: png.height });
      inputIndex += 1;
    }

    const output = "final.mp4";
    workingFiles.push(output);
    const buildFinalArgs = (withCaptions) => {
      const args = [...finalArgs];
      const parts = audioLabels.length > 1
        ? [...filterParts, `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95[aout]`]
        : [];
      let source = "[0:v]";
      if (withCaptions) {
        parts.push(`${source}subtitles=captions.ass:fontsdir=.[captioned]`);
        source = "[captioned]";
      }
      if (logoInfo) {
        const { x, y } = logoCoordinates(width, height, logoInfo.width, logoInfo.height);
        parts.push(`${source}[${logoInputIndex}:v]overlay=${x}:${y}:shortest=1:format=auto[visualLogo]`);
        source = "[visualLogo]";
      }
      for (const [index, overlay] of overlayInputs.entries()) {
        const { item, inputIndex: imageIndex, width: imageWidth, height: imageHeight } = overlay;
        const x = Math.round(width * item.x - imageWidth / 2);
        const y = Math.round(height * item.y - imageHeight / 2);
        const destination = `[visual${index}]`;
        parts.push(`${source}[${imageIndex}:v]overlay=${x}:${y}:enable='between(t,${item.start.toFixed(3)},${item.end.toFixed(3)})':shortest=1:format=auto${destination}`);
        source = destination;
      }
      if (parts.length) args.push("-filter_complex", parts.join(";"));
      args.push("-map", source === "[0:v]" ? "0:v:0" : source, "-map", audioLabels.length > 1 ? "[aout]" : `${audioSourceIndex}:a:0`);
      if (withCaptions || logoInfo || overlayInputs.length) args.push("-c:v", "libx264", "-preset", settings.preset, "-crf", settings.crf);
      else args.push("-c:v", "copy");
      args.push("-c:a", "aac", "-b:a", settings.audio, "-ar", "48000", "-movflags", "+faststart", "-shortest", "-t", formatDecimal(projectDuration), output);
      return args;
    };

    updateRenderProgress(0.76, "میکس صدا و ساخت خروجی", logoInfo ? "لوگو روی تمام تصویرها قرار می‌گیرد." : burnCaptions ? "زیرنویس روی تصویر تثبیت می‌شود." : "صداهای انتخاب‌شده میکس می‌شوند.");
    const finalResult = await ffmpeg.exec(buildFinalArgs(burnCaptions));
    if (finalResult !== 0) throw new Error(burnCaptions
      ? "تثبیت زیرنویس در خروجی انجام نشد؛ خروجی ناقص ارائه نمی‌شود. گزارش فنی را بررسی کنید."
      : "ساخت فایل نهایی کامل نشد. گزارش فنی را بررسی کنید.");
    updateRenderProgress(0.96, "در حال آماده‌سازی دانلود", "فایل نهایی از حافظه پردازش خوانده می‌شود.");
    const outputData = await ffmpeg.readFile(output);
    const blob = new Blob([outputData.buffer], { type: "video/mp4" });
    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    state.outputUrl = URL.createObjectURL(blob);
    refs.downloadButton.dataset.filename = `${safeFileName(refs.outputName.value)}.mp4`;
    refs.downloadButton.dataset.url = state.outputUrl;
    refs.renderDialog.classList.add("is-complete");
    refs.cancelRenderButton.hidden = true;
    refs.downloadButton.hidden = false;
    refs.closeRenderButton.hidden = false;
    updateRenderProgress(1, "ویدئوی نهایی آماده است", `${formatBytes(blob.size)} · فایل را دانلود و قبل از انتشار یک‌بار بازبینی کنید.`);
    addRenderLog(logoInfo ? `خروجی با لوگو${burnCaptions ? " و زیرنویس تصویری" : ""} ساخته شد.` : burnCaptions ? "خروجی همراه زیرنویس تصویری ساخته شد." : "خروجی آماده شد.");
    await cleanupFiles(ffmpeg, workingFiles);
  } catch (error) {
    if (error.name === "AbortError" || state.cancelled) {
      refs.renderTitle.textContent = "پردازش لغو شد";
      refs.renderMessage.textContent = "فایل‌های اصلی شما بدون تغییر باقی مانده‌اند.";
    } else {
      refs.renderDialog.classList.add("is-error");
      refs.renderTitle.textContent = "ساخت ویدئو کامل نشد";
      refs.renderMessage.textContent = error.message || "حافظه دستگاه یا فرمت یکی از فایل‌ها مانع پردازش شد.";
      addRenderLog(error.stack || error.message || String(error));
    }
    refs.cancelRenderButton.hidden = true;
    refs.closeRenderButton.hidden = false;
  } finally {
    if (state.ffmpegLoaded && state.ffmpeg) await cleanupFiles(state.ffmpeg, workingFiles);
    state.rendering = false;
    updateSummary();
  }
}

function wireDragAndDrop() {
  ["dragenter", "dragover"].forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      refs.dropZone.classList.remove("is-dragging");
    });
  });
  refs.dropZone.addEventListener("drop", (event) => addClips(event.dataTransfer.files));

  let draggedId = null;
  refs.clipList.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".clip-card");
    if (!card) return;
    draggedId = card.dataset.id;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  refs.clipList.addEventListener("dragend", () => {
    $$(".clip-card", refs.clipList).forEach((card) => card.classList.remove("is-dragging", "is-drop-target"));
    draggedId = null;
  });
  refs.clipList.addEventListener("dragover", (event) => {
    event.preventDefault();
    const card = event.target.closest(".clip-card");
    $$(".clip-card", refs.clipList).forEach((item) => item.classList.toggle("is-drop-target", item === card && item.dataset.id !== draggedId));
  });
  refs.clipList.addEventListener("drop", (event) => {
    event.preventDefault();
    const target = event.target.closest(".clip-card");
    if (!target || !draggedId || target.dataset.id === draggedId) return;
    const from = state.clips.findIndex((clip) => clip.id === draggedId);
    const to = state.clips.findIndex((clip) => clip.id === target.dataset.id);
    const [moved] = state.clips.splice(from, 1);
    state.clips.splice(to, 0, moved);
    renderClipCards();
    saveDraft();
  });
}

function wireStepNavigation() {
  const sections = $$(".workspace-section");
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    $$(".step-link").forEach((link) => link.classList.toggle("is-active", link.dataset.step === visible.target.id));
  }, { rootMargin: "-25% 0px -55% 0px", threshold: [0.05, 0.3, 0.6] });
  sections.forEach((section) => observer.observe(section));
}

function wireEvents() {
  refs.dropZone.addEventListener("click", () => refs.clipInput.click());
  refs.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      refs.clipInput.click();
    }
  });
  refs.clipInput.addEventListener("change", (event) => addClips(event.target.files));
  $("#closePreview").addEventListener("click", closePreview);
  $("#sampleButton").addEventListener("click", () => {
    if (state.clips.length) openPreview(state.clips[0]);
    else {
      refs.dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("برای دیدن پیش‌نمایش، ابتدا یک کلیپ اضافه کنید.");
    }
  });

  refs.clipList.addEventListener("input", handleClipField);
  refs.clipList.addEventListener("change", handleClipField);
  refs.clipList.addEventListener("click", (event) => {
    const card = event.target.closest(".clip-card");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!card || !action) return;
    if (action === "preview") openPreview(state.clips.find((clip) => clip.id === card.dataset.id));
    if (action === "split" || action === "join") {
      const index = state.clips.findIndex((clip) => clip.id === card.dataset.id);
      if (action === "split") splitClip(index, Number($("[data-field=splitAt]", card).value));
      else joinClip(index);
    }
    if (action === "preview-transition") {
      const index = state.clips.findIndex((clip) => clip.id === card.dataset.id);
      const boundary = state.clips.slice(0, index + 1).reduce((sum, clip) => sum + clipDuration(clip), 0);
      prepareTransitionFreeze(state.clips[index]).catch(() => {});
      openMixPreview(Math.max(0, boundary - 0.2)).catch((error) => showToast(error.message));
    }
    if (action === "up") moveClip(card.dataset.id, -1);
    if (action === "down") moveClip(card.dataset.id, 1);
    if (action === "delete") deleteClip(card.dataset.id);
  });
  $("#editTimeline").addEventListener("click", (event) => {
    const button = event.target.closest("[data-timeline-time]");
    if (button) openMixPreview(Number(button.dataset.timelineTime)).catch((error) => showToast(error.message));
  });

  $$('[data-pick="narration"], [data-pick="music"], [data-pick="caption"]').forEach((button) => {
    button.addEventListener("click", () => $(`#${button.dataset.pick}Input`).click());
  });
  refs.narrationInput.addEventListener("change", (event) => setAudio("narration", event.target.files[0]));
  refs.musicInput.addEventListener("change", (event) => setAudio("music", event.target.files[0]));
  refs.captionInput.addEventListener("change", (event) => setCaption(event.target.files[0]));
  $("#transcribeFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    $("#transcribeFileName").textContent = file ? `فایل انتخابی: ${file.name}` : "اگر نریشن ندارید، اینجا فایل صدا انتخاب کنید.";
    if (file) $("#transcribeSource").value = "file";
  });
  $("#transcribeButton").addEventListener("click", () => generateCaptionsFromAudio());
  $("#ttsGender").addEventListener("change", loadGoogleVoices);
  $("#voiceSearch").addEventListener("input", renderVoiceGallery);
  $("#voiceShowAll").addEventListener("click", () => { showAllVoices = true; renderVoiceGallery(); });
  $("#voiceGallery").addEventListener("click", (event) => {
    const choice = event.target.closest("[data-voice-choice]");
    const listen = event.target.closest("[data-voice-listen]");
    if (choice) {
      $("#ttsVoice").value = choice.dataset.voiceChoice;
      renderVoiceGallery();
    }
    if (listen) listenToVoice(listen.dataset.voiceListen);
  });
  $("#ttsGenerate").addEventListener("click", generateNarration);
  $("#ttsDownload").addEventListener("click", () => {
    if (generatedNarration) downloadBlob(generatedNarration, generatedNarration.name);
  });
  $("#googleSaveKey").addEventListener("click", async () => {
    const field = $("#googleApiKey");
    try {
      await googleApiRequest("__google_config", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.value.trim() }) });
      field.value = "";
      await refreshGoogleConnection();
    } catch (error) { $("#googleKeyStatus").textContent = error.message; }
  });
  $("#googleRemoveKey").addEventListener("click", async () => {
    try { await googleApiRequest("__google_config", { method: "DELETE" }); await refreshGoogleConnection(); }
    catch (error) { $("#googleKeyStatus").textContent = error.message; }
  });
  $("#captionAddCue").addEventListener("click", () => {
    if (!state.caption) return showToast("ابتدا فایل SRT وارد کنید.");
    const start = Math.max(0, state.preview.globalTime || state.caption.cues.at(-1)?.end || 0);
    state.caption.cues.push({ start, end: start + 0.5, text: "New text" });
    state.caption.cues.sort((a, b) => a.start - b.start);
    refreshCaptionDisplay();
    saveDraft();
  });
  $("#captionDownloadSrt").addEventListener("click", () => downloadEditedSrt(false));
  $("#captionDownloadStandardSrt").addEventListener("click", () => downloadEditedSrt(true));
  $$('[data-download-caption]').forEach((button) => button.addEventListener("click", () => downloadEditedSrt(button.dataset.downloadCaption === "standard")));
  $("#addOverlay").addEventListener("click", () => {
    const file = $("#overlayImage").files[0] || null;
    const text = $("#overlayText").value.trim();
    const start = Number($("#overlayStart").value);
    const end = Number($("#overlayEnd").value);
    if (!file && !text) return showToast("متن یا تصویر را انتخاب کنید.");
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return showToast("پایان لایه باید بعد از شروع آن باشد.");
    if (file && !/^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type)) return showToast("برای تصویر از PNG، JPG یا WebP استفاده کنید.");
    state.overlays.push({ id: uid(), kind: file ? "image" : "text", text, file,
      name: file?.name || "", sizeBytes: file?.size || 0, url: file ? URL.createObjectURL(file) : null,
      start, end, position: $("#overlayPosition").value,
      x: 0.5, y: $("#overlayPosition").value === "bottom" ? 0.68 : $("#overlayPosition").value === "center" ? 0.5 : 0.22,
      size: Number($("#overlaySize").value),
      radius: file ? Number($("#overlayRadius").value) : 0 });
    $("#overlayText").value = "";
    $("#overlayImage").value = "";
    if (overlayInspectorUrl) URL.revokeObjectURL(overlayInspectorUrl);
    overlayInspectorUrl = null;
    updateOverlayInspector();
    renderOverlays();
    saveDraft();
  });
  $("#overlayList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-overlay-action]");
    const row = button?.closest("[data-overlay-id]");
    if (!row) return;
    const item = state.overlays.find((overlay) => overlay.id === row.dataset.overlayId);
    if (!item) return;
    if (button.dataset.overlayAction === "delete") {
      if (item.url) URL.revokeObjectURL(item.url);
      state.overlays = state.overlays.filter((overlay) => overlay !== item);
      renderOverlays();
      saveDraft();
    } else {
      if (!state.clips.length) return showToast("برای دیدن محل لایه روی ویدئو، ابتدا یک کلیپ اضافه کنید.");
      openMixPreview(item.start).then(() => {
      $("#previewLayerSelect").value = item.id;
      updatePreviewLayerSliders();
      if (item.kind === "image") {
        $("#previewOverlaySelect").value = item.id;
        $("#previewOverlayRadius").value = item.radius;
        $("#previewOverlayRadiusValue").textContent = `${toFaDigits(item.radius)}٪`;
      }
      }).catch((error) => showToast(error.message));
    }
  });
  $("#overlayList").addEventListener("change", (event) => {
    if (!event.target.matches("[data-overlay-relink]")) return;
    const file = event.target.files[0];
    const item = state.overlays.find((overlay) => overlay.id === event.target.closest("[data-overlay-id]").dataset.overlayId);
    if (!file || !item) return;
    if (!/^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type)) return showToast("فرمت تصویر پشتیبانی نمی‌شود.");
    if ((item.name && file.name !== item.name) || (item.sizeBytes && file.size !== item.sizeBytes)) return showToast(`فایل اصلی «${item.name}» را انتخاب کنید.`);
    item.file = file;
    item.url = URL.createObjectURL(file);
    item.name = file.name;
    item.sizeBytes = file.size;
    renderOverlays();
    saveDraft();
  });
  $("#overlayList").addEventListener("change", (event) => {
    const field = event.target.dataset.overlayField;
    if (!field) return;
    const item = state.overlays.find((overlay) => overlay.id === event.target.closest("[data-overlay-id]")?.dataset.overlayId);
    if (!item) return;
    const value = ["start", "end", "size", "radius"].includes(field) ? Number(event.target.value) : event.target.value.trim();
    const updated = { ...item, [field]: value };
    if (!Number.isFinite(updated.start) || !Number.isFinite(updated.end) || updated.start < 0 || updated.end <= updated.start || (updated.kind === "text" && !updated.text)) {
      event.target.value = item[field];
      return showToast("زمان‌بندی یا متن لایه معتبر نیست.");
    }
    item[field] = value;
    renderOverlays();
    saveDraft();
  });
  $("#overlayRadius").addEventListener("input", (event) => {
    $("#overlayRadiusValue").textContent = Number(event.target.value) ? `${toFaDigits(event.target.value)}٪` : "۰٪ · بدون گردی";
    setRangeVisual(event.target);
    updateOverlayInspector();
  });
  $("#overlayImage").addEventListener("change", () => {
    if (overlayInspectorUrl) URL.revokeObjectURL(overlayInspectorUrl);
    overlayInspectorUrl = null;
    updateOverlayInspector();
  });
  $("#overlayPreviewOpen").addEventListener("click", () => {
    const first = state.overlays.find((item) => item.kind === "image" && item.file);
    if (!first) return showToast("برای دیدن در ویدئو، تصویر را با دکمهٔ افزودن لایه ثبت کنید.");
    openMixPreview(first.start).catch((error) => showToast(error.message));
  });
  $("#previewOverlaySelect").addEventListener("change", (event) => {
    const item = state.overlays.find((overlay) => overlay.id === event.target.value);
    if (!item) return;
    $("#previewOverlayRadius").value = item.radius;
    $("#previewOverlayRadiusValue").textContent = `${toFaDigits(item.radius)}٪`;
    setRangeVisual($("#previewOverlayRadius"));
    loadMixPreviewAt(item.start, false).catch((error) => showToast(error.message));
  });
  $("#previewOverlayRadius").addEventListener("input", (event) => {
    const item = state.overlays.find((overlay) => overlay.id === $("#previewOverlaySelect").value);
    if (!item) return;
    item.radius = Number(event.target.value);
    $("#previewOverlayRadiusValue").textContent = `${toFaDigits(item.radius)}٪`;
    setRangeVisual(event.target);
    const row = $(`[data-overlay-id="${item.id}"] [data-overlay-field="radius"]`);
    if (row) { row.value = item.radius; row.nextElementSibling.textContent = `${toFaDigits(item.radius)}٪`; }
    state.preview.overlaysKey = "";
    updatePreviewOverlays(state.preview.globalTime);
  });
  $("#previewOverlayRadius").addEventListener("change", saveDraft);
  $("#previewLayerSelect").addEventListener("change", (event) => {
    const item = state.overlays.find((overlay) => overlay.id === event.target.value);
    if (!item) return;
    updatePreviewLayerSliders();
    loadMixPreviewAt(item.start, false).catch((error) => showToast(error.message));
  });
  for (const axis of ["X", "Y"]) {
    const input = $(`#previewLayer${axis}`);
    input.addEventListener("input", () => {
      const item = state.overlays.find((overlay) => overlay.id === $("#previewLayerSelect").value);
      if (!item) return;
      item[axis.toLowerCase()] = Number(input.value) / 100;
      $(`#previewLayer${axis}Value`).textContent = `${toFaDigits(input.value)}٪`;
      setRangeVisual(input);
      updatePreviewOverlays(state.preview.globalTime);
    });
    input.addEventListener("change", saveDraft);
  }
  let layerDrag = null;
  $("#mixPreviewOverlays").addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-free-position] img, [data-free-position] span");
    const element = target?.closest("[data-overlay-id]");
    const item = state.overlays.find((overlay) => overlay.id === element?.dataset.overlayId);
    if (!item) return;
    pauseMixPreview();
    layerDrag = { target, element, item };
    target.setPointerCapture(event.pointerId);
    $("#previewLayerSelect").value = item.id;
    updatePreviewLayerSliders();
    event.preventDefault();
  });
  $("#mixPreviewOverlays").addEventListener("pointermove", (event) => {
    if (!layerDrag) return;
    const rect = refs.mixPreviewStage.getBoundingClientRect();
    layerDrag.item.x = Math.max(.05, Math.min(.95, (event.clientX - rect.left) / rect.width));
    layerDrag.item.y = Math.max(.05, Math.min(.95, (event.clientY - rect.top) / rect.height));
    layerDrag.element.style.setProperty("--overlay-x", `${layerDrag.item.x * 100}%`);
    layerDrag.element.style.setProperty("--overlay-y", `${layerDrag.item.y * 100}%`);
    const visible = state.overlays.filter((item) => state.preview.globalTime >= item.start && state.preview.globalTime < item.end && (item.kind === "text" || item.url));
    state.preview.overlaysKey = visible.map((item) => `${item.id}:${item.radius}:${item.size}:${item.x}:${item.y}`).join(":");
    updatePreviewLayerSliders();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    $("#mixPreviewOverlays").addEventListener(type, () => { if (layerDrag) saveDraft(); layerDrag = null; });
  }
  $("#overlayList").addEventListener("input", (event) => {
    if (event.target.dataset.overlayField !== "radius") return;
    const item = state.overlays.find((overlay) => overlay.id === event.target.closest("[data-overlay-id]")?.dataset.overlayId);
    if (!item) return;
    item.radius = Number(event.target.value);
    event.target.nextElementSibling.textContent = `${toFaDigits(item.radius)}٪`;
    state.preview.overlaysKey = "";
    updatePreviewOverlays(state.preview.globalTime);
    saveDraft();
  });
  $("#thumbnailImage").addEventListener("change", (event) => chooseThumbnailBitmap(event.target.files[0], "background"));
  $("#thumbnailClearImage").addEventListener("click", () => {
    state.thumbnail.background?.close();
    state.thumbnail.background = null;
    state.thumbnail.imageName = "";
    state.thumbnail.frameClip = "";
    $("#thumbnailImage").value = "";
    $("#thumbnailHint").textContent = "عکس پس‌زمینه حذف شد؛ می‌توانید یک فریم یا عکس تازه انتخاب کنید.";
    drawThumbnail();
    saveDraft();
  });
  $("#thumbnailCapture").addEventListener("click", captureThumbnailFrame);
  $("#thumbnailLogoInput").addEventListener("change", (event) => chooseThumbnailBitmap(event.target.files[0], "logo"));
  $("#thumbnailResetPhoto").addEventListener("click", () => {
    state.thumbnail.panX = 0; state.thumbnail.panY = 0;
    $("#thumbnailZoom").value = "100";
    thumbnailControls(); saveDraft();
  });
  const thumbnailCanvas = $("#thumbnailCanvas");
  const thumbnailPresets = {
    clear: { Shade: "16", TitleSize: "70", TitleColor: "#ffffff", TextStyle: "outline" },
    focus: { Shade: "36", TitleSize: "76", TitleColor: "#ffffff", TextStyle: "box" },
    bold: { Shade: "55", TitleSize: "100", TitleColor: "#ffdc42", TextStyle: "outline" },
  };
  $$('[data-thumbnail-preset]').forEach((button) => button.addEventListener("click", () => {
    const preset = thumbnailPresets[button.dataset.thumbnailPreset];
    for (const [name, value] of Object.entries(preset)) $(`#thumbnail${name}`).value = value;
    $$('[data-thumbnail-preset]').forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    thumbnailControls(); saveDraft();
  }));
  let thumbnailDragMode = "photo";
  $$('[data-thumbnail-drag]').forEach((button) => button.addEventListener("click", () => {
    thumbnailDragMode = button.dataset.thumbnailDrag;
    $$('[data-thumbnail-drag]').forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    $("#thumbnailDragHelp").textContent = thumbnailDragMode === "logo"
      ? "لوگو را روی قاب بکشید؛ گردی و اندازه را از کنترل‌های سمت راست تنظیم کنید."
      : "عکس را روی قاب بکشید تا جای آن عوض شود.";
  }));
  let photoDrag = null;
  thumbnailCanvas.addEventListener("pointerdown", (event) => {
    const logo = state.thumbnail.logoSource === "watermark" ? state.logo?.bitmap : state.thumbnail.logoSource === "file" ? state.thumbnail.logo : null;
    if (thumbnailDragMode === "logo" && !logo) return showToast("ابتدا یک لوگو برای کاور انتخاب کنید.");
    if (thumbnailDragMode === "photo" && !state.thumbnail.background) return showToast("ابتدا عکس یا فریم کاور را انتخاب کنید.");
    photoDrag = { mode: thumbnailDragMode, x: event.clientX, y: event.clientY,
      panX: state.thumbnail.panX, panY: state.thumbnail.panY,
      logoX: state.thumbnail.logoX, logoY: state.thumbnail.logoY };
    thumbnailCanvas.setPointerCapture(event.pointerId);
  });
  thumbnailCanvas.addEventListener("pointermove", (event) => {
    if (!photoDrag) return;
    const bounds = thumbnailCanvas.getBoundingClientRect();
    if (photoDrag.mode === "logo") {
      state.thumbnail.logoX = Math.max(.05, Math.min(.95, photoDrag.logoX + (event.clientX - photoDrag.x) / bounds.width));
      state.thumbnail.logoY = Math.max(.05, Math.min(.95, photoDrag.logoY + (event.clientY - photoDrag.y) / bounds.height));
      for (const axis of ["X", "Y"]) {
        const input = $(`#thumbnailLogo${axis}`);
        input.value = Math.round(state.thumbnail[`logo${axis}`] * 100);
        $(`#thumbnailLogo${axis}Value`).textContent = `${toFaDigits(input.value)}٪`;
        setRangeVisual(input);
      }
      $("#thumbnailLogoPosition").value = "custom";
      state.thumbnail.logoPosition = "custom";
      drawThumbnail();
      return;
    }
    if (!state.thumbnail.background) return;
    const { width, height } = thumbnailCanvas;
    const image = state.thumbnail.background;
    const scale = (state.thumbnail.fit === "contain" ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height)) * state.thumbnail.zoom / 100;
    const slackX = Math.abs(width - image.width * scale) / 2;
    const slackY = Math.abs(height - image.height * scale) / 2;
    state.thumbnail.panX = slackX ? Math.max(-1, Math.min(1, photoDrag.panX + (event.clientX - photoDrag.x) * width / bounds.width / slackX)) : 0;
    state.thumbnail.panY = slackY ? Math.max(-1, Math.min(1, photoDrag.panY + (event.clientY - photoDrag.y) * height / bounds.height / slackY)) : 0;
    drawThumbnail();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) thumbnailCanvas.addEventListener(type, () => { if (photoDrag) saveDraft(); photoDrag = null; });
  for (const name of ["Title", "TitleSize", "TitleColor", "TitlePosition", "Shade", "LogoSource", "LogoPosition", "LogoSize", "LogoRadius", "LogoX", "LogoY", "Ratio", "BackgroundColor", "Fit", "Zoom", "Subtitle", "TextStyle", "TextAlign"]) {
    const input = $("#thumbnail" + name);
    input.addEventListener(["Title", "Subtitle", "TitleSize", "Shade", "LogoSize", "LogoRadius", "LogoX", "LogoY", "Zoom", "TitleColor", "BackgroundColor"].includes(name) ? "input" : "change", () => {
      if (["TitleSize", "Shade", "TitleColor", "TextStyle"].includes(name)) $$('[data-thumbnail-preset]').forEach((option) => option.setAttribute("aria-pressed", "false"));
      if (name === "LogoPosition" && input.value !== "custom") {
        $("#thumbnailLogoX").value = input.value.endsWith("right") ? "90" : "10";
        $("#thumbnailLogoY").value = input.value.startsWith("top") ? "8" : "92";
      }
      if (name === "LogoX" || name === "LogoY") $("#thumbnailLogoPosition").value = "custom";
      thumbnailControls();
      saveDraft();
    });
  }
  $("#thumbnailDownload").addEventListener("click", () => downloadThumbnail().catch((error) => showToast(error.message)));
  $("#showSafeGuide").addEventListener("change", (event) => {
    $("#shortsSafeGuide").hidden = !event.target.checked;
  });
  for (const id of ["autoDuck", "audioFades", "duckPercent"]) {
    $("#" + id).addEventListener(id === "duckPercent" ? "input" : "change", () => {
      state.audioMix = { duck: $("#autoDuck").checked, duckPercent: Number($("#duckPercent").value), fades: $("#audioFades").checked };
      $("#duckPercentValue").textContent = `${toFaDigits(state.audioMix.duckPercent)}٪`;
      if (state.preview.segments[state.preview.index]) syncPreviewGains(state.preview.segments[state.preview.index]);
      saveDraft();
    });
  }
  $("#captionCueList").addEventListener("change", (event) => {
    const row = event.target.closest("[data-cue-index]");
    const field = event.target.dataset.cueField;
    if (!row || !field || !state.caption) return;
    const cue = state.caption.cues[Number(row.dataset.cueIndex)];
    if (!cue) return;
    const value = field === "text" ? event.target.value.trim() : Number(event.target.value);
    const candidate = { ...cue, [field]: value };
    if (!candidate.text || !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) || candidate.start < 0 || candidate.end - candidate.start < 0.02) {
      event.target.value = cue[field];
      return showToast("متن نباید خالی باشد و پایان باید بعد از شروع قرار بگیرد.");
    }
    Object.assign(cue, candidate);
    state.caption.cues.sort((a, b) => a.start - b.start);
    refreshCaptionDisplay();
    saveDraft();
  });
  $("#captionCueList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cue-action]");
    const row = button?.closest("[data-cue-index]");
    if (!row || !state.caption) return;
    const index = Number(row.dataset.cueIndex);
    if (button.dataset.cueAction === "delete") {
      state.caption.cues.splice(index, 1);
      refreshCaptionDisplay();
      saveDraft();
    } else if (button.dataset.cueAction === "jump") {
      const time = Math.max(0, state.caption.cues[index].start + state.captionStyle.offsetMs / 1000);
      if (refs.mixPreviewDialog.open) loadMixPreviewAt(time, state.preview.playing).catch((error) => showToast(error.message));
      else openMixPreview(time).catch((error) => showToast(error.message));
    }
  });
  $("#chooseLogo").addEventListener("click", () => refs.logoInput.click());
  $("#previewChooseLogo").addEventListener("click", () => refs.previewLogoInput.click());
  refs.logoInput.addEventListener("change", (event) => setLogo(event.target.files[0]));
  refs.previewLogoInput.addEventListener("change", (event) => setLogo(event.target.files[0]));
  $("#removeLogo").addEventListener("click", () => removeLogo());
  [refs.logoPosition, refs.previewLogoPosition].forEach((select) => select.addEventListener("change", () => {
    state.logoStyle.position = select.value;
    applyLogoStyle();
    saveDraft();
  }));
  [refs.logoSize, refs.previewLogoSize].forEach((input) => input.addEventListener("input", () => {
    state.logoStyle.sizePercent = Number(input.value);
    applyLogoStyle();
    saveDraft();
  }));
  $$('[data-remove="narration"], [data-remove="music"], [data-remove="caption"]').forEach((button) => {
    button.addEventListener("click", () => removeMedia(button.dataset.remove));
  });

  for (const [id, valueId] of [["narrationVolume", "narrationVolumeValue"], ["musicVolume", "musicVolumeValue"]]) {
    const input = $(`#${id}`);
    input.addEventListener("input", () => {
      $(`#${valueId}`).textContent = `${toFaDigits(input.value)}٪`;
      setRangeVisual(input);
      if (state.remembered[id === "narrationVolume" ? "narration" : "music"]) state.remembered[id === "narrationVolume" ? "narration" : "music"].volume = Number(input.value);
      const segment = state.preview.segments[state.preview.index];
      if (segment) syncPreviewGains(segment);
      saveDraft();
    });
  }

  $$('[data-caption-preset]').forEach((button) => {
    button.addEventListener("click", () => setCaptionPreset(button.dataset.captionPreset));
  });
  refs.captionFontSize.addEventListener("input", () => {
    state.captionStyle.fontSize = Number(refs.captionFontSize.value);
    applyCaptionStyle();
    saveDraft();
  });
  refs.captionPosition.addEventListener("change", () => {
    state.captionStyle.position = refs.captionPosition.value;
    applyCaptionStyle();
    saveDraft();
  });
  refs.captionColor.addEventListener("input", () => {
    state.captionStyle.color = refs.captionColor.value;
    applyCaptionStyle();
    saveDraft();
  });
  [refs.captionGroupSize, refs.previewCaptionGroupSize].forEach((select) => select.addEventListener("change", () => {
    state.captionStyle.groupSize = select.value === "standard" ? "standard" : Number(select.value);
    refreshCaptionDisplay();
    saveDraft();
  }));
  [refs.captionOffsetMs, refs.previewCaptionOffsetMs].forEach((input) => {
    input.addEventListener("input", () => {
      if (input.value !== "") setCaptionOffset(input.value, true, input);
    });
    input.addEventListener("change", () => setCaptionOffset(input.value));
  });
  $$('[data-caption-shift]').forEach((button) => {
    button.addEventListener("click", () => setCaptionOffset(state.captionStyle.offsetMs + Number(button.dataset.captionShift)));
  });
  $("#previewFirstCaption").addEventListener("click", () => {
    if (!state.caption?.displayCues?.length) return showToast("ابتدا فایل SRT وارد کنید.");
    const firstTime = Math.max(0, state.caption.displayCues[0].start + state.captionStyle.offsetMs / 1000 + 0.01);
    loadMixPreviewAt(Math.min(firstTime, Math.max(0, state.preview.total - 0.01)), state.preview.playing)
      .catch((error) => showToast(error.message));
  });
  $("#editCurrentCaption").addEventListener("click", () => {
    if (!state.caption) return showToast("ابتدا فایل SRT وارد کنید.");
    const cueTime = state.preview.globalTime - state.captionStyle.offsetMs / 1000;
    const index = state.caption.cues.findIndex((cue) => cueTime >= cue.start && cueTime < cue.end);
    if (index < 0) return showToast("در این لحظه زیرنویسی نیست؛ روی یک کلمه توقف کنید.");
    closeMixPreview();
    $("#captionEditor").open = true;
    const input = $(`[data-cue-index="${index}"] [data-cue-field="text"]`);
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
  });
  $("#captionOffsetReset").addEventListener("click", () => setCaptionOffset(0));
  $("#burnCaptions").addEventListener("change", () => {
    if (state.remembered.caption) state.remembered.caption.burn = $("#burnCaptions").checked;
    updatePreviewCaption(state.preview.globalTime);
    saveDraft();
  });

  refs.mixPreviewButton.addEventListener("click", () => openMixPreview().catch((error) => showToast(error.message || "بازکردن پیش‌نمایش ممکن نشد.")));
  $("#closeMixPreview").addEventListener("click", closeMixPreview);
  refs.mixPreviewPlay.addEventListener("click", () => {
    if (state.preview.playing) pauseMixPreview();
    else playMixPreview();
  });
  refs.mixPreviewSeek.addEventListener("input", () => {
    const wasPlaying = state.preview.playing;
    loadMixPreviewAt(Number(refs.mixPreviewSeek.value), wasPlaying).catch((error) => showToast(error.message));
  });
  refs.mixPreviewDialog.addEventListener("close", () => {
    pauseMixPreview();
    state.preview.loadToken += 1;
    refs.mixPreviewVideo.removeAttribute("src");
    refs.mixPreviewVideo.load();
  });

  refs.projectTitle.addEventListener("change", saveDraft);
  [refs.outputName, refs.resolution, refs.fitMode, refs.quality, $("#burnCaptions")].forEach((input) => input.addEventListener("change", () => {
    if (input === refs.fitMode) updateLogoStage();
    updateSummary();
    saveDraft();
  }));

  $("#projectMenuButton").addEventListener("click", saveProject);
  $("#projectImportButton").addEventListener("click", () => $("#projectImportInput").click());
  $("#projectImportInput").addEventListener("change", (event) => importProject(event.target.files[0]));
  $("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#settingsDialog").addEventListener("close", () => {
    state.settings.autosave = $("#autosaveSetting").checked;
    state.settings.leaveWarning = $("#leaveWarningSetting").checked;
    localStorage.setItem("flow2short-settings", JSON.stringify(state.settings));
    saveDraft();
  });

  refs.renderButton.addEventListener("click", renderVideo);
  refs.cancelRenderButton.addEventListener("click", () => {
    state.cancelled = true;
    if (state.ffmpeg) state.ffmpeg.terminate();
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
  });
  refs.closeRenderButton.addEventListener("click", () => refs.renderDialog.close());
  refs.downloadButton.addEventListener("click", () => {
    const anchor = document.createElement("a");
    anchor.href = refs.downloadButton.dataset.url;
    anchor.download = refs.downloadButton.dataset.filename;
    anchor.click();
  });

  $("#installButton").addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $("#installButton").hidden = true;
  });

  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $("#installButton").hidden = false;
  });

  addEventListener("beforeunload", (event) => {
    if (state.settings.leaveWarning && state.clips.length && !state.outputUrl) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    try {
      // A local package is already available from its own server. An installed
      // worker can serve an earlier HTML shell with this package's newer JS.
      if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter((registration) => registration.scope.startsWith(APP_BASE_URL.href))
          .map((registration) => registration.unregister()));
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith("flow2short-studio-")).map((key) => caches.delete(key)));
        }
        return;
      }
      await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
}

function init() {
  loadPreferences();
  wireEvents();
  wireDragAndDrop();
  wireStepNavigation();
  syncGlobalRanges();
  renderClipCards();
  updateSummary();
  $("#launchWarning").hidden = location.protocol !== "file:";
  registerServiceWorker();
  refreshGoogleConnection();
}

async function startApp() {
  if (document.documentElement.dataset.appVersion === "2.3.0") return init();
  // A previously installed service worker may combine an old HTML page with
  // new JS. Refetch the page without its cached URL before wiring any events.
  if (location.protocol.startsWith("http")) {
    try {
      const freshUrl = new URL(`./index.html?flow2short-refresh=${Date.now()}`, APP_BASE_URL);
      const response = await fetch(freshUrl, { cache: "no-store" });
      if (response.ok && (await response.text()).includes('data-app-version="2.3.0"')) {
        const reloadUrl = new URL(location.href);
        reloadUrl.searchParams.set("flow2short-ui", `2.3.0-${Date.now()}`);
        location.replace(reloadUrl.href);
        return;
      }
    } catch (error) { console.warn("Could not refresh the app shell", error); }
  }
  document.body.innerHTML = '<main style="max-width:36rem;margin:12vh auto;padding:2rem;font:18px/2 sans-serif;direction:rtl"><h1>نسخهٔ صفحه و برنامه هماهنگ نیست</h1><p>پنجرهٔ اجرای نسخهٔ قبلی را ببندید و Flow2Short نسخهٔ ۲.۳ را دوباره اجرا کنید. سپس این صفحه را تازه‌سازی کنید.</p><button type="button" onclick="location.reload()" style="padding:.7rem 1.5rem;cursor:pointer">تازه‌سازی صفحه</button></main>';
}

startApp();
