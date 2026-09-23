const APP_BASE_URL = new URL("./", document.currentScript?.src || location.href);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  clips: [],
  narration: null,
  music: null,
  caption: null,
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

function refreshCaptionDisplay() {
  if (!state.caption) return;
  state.caption.displayCues = buildCaptionEvents(state.caption.cues, state.captionStyle.groupSize, state.caption.wordByWord);
  const mode = state.caption.wordByWord
    ? state.captionStyle.groupSize === 1 ? "نمایش تک‌کلمه‌ای" : `پانچ ${toFaDigits(state.captionStyle.groupSize)} کلمه‌ای`
    : "زیرنویس معمولی";
  $("#captionMeta").textContent = `${toFaDigits(state.caption.cues.length)} ${state.caption.wordByWord ? "کلمه" : "زیرنویس"} · ${mode} · ${formatBytes(state.caption.file.size)}`;
  const firstGroup = state.caption.displayCues.filter((cue) => cue.groupId === state.caption.displayCues[0]?.groupId);
  refs.captionStylePreview.textContent = firstGroup.at(-1)?.text || "YOUR NEXT BIG IDEA";
  refs.captionStylePreview.setAttribute("aria-label", "نمونه عبارت کامل: " + refs.captionStylePreview.textContent);
  refs.previewCaptionGroupSize.value = String(state.captionStyle.groupSize);
  refs.mixPreviewCaption.dataset.cue = "";
  updatePreviewCaption(state.preview.globalTime);
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
  const margin = Math.round(height * (state.captionStyle.position === "bottom" ? 0.115 : 0.08));
  const fontSize = Math.max(28, Math.round(state.captionStyle.fontSize * (width / 1080)));
  const primary = hexToAssColor(preset.textColor || state.captionStyle.color || preset.color);
  const outlineBase = preset.borderStyle === 3
    ? (state.captionStyle.preset === "mint" ? state.captionStyle.color : preset.background)
    : (preset.outlineColor || "#07111f");
  const outlineAlpha = preset.borderStyle === 3 ? "18" : (state.captionStyle.preset === "minimal" ? "80" : "20");
  const outline = hexToAssColor(outlineBase, outlineAlpha);
  const background = hexToAssColor(preset.background || "#07111f", preset.borderStyle === 3 ? "28" : "80");
  const outlineWidth = preset.borderStyle === 3 ? Math.max(7, preset.outline) : preset.outline;
  const isWordByWord = state.caption.wordByWord;
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
  state.captionStyle.groupSize = [1, 3, 4].includes(Number(state.captionStyle.groupSize)) ? Number(state.captionStyle.groupSize) : 3;
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
  try { importedRecipe = JSON.parse(localStorage.getItem("flow2short-imported-recipe") || "null"); } catch { /* ignore */ }
  for (const file of videoFiles) {
    try {
      const [duration, thumbnail] = await Promise.all([getMediaDuration(file), createVideoThumbnail(file)]);
      const remembered = importedRecipe?.project?.clips?.find((item) => item.name === file.name && (!item.size || item.size === file.size));
      state.clips.push({
        id: uid(),
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        duration,
        start: remembered ? Math.max(0, Math.min(duration, Number(remembered.start) || 0)) : 0,
        end: remembered ? Math.max(0.05, Math.min(duration, Number(remembered.end) || duration)) : duration,
        volume: remembered ? Math.max(0, Math.min(100, Number(remembered.sourceAudioPercent) || 0)) : 35,
        thumbnail,
      });
    } catch (error) {
      showToast(error.message);
    }
  }
  if (importedRecipe?.project?.clips?.length) {
    const order = new Map(importedRecipe.project.clips.map((item, index) => [item.name, index]));
    state.clips.sort((a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999));
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
    </article>
  `).join("");

  $$('input[type="range"]', refs.clipList).forEach(setRangeVisual);
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
    hint.textContent = `حدود ${formatBytes(totalBytes)} ورودی؛ خروجی بدون ارسال فایل‌ها به اینترنت ساخته می‌شود.`;
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

function updatePreviewCaption(time) {
  const offset = state.captionStyle.offsetMs / 1000;
  const index = $("#burnCaptions").checked
    ? state.caption?.displayCues?.findIndex((item) => time >= item.start + offset && time < item.end + offset) ?? -1
    : -1;
  const cue = index >= 0 ? state.caption.displayCues[index] : null;
  if (cue && refs.mixPreviewCaption.dataset.cue !== String(index)) {
    refs.mixPreviewCaption.dataset.cue = String(index);
    if (state.caption.wordByWord) {
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

function updateMixPreviewUI(time) {
  const safeTime = Math.max(0, Math.min(Number(time) || 0, state.preview.total));
  state.preview.globalTime = safeTime;
  refs.mixPreviewSeek.value = safeTime;
  refs.mixPreviewCurrent.textContent = formatTime(safeTime);
  refs.mixPreviewTotal.textContent = formatTime(state.preview.total);
  setRangeVisual(refs.mixPreviewSeek);
  updatePreviewCaption(safeTime);
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

function syncPreviewGains(segment) {
  if (!state.preview.gains) {
    refs.mixPreviewVideo.volume = Math.min(1, segment.clip.volume / 100);
    refs.mixPreviewNarration.volume = Math.min(1, Number($("#narrationVolume").value) / 100);
    refs.mixPreviewMusic.volume = Math.min(1, Number($("#musicVolume").value) / 100);
    return;
  }
  const now = state.preview.audioContext.currentTime;
  state.preview.gains.video.gain.setTargetAtTime(segment.clip.volume / 100, now, 0.015);
  state.preview.gains.narration.gain.setTargetAtTime(Number($("#narrationVolume").value) / 100, now, 0.015);
  state.preview.gains.music.gain.setTargetAtTime(Number($("#musicVolume").value) / 100, now, 0.015);
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
  syncPreviewGains(segment);
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
  updateMixPreviewUI(time);
  syncPreviewAudio(time, true);
  state.preview.frame = requestAnimationFrame(runMixPreviewFrame);
}

async function playMixPreview() {
  try {
    const context = ensurePreviewAudioGraph();
    if (context?.state === "suspended") await context.resume();
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

async function openMixPreview() {
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
  state.preview.globalTime = 0;
  applyCaptionStyle();
  refs.mixPreviewDialog.showModal();
  await loadMixPreviewAt(0, false);
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

  if (field === "volume") {
    clip.volume = Math.round(Number(event.target.value));
    event.target.closest("label").querySelector("output").textContent = `${toFaDigits(clip.volume)}٪`;
    setRangeVisual(event.target);
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
    const cues = parseSrt(await file.text());
    if (!cues.length) throw new Error("زمان‌بندی معتبری داخل فایل SRT پیدا نشد.");
    const wordByWord = cues.every((cue) => !/\s/u.test(cue.text.trim()));
    state.caption = { file, cues, wordByWord, displayCues: [] };
    $("#captionName").textContent = file.name;
    $('[data-remove="caption"]').hidden = false;
    refreshCaptionDisplay();
    saveDraft();
  } catch (error) {
    refs.captionInput.value = "";
    showToast(error.message || "خواندن زیرنویس ممکن نشد.");
  }
}

function removeMedia(kind) {
  if (state[kind]?.url) URL.revokeObjectURL(state[kind].url);
  state[kind] = null;
  $(`#${kind}Name`).textContent = "فایلی انتخاب نشده";
  $(`#${kind}Meta`).textContent = kind === "caption" ? "SRT کلمه‌به‌کلمه یا معمولی" : "MP3، WAV یا M4A";
  $(`[data-remove="${kind}"]`).hidden = true;
  $(`#${kind}Input`).value = "";
  if (kind === "caption") {
    refs.captionStylePreview.textContent = "YOUR NEXT BIG IDEA";
    updatePreviewCaption(state.preview.globalTime);
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
      })),
      narration: state.narration ? { name: state.narration.file.name, size: state.narration.file.size, volume: Number($("#narrationVolume").value) } : null,
      music: state.music ? { name: state.music.file.name, size: state.music.file.size, volume: Number($("#musicVolume").value) } : null,
      caption: state.caption ? { name: state.caption.file.name, burn: $("#burnCaptions").checked } : null,
      captionStyle: { ...state.captionStyle },
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
    refs.projectTitle.value = recipe.project.title || "پروژه Flow2Short";
    refs.outputName.value = recipe.project.output?.name || "YouTube-Short-Final";
    refs.resolution.value = recipe.project.output?.resolution || "1080";
    refs.fitMode.value = recipe.project.output?.fitMode || "cover";
    refs.quality.value = recipe.project.output?.quality || "balanced";
    $("#narrationVolume").value = recipe.project.narration?.volume ?? 100;
    $("#musicVolume").value = recipe.project.music?.volume ?? 18;
    $("#burnCaptions").checked = recipe.project.caption?.burn ?? true;
    state.captionStyle = { ...state.captionStyle, ...(recipe.project.captionStyle || {}) };
    applyCaptionStyle();
    refreshCaptionDisplay();
    setCaptionOffset(state.captionStyle.offsetMs, false);
    syncGlobalRanges();
    updateSummary();
    localStorage.setItem("flow2short-imported-recipe", JSON.stringify(recipe));
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
  try {
    const settings = JSON.parse(localStorage.getItem("flow2short-settings") || "{}");
    state.settings = { ...state.settings, ...settings };
    $("#autosaveSetting").checked = state.settings.autosave;
    $("#leaveWarningSetting").checked = state.settings.leaveWarning;
    const draft = JSON.parse(localStorage.getItem("flow2short-draft") || "null");
    if (draft?.project) {
      refs.projectTitle.value = draft.project.title || refs.projectTitle.value;
      refs.outputName.value = draft.project.output?.name || refs.outputName.value;
      refs.resolution.value = draft.project.output?.resolution || refs.resolution.value;
      refs.fitMode.value = draft.project.output?.fitMode || refs.fitMode.value;
      refs.quality.value = draft.project.output?.quality || refs.quality.value;
      $("#narrationVolume").value = draft.project.narration?.volume ?? 100;
      $("#musicVolume").value = draft.project.music?.volume ?? 18;
      $("#burnCaptions").checked = draft.project.caption?.burn ?? true;
      state.captionStyle = { ...state.captionStyle, ...(draft.project.captionStyle || {}) };
    }
  } catch {
    localStorage.removeItem("flow2short-draft");
  }
  applyCaptionStyle();
  setCaptionOffset(state.captionStyle.offsetMs, false);
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

