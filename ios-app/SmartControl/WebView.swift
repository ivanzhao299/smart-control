import SwiftUI
import WebKit

/// WKWebView 的 SwiftUI 包装 — 行为对齐安卓壳 setupWebView():
///   - JS / localStorage 开 (PWA 存 client token 靠它)
///   - 媒体自动播放不要求手势
///   - URL 变化回调 (含 SPA pushState — 用 KVO 观察 webView.url, 等价安卓的
///     doUpdateVisitedHistory) → 外层决定齿轮按钮显隐
///   - 主文档加载失败回调 → 外层弹错误覆盖层
struct WebView: UIViewRepresentable {
    let initialUrl: URL
    /// 触发重载的信号 (错误覆盖层"重试"按钮 +1)
    let reloadToken: Int
    let onUrlChange: (String) -> Void
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // 对齐安卓 UA 后缀 (userAgentString + " JinhuShell/x"), 前端可识别壳环境
        config.applicationNameForUserAgent = "JinhuShell/\(UpdateChecker.localVersionName)"
        config.websiteDataStore = .default()

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = context.coordinator
        wv.scrollView.bounces = false
        wv.scrollView.showsVerticalScrollIndicator = false
        wv.scrollView.showsHorizontalScrollIndicator = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.allowsBackForwardNavigationGestures = true
        wv.isOpaque = false
        wv.backgroundColor = .black

        // SPA 的 router.push 不走 didCommit, 但 webView.url 会变 — KVO 盯它
        // (闭包只捕获 coordinator 引用, 不捕获 context 结构体)
        let coordinator = context.coordinator
        coordinator.urlObservation = wv.observe(\.url, options: [.new]) { _, change in
            if let u = change.newValue ?? nil {
                DispatchQueue.main.async { coordinator.parent.onUrlChange(u.absoluteString) }
            }
        }

        wv.load(URLRequest(url: initialUrl))
        return wv
    }

    func updateUIView(_ wv: WKWebView, context: Context) {
        // SwiftUI 每次重建本结构体, coordinator 里的引用要跟上 (否则回调捕获旧闭包)
        context.coordinator.parent = self
        // 服务器地址换了 → 重新加载新 origin
        if context.coordinator.lastInitialUrl != initialUrl {
            context.coordinator.lastInitialUrl = initialUrl
            wv.load(URLRequest(url: initialUrl))
            return
        }
        // 错误覆盖层"重试"
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            if wv.url == nil {
                wv.load(URLRequest(url: initialUrl))
            } else {
                wv.reload()
            }
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebView
        var urlObservation: NSKeyValueObservation?
        var lastInitialUrl: URL?
        var lastReloadToken: Int

        init(_ parent: WebView) {
            self.parent = parent
            self.lastInitialUrl = parent.initialUrl
            self.lastReloadToken = parent.reloadToken
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let u = webView.url?.absoluteString { parent.onUrlChange(u) }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            let e = error as NSError
            // 用户取消 (如快速连续导航) 不算错误
            if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
            parent.onError("\(e.code): \(e.localizedDescription)")
        }

        deinit { urlObservation?.invalidate() }
    }
}
