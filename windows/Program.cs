using System.ComponentModel;
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Flow2Short.Windows;

internal static class Program
{
    public static int ExitCode { get; set; }
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        string? report = args.Length == 2 && args[0] == "--smoke-test" ? Path.GetFullPath(args[1]) : null;
        try { Application.Run(new StudioForm(report)); }
        catch (Exception error)
        {
            ExitCode = 1;
            if (report != null) File.WriteAllText(report, JsonSerializer.Serialize(new { success = false, error = error.ToString() }));
            else MessageBox.Show(error.Message, "Flow2Short Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        return ExitCode;
    }
}

internal static class Payload
{
    public static string Extract(string data)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var digestStream = assembly.GetManifestResourceStream("Flow2Short.PayloadDigest") ?? throw new IOException("Missing runtime digest");
        string digest = new StreamReader(digestStream).ReadToEnd().Trim();
        if (digest.Length != 64 || digest.Any(c => !Uri.IsHexDigit(c))) throw new IOException("Invalid runtime digest");
        string root = Path.Combine(data, "Runtime", digest);
        using var guard = new Mutex(false, "Local\\Flow2ShortPayload-" + digest);
        bool locked;
        try { locked = guard.WaitOne(TimeSpan.FromMinutes(2)); }
        catch (AbandonedMutexException) { locked = true; }
        if (!locked) throw new IOException("Another instance is preparing the app. Please try again.");
        try
        {
            if (File.Exists(Path.Combine(root, ".complete"))) return root;
            string staging = root + ".tmp-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staging);
            try
            {
                using var stream = assembly.GetManifestResourceStream("Flow2Short.Payload") ?? throw new IOException("Missing embedded runtime");
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(digest, StringComparison.OrdinalIgnoreCase)) throw new IOException("Runtime integrity check failed");
                stream.Position = 0;
                using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
                archive.ExtractToDirectory(staging);
                File.WriteAllText(Path.Combine(staging, ".complete"), digest);
                if (Directory.Exists(root)) Directory.Delete(root, true);
                Directory.Move(staging, root);
            }
            finally { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
            return root;
        }
        finally { guard.ReleaseMutex(); }
    }
}