async function renderVideo() {
  if (!state.clips.length || state.rendering) return;
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

    for (let index = 0; index < state.clips.length; index += 1) {
      if (state.cancelled) throw new DOMException("پردازش لغو شد.", "AbortError");
      const clip = state.clips[index];
      const inputName = `input-${index}.${extensionOf(clip.file, "mp4")}`;
      const segmentName = `segment-${String(index).padStart(2, "0")}.mp4`;
      workingFiles.push(inputName, segmentName);
      segmentNames.push(segmentName);

      updateRenderProgress(
        0.08 + (index / state.clips.length) * 0.55,
        `آماده‌سازی کلیپ ${toFaDigits(index + 1)} از ${toFaDigits(state.clips.length)}`,
        clip.name,
      );
      await ffmpeg.writeFile(inputName, await fetchFileBytes(clip.file));
      const hasAudio = await hasAudioStream(ffmpeg, inputName, index);
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
      await ffmpeg.deleteFile(inputName).catch(() => {});
    }

    const concatList = segmentNames.map((name) => `file '${name}'`).join("\n");
    await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));
    workingFiles.push("concat.txt", "joined.mp4");
    updateRenderProgress(0.65, "اتصال کلیپ‌ها", "کلیپ‌ها با ترتیب انتخاب‌شده به هم متصل می‌شوند.");
    const concatResult = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "joined.mp4"]);
    if (concatResult !== 0) throw new Error("اتصال کلیپ‌ها کامل نشد.");
    await cleanupFiles(ffmpeg, [...segmentNames, "concat.txt"]);

    const finalArgs = ["-i", "joined.mp4"];
    const audioLabels = ["[a0]"];
    const filterParts = ["[0:a]volume=1,aresample=48000[a0]"];
    let inputIndex = 1;

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
      filterParts.push(`[${inputIndex}:a]volume=${(Number($("#musicVolume").value) / 100).toFixed(2)},aresample=48000[a${inputIndex}]`);
      audioLabels.push(`[a${inputIndex}]`);
    }

    let burnCaptions = Boolean(state.caption && $("#burnCaptions").checked);
    if (state.caption) {
      await ffmpeg.writeFile("captions.ass", new TextEncoder().encode(buildAssCaptions(width, height)));
      const subtitleFont = new Uint8Array(await fetch(new URL("./vendor/fonts/DejaVuSans.ttf", APP_BASE_URL)).then((response) => response.arrayBuffer()));
      await ffmpeg.writeFile("DejaVuSans.ttf", subtitleFont);
      workingFiles.push("captions.ass", "DejaVuSans.ttf");
    }

    if (audioLabels.length > 1) {
      filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95[aout]`);
      finalArgs.push("-filter_complex", filterParts.join(";"));
    }

    const output = "final.mp4";
    workingFiles.push(output);
    const appendOutputOptions = () => {
      finalArgs.push("-map", "0:v:0", "-map", audioLabels.length > 1 ? "[aout]" : "0:a:0");
      if (burnCaptions) {
        finalArgs.push(
          "-vf", "subtitles=captions.ass:fontsdir=.",
          "-c:v", "libx264", "-preset", settings.preset, "-crf", settings.crf,
        );
      } else {
        finalArgs.push("-c:v", "copy");
      }
      finalArgs.push("-c:a", "aac", "-b:a", settings.audio, "-ar", "48000", "-movflags", "+faststart", "-shortest", output);
    };

    updateRenderProgress(0.76, "میکس صدا و ساخت خروجی", burnCaptions ? "صداها میکس و زیرنویس روی تصویر تثبیت می‌شود." : "صداهای انتخاب‌شده با هم میکس می‌شوند.");
    appendOutputOptions();
    let finalResult = await ffmpeg.exec(finalArgs);

    if (finalResult !== 0 && burnCaptions) {
      addRenderLog("موتور مرورگر از تثبیت زیرنویس پشتیبانی نکرد؛ خروجی بدون زیرنویس تصویری دوباره ساخته می‌شود.");
      burnCaptions = false;
      await ffmpeg.deleteFile(output).catch(() => {});
      const retryArgs = ["-i", "joined.mp4"];
      inputIndex = 1;
      if (state.narration) retryArgs.push("-i", `narration.${extensionOf(state.narration.file, "mp3")}`);
      if (state.music) retryArgs.push("-stream_loop", "-1", "-i", `music.${extensionOf(state.music.file, "mp3")}`);
      if (audioLabels.length > 1) retryArgs.push("-filter_complex", filterParts.join(";"));
      retryArgs.push("-map", "0:v:0", "-map", audioLabels.length > 1 ? "[aout]" : "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", settings.audio, "-movflags", "+faststart", "-shortest", output);
      finalResult = await ffmpeg.exec(retryArgs);
    }

    if (finalResult !== 0) throw new Error("ساخت فایل نهایی کامل نشد. گزارش فنی را بررسی کنید.");
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
    addRenderLog(burnCaptions ? "خروجی همراه زیرنویس تصویری ساخته شد." : "خروجی آماده شد.");
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
    if (action === "up") moveClip(card.dataset.id, -1);
    if (action === "down") moveClip(card.dataset.id, 1);
    if (action === "delete") deleteClip(card.dataset.id);
  });

  $$('[data-pick="narration"], [data-pick="music"], [data-pick="caption"]').forEach((button) => {
    button.addEventListener("click", () => $(`#${button.dataset.pick}Input`).click());
  });
  refs.narrationInput.addEventListener("change", (event) => setAudio("narration", event.target.files[0]));
  refs.musicInput.addEventListener("change", (event) => setAudio("music", event.target.files[0]));
  refs.captionInput.addEventListener("change", (event) => setCaption(event.target.files[0]));
  $$('[data-remove="narration"], [data-remove="music"], [data-remove="caption"]').forEach((button) => {
    button.addEventListener("click", () => removeMedia(button.dataset.remove));
  });

  for (const [id, valueId] of [["narrationVolume", "narrationVolumeValue"], ["musicVolume", "musicVolumeValue"]]) {
    const input = $(`#${id}`);
    input.addEventListener("input", () => {
      $(`#${valueId}`).textContent = `${toFaDigits(input.value)}٪`;
      setRangeVisual(input);
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
    state.captionStyle.groupSize = Number(select.value);
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
  $("#captionOffsetReset").addEventListener("click", () => setCaptionOffset(0));
  $("#burnCaptions").addEventListener("change", () => {
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
}

init();
