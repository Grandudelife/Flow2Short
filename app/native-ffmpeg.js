// Same editor API as ffmpeg.wasm; media is rendered by the bundled macOS binary.
export class FFmpeg {
  constructor() { this.listeners = new Map(); this.stopped = false; this.pendingStop = null; }
  on(event, callback) { this.listeners.set(event, callback); }
  async request(path, options = {}) {
    if (this.stopped) throw new DOMException("پردازش لغو شد.", "AbortError");
    const response = await fetch(`/__native/${path}`, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `موتور بومی مک: ${response.status}`);
    }
    return response;
  }
  async load() { await this.request("load", { method: "POST" }); return true; }
  async writeFile(name, data) {
    await this.request(`file?name=${encodeURIComponent(name)}`, { method: "PUT", body: data });
  }
  async readFile(name) {
    return new Uint8Array(await (await this.request(`file?name=${encodeURIComponent(name)}`)).arrayBuffer());
  }
  async deleteFile(name) {
    // Cancellation still permits cleanup after the active process has exited.
    if (this.pendingStop) await this.pendingStop;
    const response = await fetch(`/__native/file?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("پاک‌سازی فایل موقت ممکن نشد.");
  }
  async run(path, args) {
    const response = await this.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) });
    const result = await response.json();
    for (const message of (result.log || "").split("\n")) this.listeners.get("log")?.({ message });
    if (this.stopped) throw new DOMException("پردازش لغو شد.", "AbortError");
    return result.code;
  }
  exec(args) { return this.run("exec", args); }
  ffprobe(args) { return this.run("probe", args); }
  terminate() { this.stopped = true; this.pendingStop = fetch("/__native/stop", { method: "POST" }).catch(() => {}); }
}
