import SwiftUI
import UIKit
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

        // A2 (2026-07-25): 触感桥 — window.JinhuShell.vibrate(ms) → UIImpactFeedback。
        // 2026-07-31 扩展面容登录: bioInfo (同步读缓存态) / saveBioPassword /
        // clearBioPassword / requestBioLogin (结果经 __jinhuBioLoginOk/Fail 回调)。
        // WKWebView 消息通道天然异步, 所以 available/saved 在注入时算好嵌进脚本,
        // save/clear 时 JS 侧乐观同步更新缓存 —— 与安卓壳的同步接口拉平。
        let bioAvailable = BiometricAuth.available ? "true" : "false"
        let bioSaved = KeychainStore.hasPassword ? "true" : "false"
        let bridge = WKUserScript(
            source: """
            window.JinhuShell={
              vibrate:function(ms){try{window.webkit.messageHandlers.haptic.postMessage(ms)}catch(e){}},
              __bio:{available:\(bioAvailable),saved:\(bioSaved)},
              bioInfo:function(){return JSON.stringify(this.__bio)},
              saveBioPassword:function(p){try{this.__bio.saved=true;window.webkit.messageHandlers.jinhuShell.postMessage({type:'saveBio',pwd:String(p)})}catch(e){}},
              clearBioPassword:function(){try{this.__bio.saved=false;window.webkit.messageHandlers.jinhuShell.postMessage({type:'clearBio'})}catch(e){}},
              requestBioLogin:function(){try{window.webkit.messageHandlers.jinhuShell.postMessage({type:'bioLogin'})}catch(e){}}
            };
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(bridge)
        config.userContentController.add(context.coordinator, name: "haptic")
        config.userContentController.add(context.coordinator, name: "jinhuShell")

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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "haptic" {
                let ms = (message.body as? NSNumber)?.intValue ?? 12
                let style: UIImpactFeedbackGenerator.FeedbackStyle = ms >= 20 ? .medium : .light
                UIImpactFeedbackGenerator(style: style).impactOccurred()
                return
            }
            guard message.name == "jinhuShell",
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else { return }
            switch type {
            case "saveBio":
                if let pwd = body["pwd"] as? String, !pwd.isEmpty { KeychainStore.set(pwd) }
            case "clearBio":
                KeychainStore.clear()
            case "bioLogin":
                let wv = message.webView
                guard let pwd = KeychainStore.password, BiometricAuth.available else {
                    wv?.evaluateJavaScript("window.__jinhuBioLoginFail&&window.__jinhuBioLoginFail()")
                    return
                }
                BiometricAuth.authenticate(reason: "面容登录展厅中控") { ok in
                    guard ok else {
                        wv?.evaluateJavaScript("window.__jinhuBioLoginFail&&window.__jinhuBioLoginFail()")
                        return
                    }
                    // JSON 编码做 JS 字符串字面量转义 (密码可能含引号/反斜杠)
                    let quoted = (try? JSONSerialization.data(withJSONObject: pwd, options: .fragmentsAllowed))
                        .flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                    wv?.evaluateJavaScript("window.__jinhuBioLoginOk&&window.__jinhuBioLoginOk(\(quoted))")
                }
            default:
                break
            }
        }

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