internal sealed class StudioForm : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly Label startup = new() { Dock = DockStyle.Fill, Text = "در حال آماده‌سازی Flow2Short…", TextAlign = ContentAlignment.MiddleCenter };
    private readonly string data, storageFile;
    private readonly string? smokeReport;
    private readonly Dictionary<string, string> storage;
    private readonly HashSet<CoreWebView2DownloadOperation> downloads = [];
    private Process? service;
    private ChildJob? job;
    private Uri? address;
    private bool pageReady, closing, allowClose, smokeStarted;
    private readonly TaskCompletionSource<bool> smokeBridge = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> smokeDownload = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly string[] restoredKeys;

    public StudioForm(string? report)
    {
        smokeReport = report;
        data = report != null && Environment.GetEnvironmentVariable("FLOW2SHORT_TEST_DATA") is string testData
            ? Path.GetFullPath(testData) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Flow2Short");
        Directory.CreateDirectory(data);
        storageFile = Path.Combine(data, "editor-storage.json");
        try { storage = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(storageFile)) ?? []; }
        catch { storage = []; }
        restoredKeys = storage.Keys.ToArray();
        Text = "Flow2Short Studio";
        ClientSize = new Size(1280, 820);
        MinimumSize = new Size(940, 700);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        var menu = BuildMenu();
        Controls.Add(web); Controls.Add(startup); Controls.Add(menu);
        MainMenuStrip = menu;
        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, e) => { if (!allowClose) { e.Cancel = true; _ = RequestCloseAsync(); } };
        FormClosed += (_, _) => { web.Dispose(); job?.Dispose(); service?.Dispose(); };
    }

    private MenuStrip BuildMenu()
    {
        var menu = new MenuStrip { RightToLeft = RightToLeft.Yes };
        var file = new ToolStripMenuItem("فایل");
        void Add(string label, Keys key, string id) => file.DropDownItems.Add(new ToolStripMenuItem(label, null, async (_, _) => await ClickEditor(id)) { ShortcutKeys = key });
        Add("افزودن کلیپ…", Keys.Control | Keys.I, "clipInput");
        Add("باز کردن پروژه…", Keys.Control | Keys.O, "projectImportInput");
        Add("ذخیرهٔ پروژه…", Keys.Control | Keys.S, "projectMenuButton");
        Add("ساخت خروجی ویدئو", Keys.Control | Keys.Shift | Keys.E, "renderButton");
        Add("تنظیمات…", Keys.Control | Keys.Oemcomma, "settingsButton");
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add("خروج", null, (_, _) => Close());
        var view = new ToolStripMenuItem("نمایش");
        view.DropDownItems.Add("بزرگ‌تر", null, (_, _) => web.ZoomFactor = Math.Min(1.6, web.ZoomFactor + .1));
        view.DropDownItems.Add("کوچک‌تر", null, (_, _) => web.ZoomFactor = Math.Max(.7, web.ZoomFactor - .1));
        view.DropDownItems.Add("اندازهٔ اصلی", null, (_, _) => web.ZoomFactor = 1);
        var help = new ToolStripMenuItem("راهنما");
        help.DropDownItems.Add("دربارهٔ برنامه", null, (_, _) => MessageBox.Show("Flow2Short Studio 2.3 · Windows 1.0\nپنجرهٔ بومی ویندوز · موتور بومی FFmpeg\nرابط فارسی در WebView2", Text));
        help.DropDownItems.Add("راهنمای نسخهٔ ویندوز", null, (_, _) => OpenExternal("https://github.com/Grandudelife/Flow2Short/blob/windows-native/windows/README.md"));
        menu.Items.AddRange([file, view, help]);
        return menu;
    }

    private async Task ClickEditor(string id)
    {
        if (pageReady && !closing) await web.CoreWebView2.ExecuteScriptAsync($"document.getElementById({JsonSerializer.Serialize(id)})?.click()");
    }

    private bool IsLocal(string uri) => address != null && Uri.TryCreate(uri, UriKind.Absolute, out var url) &&
        url.Scheme == address.Scheme && url.Host == address.Host && url.Port == address.Port;

    private bool IsLocalResource(string uri) => IsLocal(uri) ||
        (address != null && uri.StartsWith("blob:" + address.GetLeftPart(UriPartial.Authority) + "/", StringComparison.Ordinal));

    private static void OpenExternal(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var url) && (url.Scheme == "https" || url.Scheme == "http"))
            Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
    }

    private async Task StartAsync()
    {
        try
        {
            try { _ = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (WebView2RuntimeNotFoundException)
            {
                if (smokeReport != null) throw;
                if (MessageBox.Show("Microsoft Edge WebView2 Runtime برای اجرای برنامه لازم است. صفحهٔ رسمی دانلود باز شود؟", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    OpenExternal("https://developer.microsoft.com/en-us/microsoft-edge/webview2/");
                allowClose = true; Close(); return;
            }
            string resources = await Task.Run(() => Payload.Extract(data));
            if (closing) return;
            string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(36));
            var info = new ProcessStartInfo(Path.Combine(resources, "flow2short-server.exe"), "--desktop")
            {
                WorkingDirectory = resources, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            info.Environment["FLOW2SHORT_DESKTOP_TOKEN"] = token;
            if (smokeReport != null) info.Environment["LOCALAPPDATA"] = Path.Combine(data, "test-config");
            job = new ChildJob();
            service = new Process { StartInfo = info, EnableRaisingEvents = true };
            service.ErrorDataReceived += (_, _) => { }; // Drain the pipe without retaining user request data.
            service.Exited += (_, _) => { if (!closing && IsHandleCreated) BeginInvoke((Action)(() => _ = FailAsync(new IOException("موتور محلی متوقف شد. برنامه را دوباره باز کنید.")))); };
            service.Start(); job.Attach(service); service.BeginErrorReadLine();
            string? line = await service.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
            if (closing) return;
            if (!Uri.TryCreate(line, UriKind.Absolute, out address) || address.Scheme != "http" || address.Host != "127.0.0.1" || address.Port < 1)
                throw new IOException("راه‌اندازی موتور محلی کامل نشد.");
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "WebView2"));
            if (closing) return;
            await web.EnsureCoreWebView2Async(environment);
            if (closing) return;
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.NavigationStarting += (_, e) => { if (!IsLocalResource(e.Uri)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += ReceiveMessage;
            core.DownloadStarting += DownloadStarting;
            core.ProcessFailed += (_, _) => { if (!closing) BeginInvoke((Action)(() => _ = FailAsync(new IOException("نمایشگر برنامه متوقف شد. برنامه را دوباره باز کنید.")))); };
            web.AcceleratorKeyPressed += (_, e) =>
            {
                if (e.KeyEventKind != CoreWebView2KeyEventKind.KeyDown || !ModifierKeys.HasFlag(Keys.Control)) return;
                string? id = (Keys)e.VirtualKey switch
                {
                    Keys.I => "clipInput", Keys.O => "projectImportInput", Keys.S => "projectMenuButton",
                    Keys.E when ModifierKeys.HasFlag(Keys.Shift) => "renderButton", Keys.Oemcomma => "settingsButton", _ => null
                };
                if (id != null) { e.Handled = true; BeginInvoke((Action)(() => _ = ClickEditor(id))); }
            };
            string config = JsonSerializer.Serialize(new { token, storage, origin = address.GetLeftPart(UriPartial.Authority) });
            await core.AddScriptToExecuteOnDocumentCreatedAsync($$"""
                (() => {
                  const config = {{config}};
                  if (window !== top || location.origin !== config.origin) return;
                  window.FLOW2SHORT_DESKTOP = true;
                  const originalFetch = window.fetch.bind(window);
                  window.fetch = (input, options = {}) => {
                    const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
                    if (url.origin === location.origin && url.pathname.startsWith('/__')) {
                      const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
                      headers.set('X-Flow2Short-Desktop', config.token);
                      options = { ...options, headers };
                    }
                    return originalFetch(input, options);
                  };
                  try {
                    for (const [key, value] of Object.entries(config.storage)) localStorage.setItem(key, value);
                    const save = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
                    Storage.prototype.setItem = function(key, value) {
                      save.call(this, key, value);
                      if (this === localStorage && key.startsWith('flow2short-')) chrome.webview.postMessage({type:'storage', key, value:String(value)});
                    };
                    Storage.prototype.removeItem = function(key) {
                      remove.call(this, key);
                      if (this === localStorage && key.startsWith('flow2short-')) chrome.webview.postMessage({type:'storage', key, value:null});
                    };
                  } catch (error) { console.warn('Desktop storage', error); }
                })();
                """);
            core.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess) { if (!closing) BeginInvoke((Action)(() => _ = FailAsync(new IOException("باز کردن رابط برنامه ممکن نشد: " + e.WebErrorStatus)))); return; }
                pageReady = true; startup.Visible = false;
                if (smokeReport != null && !smokeStarted) { smokeStarted = true; await SmokeAsync(); }
            };
            core.Navigate(address.AbsoluteUri);
        }
        catch (Exception error) { await FailAsync(error); }
    }

    private void ReceiveMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsLocal(e.Source)) return;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var value = document.RootElement;
            string? type = value.GetProperty("type").GetString();
            if (type == "smoke" && smokeReport != null) { smokeBridge.TrySetResult(value.GetProperty("success").GetBoolean()); return; }
            if (type != "storage") return;
            string? key = value.GetProperty("key").GetString();
            if (key == null || key.Length > 100 || !key.StartsWith("flow2short-", StringComparison.Ordinal)) return;
            var item = value.GetProperty("value");
            if (item.ValueKind == JsonValueKind.Null) storage.Remove(key);
            else if (item.ValueKind == JsonValueKind.String && item.GetString() is string text && Encoding.UTF8.GetByteCount(text) < 2_000_000) storage[key] = text;
            else return;
            string temporary = storageFile + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(storage));
            File.Move(temporary, storageFile, true);
        }
        catch (Exception error) { if (smokeReport != null) smokeBridge.TrySetException(error); }
    }

    private void DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        if (closing || !IsLocalResource(e.DownloadOperation.Uri)) { e.Cancel = true; return; }
        var deferral = e.GetDeferral();
        // Modal file dialogs run after the WebView2 callback returns (no reentrancy).
        BeginInvoke((Action)(() => ChooseDownloadDestination(e, deferral)));
    }

    private void ChooseDownloadDestination(CoreWebView2DownloadStartingEventArgs e, CoreWebView2Deferral deferral)
    {
        try
        {
            string filename = Path.GetFileName(e.ResultFilePath);
            if (string.IsNullOrWhiteSpace(filename)) filename = "Flow2Short-output.mp4";
            if (smokeReport != null) e.ResultFilePath = Path.Combine(Path.GetDirectoryName(smokeReport)!, "smoke.flow2short.json");
            else
            {
                using var dialog = new SaveFileDialog { Title = "ذخیرهٔ خروجی Flow2Short", FileName = filename, OverwritePrompt = true, RestoreDirectory = true };
                if (dialog.ShowDialog(this) != DialogResult.OK) { e.Cancel = true; return; }
                e.ResultFilePath = dialog.FileName;
            }
            e.Handled = true;
            var operation = e.DownloadOperation;
            downloads.Add(operation);
            operation.StateChanged += (_, _) =>
            {
                if (operation.State == CoreWebView2DownloadState.InProgress) return;
                downloads.Remove(operation);
                if (smokeReport != null) smokeDownload.TrySetResult(operation.State == CoreWebView2DownloadState.Completed);
                else if (!closing && operation.State == CoreWebView2DownloadState.Interrupted && operation.InterruptReason != CoreWebView2DownloadInterruptReason.UserCanceled)
                    BeginInvoke((Action)(() => MessageBox.Show("ذخیرهٔ خروجی کامل نشد: " + operation.InterruptReason, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning)));
            };
        }
        catch (Exception error)
        {
            e.Cancel = true;
            if (smokeReport != null) smokeDownload.TrySetException(error);
            else if (!closing) MessageBox.Show("ذخیرهٔ فایل ممکن نشد: " + error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally { deferral.Complete(); }
    }

    private async Task SmokeAsync()
    {
        try
        {
            for (int i = 0; i < 100; i++)
            {
                string ready = await web.CoreWebView2.ExecuteScriptAsync("Boolean(window.FLOW2SHORT_DESKTOP && document.getElementById('renderButton') && typeof state !== 'undefined')");
                if (ready == "true") break;
                if (i == 99) throw new IOException("Editor did not initialize");
                await Task.Delay(100);
            }
            await web.CoreWebView2.ExecuteScriptAsync("""
                (async () => {
                  try {
                    const r = await fetch('/__native/load', {method:'POST'});
                    const native = (await r.json()).native;
                    localStorage.setItem('flow2short-smoke', 'persisted');
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([JSON.stringify({smoke:true})], {type:'application/json'}));
                    a.download = 'smoke.flow2short.json'; a.click();
                    chrome.webview.postMessage({type:'smoke', success: r.ok && native && document.documentElement.dir === 'rtl'});
                  } catch (error) { chrome.webview.postMessage({type:'smoke', success:false}); }
                })();
                """);
            if (!await smokeBridge.Task.WaitAsync(TimeSpan.FromSeconds(30))) throw new IOException("Native bridge failed");
            if (!await smokeDownload.Task.WaitAsync(TimeSpan.FromSeconds(30))) throw new IOException("Blob download failed");
            using var downloaded = JsonDocument.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(smokeReport!)!, "smoke.flow2short.json")));
            if (!downloaded.RootElement.GetProperty("smoke").GetBoolean()) throw new IOException("Download was corrupted");
            if (!storage.TryGetValue("flow2short-smoke", out var saved) || saved != "persisted") throw new IOException("Host storage failed");
            using (var screenshot = File.Create(Path.ChangeExtension(smokeReport!, ".png")))
                await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
            File.WriteAllText(smokeReport!, JsonSerializer.Serialize(new { success = true, embeddedRuntime = true, nativeBridge = true, blobDownload = true, persistentStorage = true, restored = restoredKeys.Contains("flow2short-smoke"), localPort = address!.Port }));
            closing = true; await StopServiceAsync(); allowClose = true; Close();
        }
        catch (Exception error) { await FailAsync(error); }
    }

    private async Task RequestCloseAsync()
    {
        if (closing) return;
        closing = true;
        bool warn = downloads.Count > 0;
        try
        {
            if (pageReady)
            {
                string result = await web.CoreWebView2.ExecuteScriptAsync("Boolean(typeof state !== 'undefined' && (state.rendering || (state.clips.length && state.settings.leaveWarning)))").WaitAsync(TimeSpan.FromSeconds(3));
                warn |= result == "true";
            }
        }
        catch { warn = true; }
        if (warn && MessageBox.Show("پیش از خروج، پروژه و خروجی را ذخیره کنید. پردازش یا ذخیرهٔ فایل در حال اجرا متوقف می‌شود. برنامه بسته شود؟", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
        { closing = false; return; }
        await StopServiceAsync(); allowClose = true; Close();
    }

    private async Task StopServiceAsync()
    {
        foreach (var operation in downloads.ToArray()) operation.Cancel();
        if (service != null)
        {
            try
            {
                service.StandardInput.Close();
                await service.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch { try { if (!service.HasExited) service.Kill(true); } catch { } }
        }
        job?.Dispose(); job = null;
    }

    private async Task FailAsync(Exception error)
    {
        if (closing) return;
        closing = true; Program.ExitCode = 1;
        if (smokeReport != null) File.WriteAllText(smokeReport, JsonSerializer.Serialize(new { success = false, error = error.ToString() }));
        else MessageBox.Show(error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        await StopServiceAsync(); allowClose = true; Close();
    }
}

internal sealed class ChildJob : IDisposable
{
    private readonly SafeFileHandle handle;
    public ChildJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } }; // KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf<ExtendedLimits>();
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(handle, 9, pointer, (uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        catch { handle.Dispose(); throw; }
        finally { Marshal.FreeHGlobal(pointer); }
    }
    public void Attach(Process process)
    {
        if (!AssignProcessToJobObject(handle, process.SafeHandle)) { try { process.Kill(true); } catch { } throw new Win32Exception(Marshal.GetLastWin32Error()); }
    }
    public void Dispose() => handle.Dispose();
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeFileHandle job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, SafeProcessHandle process);
}
