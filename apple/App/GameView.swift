import SwiftUI
import WebKit
#if os(iOS) || os(visionOS)
import UIKit
#endif

/// Serves the bundled web game (the "Web" folder) at roadster://game/...
/// A real scheme (not file://) is needed because the game uses ES modules.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "roadster"
    private let root: URL

    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        // never serve anything outside the bundled folder
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            let missing = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                          headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(missing)
            task.didReceive(Data())
            task.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mimeType(for: file.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}

/// Native extras the web game can call: haptics (navigator.vibrate has no effect in a web view).
final class NativeBridge: NSObject, WKScriptMessageHandler, WKUIDelegate {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        #if os(iOS)
        guard message.name == "haptic" else { return }
        let ms = (message.body as? NSNumber)?.doubleValue ?? 20
        let style: UIImpactFeedbackGenerator.FeedbackStyle = ms >= 100 ? .heavy : (ms >= 40 ? .medium : .light)
        UIImpactFeedbackGenerator(style: style).impactOccurred()
        #endif
    }

    #if os(iOS) || os(visionOS)
    // Tilt-to-bank asks for motion access from JavaScript; the app grants it (Info.plist explains why).
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
    #endif
}

enum GameWebViewFactory {
    static let startURL = URL(string: "\(BundleSchemeHandler.scheme)://game/index.html")!

    static func make(bridge: NativeBridge) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
        config.setURLSchemeHandler(BundleSchemeHandler(root: webRoot), forURLScheme: BundleSchemeHandler.scheme)
        config.websiteDataStore = .default() // keeps saves (localStorage) between launches
        #if os(iOS) || os(visionOS)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif
        #if os(iOS)
        let platform = UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #elseif os(visionOS)
        let platform = "visionos"
        #else
        let platform = "macos"
        #endif
        let js = """
        window.__ROADSTER_NATIVE = '\(platform)';
        navigator.vibrate = function (p) {
          var ms = Array.isArray(p) ? p.reduce(function (a, b) { return a + b; }, 0) : (+p || 0);
          try { window.webkit.messageHandlers.haptic.postMessage(ms); } catch (e) {}
          return true;
        };
        """
        config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(bridge, name: "haptic")

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = bridge
        web.allowsBackForwardNavigationGestures = false
        #if os(iOS) || os(visionOS)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #else
        web.setValue(false, forKey: "drawsBackground")
        #endif
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) { web.isInspectable = true }
        #endif
        web.load(URLRequest(url: startURL))
        return web
    }
}

#if os(macOS)
struct GameView: NSViewRepresentable {
    final class Coordinator { let bridge = NativeBridge() }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> WKWebView { GameWebViewFactory.make(bridge: context.coordinator.bridge) }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
#else
struct GameView: UIViewRepresentable {
    final class Coordinator { let bridge = NativeBridge() }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = true // no screen dimming mid-race
        #endif
        return GameWebViewFactory.make(bridge: context.coordinator.bridge)
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#endif
