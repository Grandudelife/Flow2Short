import AppKit
import WebKit

@MainActor
final class StudioApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var service: Process?
    var lifetimePipe: Pipe?
    var appURL: URL?
    var downloads: [WKDownload] = []
    var quitPending = false
    var finishedLaunchingPage = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Flow2Short Studio"
        window.minSize = NSSize(width: 920, height: 650)
        window.delegate = self
        window.setFrameAutosaveName("Flow2ShortStudioWindow")
        window.center()
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startService(configuration: configuration)
    }

    func startService(configuration: WKWebViewConfiguration) {
        guard let resources = Bundle.main.resourceURL else { showError("فایل‌های داخلی برنامه پیدا نشد."); return }
        let token = UUID().uuidString + UUID().uuidString
        let process = Process()
        process.executableURL = resources.appendingPathComponent("flow2short-server")
        process.arguments = ["--desktop"]
        process.currentDirectoryURL = resources
        var environment = ProcessInfo.processInfo.environment
        environment["FLOW2SHORT_DESKTOP_TOKEN"] = token
        process.environment = environment
        let input = Pipe(), output = Pipe(), errors = Pipe()
        lifetimePipe = input
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardError.write(data) }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitPending else { return }
                self.showError("موتور محلی برنامه متوقف شد. برنامه را ببندید و دوباره باز کنید.")
            }
        }
        service = process
        do { try process.run() } catch { showError("اجرای موتور محلی ممکن نشد: \(error.localizedDescription)"); return }
        // Read the ephemeral address off the main thread. The child lifetime follows stdin.
        DispatchQueue.global().async { [weak self] in
            var line = Data()
            while line.count < 1024 {
                guard let byte = try? output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty else { break }
                if byte.first == 10 { break }
                line.append(byte)
            }
            let address = String(data: line, encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                guard let self else { return }
                guard let url = URL(string: address), url.scheme == "http", url.host == "127.0.0.1", url.port != nil else {
                    self.showError("راه‌اندازی موتور محلی کامل نشد."); return
                }
                self.appURL = url
                let stored = UserDefaults.standard.dictionary(forKey: "EditorStorage") as? [String: String] ?? [:]
                let payload = try! JSONSerialization.data(withJSONObject: ["token": token, "storage": stored])
                let json = String(data: payload, encoding: .utf8)!
                let script = """
                (() => {
                  const config = \(json);
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
                      if (this === localStorage && key.startsWith('flow2short-')) window.webkit.messageHandlers.editorStorage.postMessage({ key, value: String(value) });
                    };
                    Storage.prototype.removeItem = function(key) {
                      remove.call(this, key);
                      if (this === localStorage && key.startsWith('flow2short-')) window.webkit.messageHandlers.editorStorage.postMessage({ key, value: null });
                    };
                  } catch (error) { console.warn('Desktop storage', error); }
                })();
                """
                configuration.userContentController.add(self, name: "editorStorage")
                configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    func isLocal(_ url: URL?) -> Bool {
        guard let url, let appURL else { return false }
        return url.scheme == appURL.scheme && url.host == appURL.host && url.port == appURL.port
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, isLocal(message.frameInfo.request.url),
              let data = message.body as? [String: Any], let key = data["key"] as? String,
              key.hasPrefix("flow2short-"), key.count < 100 else { return }
        var storage = UserDefaults.standard.dictionary(forKey: "EditorStorage") as? [String: String] ?? [:]
        if let value = data["value"] as? String, value.utf8.count < 2_000_000 { storage[key] = value }
        else { storage.removeValue(forKey: key) }
        UserDefaults.standard.set(storage, forKey: "EditorStorage")
    }

    func buildMenu() {
        let bar = NSMenu()
        let app = NSMenu(), appItem = NSMenuItem()
        app.addItem(withTitle: "دربارهٔ Flow2Short Studio", action: #selector(about), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "تنظیمات…", action: #selector(settings), keyEquivalent: ",")
        app.addItem(.separator())
        app.addItem(withTitle: "پنهان کردن Flow2Short", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        app.addItem(withTitle: "خروج از Flow2Short", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app; bar.addItem(appItem)
        let file = NSMenu(title: "فایل"), fileItem = NSMenuItem(title: "فایل", action: nil, keyEquivalent: "")
        file.addItem(withTitle: "افزودن کلیپ…", action: #selector(importClips), keyEquivalent: "i")
        file.addItem(withTitle: "باز کردن پروژه…", action: #selector(openProject), keyEquivalent: "o")
        file.addItem(withTitle: "ذخیرهٔ پروژه…", action: #selector(saveProject), keyEquivalent: "s")
        file.addItem(.separator())
        let exportItem = file.addItem(withTitle: "ساخت خروجی ویدئو", action: #selector(exportVideo), keyEquivalent: "e")
        exportItem.keyEquivalentModifierMask = [.command, .shift]
        fileItem.submenu = file; bar.addItem(fileItem)
        let edit = NSMenu(title: "ویرایش"), editItem = NSMenuItem(title: "ویرایش", action: nil, keyEquivalent: "")
        for (title, selector, key) in [("واگرد", "undo:", "z"), ("بریدن", "cut:", "x"), ("کپی", "copy:", "c"), ("چسباندن", "paste:", "v"), ("انتخاب همه", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = edit; bar.addItem(editItem)
        let view = NSMenu(title: "نمایش"), viewItem = NSMenuItem(title: "نمایش", action: nil, keyEquivalent: "")
        view.addItem(withTitle: "بزرگ‌تر", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "کوچک‌تر", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(withTitle: "اندازهٔ اصلی", action: #selector(resetZoom), keyEquivalent: "0")
        view.addItem(withTitle: "تمام‌صفحه", action: #selector(fullScreen), keyEquivalent: "")
        viewItem.submenu = view; bar.addItem(viewItem)
        NSApp.mainMenu = bar
        for menu in [app, file, view] { for item in menu.items where item.action != nil { item.target = self }
        }
        app.items.first(where: { $0.action == #selector(NSApplication.terminate(_:)) })?.target = NSApp
        app.items.first(where: { $0.action == #selector(NSApplication.hide(_:)) })?.target = NSApp
    }

    func clickEditor(_ id: String) { webView.evaluateJavaScript("document.getElementById('\(id)')?.click()", completionHandler: nil) }
    @objc func importClips() { clickEditor("clipInput") }
    @objc func openProject() { clickEditor("projectImportInput") }
    @objc func saveProject() { clickEditor("projectMenuButton") }
    @objc func exportVideo() { clickEditor("renderButton") }
    @objc func settings() { clickEditor("settingsButton") }
    @objc func zoomIn() { webView.pageZoom = min(1.6, webView.pageZoom + 0.1) }
    @objc func zoomOut() { webView.pageZoom = max(0.7, webView.pageZoom - 0.1) }
    @objc func resetZoom() { webView.pageZoom = 1 }
    @objc func fullScreen() { window.toggleFullScreen(nil) }
    @objc func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Flow2Short Studio", .applicationVersion: "2.3.0 · Mac 1.0",
            .credits: NSAttributedString(string: "پنجرهٔ بومی macOS · موتور بومی FFmpeg\nرابط فارسی Flow2Short\nساخته‌شده از نسخهٔ گیت‌هاب 044b1bf")
        ])
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard isLocal(frame.request.url) else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.title = "انتخاب فایل برای Flow2Short"
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "باشه")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "تأیید"); alert.addButton(withTitle: "انصراف")
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        if isLocal(navigationAction.request.url) { decisionHandler(.allow); return }
        if let url = navigationAction.request.url, ["https", "http"].contains(url.scheme ?? ""), navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { track(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { track(download) }
    func track(_ download: WKDownload) { downloads.append(download); download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.title = "ذخیرهٔ خروجی Flow2Short"
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func downloadDidFinish(_ download: WKDownload) { downloads.removeAll { $0 === download } }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeAll { $0 === download }
        if (error as NSError).code != NSURLErrorCancelled { showError("ذخیرهٔ فایل کامل نشد: \(error.localizedDescription)") }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishedLaunchingPage = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError("باز کردن برنامه ممکن نشد: \(error.localizedDescription)") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showError("نمایشگر برنامه متوقف شد. برنامه را دوباره باز کنید؛ Recipe ذخیره‌شده قابل بازیابی است.") }
    func showError(_ message: String) {
        let alert = NSAlert(); alert.alertStyle = .warning; alert.messageText = "Flow2Short Studio"; alert.informativeText = message
        alert.beginSheetModal(for: window, completionHandler: nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitPending { return .terminateCancel }
        if !finishedLaunchingPage { quitPending = true; return .terminateNow }
        quitPending = true
        webView.evaluateJavaScript("({ rendering: typeof state !== 'undefined' && state.rendering, unsaved: typeof state !== 'undefined' && state.clips.length > 0 && state.settings.leaveWarning })") { [weak self] value, _ in
            guard let self else { sender.reply(toApplicationShouldTerminate: true); return }
            let flags = value as? [String: Any] ?? [:]
            if flags["rendering"] as? Bool == true || flags["unsaved"] as? Bool == true || !self.downloads.isEmpty {
                let alert = NSAlert()
                alert.messageText = "برنامه بسته شود؟"
                alert.informativeText = "پیش از خروج، پروژه و خروجی را ذخیره کنید. پردازش یا ذخیرهٔ فایل در حال اجرا متوقف می‌شود."
                alert.addButton(withTitle: "انصراف"); alert.addButton(withTitle: "خروج")
                alert.beginSheetModal(for: self.window) { result in
                    let shouldQuit = result == .alertSecondButtonReturn
                    self.quitPending = shouldQuit
                    sender.reply(toApplicationShouldTerminate: shouldQuit)
                }
            } else { sender.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        for download in downloads { download.cancel { _ in } }
        try? lifetimePipe?.fileHandleForWriting.close()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "editorStorage")
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = StudioApp()
    application.delegate = delegate
    application.run()
}
