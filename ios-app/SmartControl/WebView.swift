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
    /// 前端真正完成挂载（boot-splash 已移除且 #app 已有内容），不是仅 HTML 导航完成。
    let onReady: () -> Void
    let onError: (String) -> Void
    /// WebKit 内容进程被系统终止时通知外层重建 WebView。外层只自动恢复一次，
    /// 避免崩溃循环；第二次才把错误交给用户处理。
    let onProcessTermination: () -> Void
    /// 本次重建是否需要清理当前站点的 SW/HTTP 缓存。
    let forceCacheReset: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // 对齐安卓 UA 后缀 (userAgentString + " JinhuShell/x"), 前端可识别壳环境
        config.applicationNameForUserAgent = "JinhuShell/\(UpdateChecker.localVersionName)"
        config.websiteDataStore = .default()

        // A2 (2026-07-25): 触感桥 — window.JinhuShell.vibrate(ms) → UIImpactFeedback。
        // Face ID is retired. Keep inert bridge methods for cached web clients;
        // do not access the biometric keychain or invoke system authentication.
        let bridge = WKUserScript(
            source: """
            window.JinhuShell={
              platform:'ios',
              vibrate:function(ms){try{window.webkit.messageHandlers.haptic.postMessage(ms)}catch(e){}},
              __bio:{available:false,saved:{client:false,admin:false}},
              bioInfoScoped:function(s){return JSON.stringify({available:this.__bio.available,saved:!!this.__bio.saved[s==='admin'?'admin':'client']})},
              saveBioPasswordScoped:function(){},
              clearBioPasswordScoped:function(){},
              requestBioLoginScoped:function(){if(window.__jinhuBioLoginFail)window.__jinhuBioLoginFail()},
              bioInfo:function(){return this.bioInfoScoped('client')},
              saveBioPassword:function(p){this.saveBioPasswordScoped('client',p)},
              clearBioPassword:function(){this.clearBioPasswordScoped('client')},
              requestBioLogin:function(){this.requestBioLoginScoped('client')}
            };
            window.addEventListener('error',function(e){
              try{window.webkit.messageHandlers.jinhuShell.postMessage({type:'pageError',message:String(e.message||'JavaScript 启动失败')+(e.filename?'\n'+e.filename:'')})}catch(_){}
            });
            window.addEventListener('unhandledrejection',function(e){
              try{window.webkit.messageHandlers.jinhuShell.postMessage({type:'pageError',message:String((e.reason&&e.reason.message)||e.reason||'页面初始化失败')})}catch(_){}
            });
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(bridge)
        // HTML 的 didFinish 不代表 Vue 已启动：JS chunk 损坏/缓存错配时，PWA 的
        // boot-splash 会一直盖住页面。轮询真实挂载状态并回报原生层，由原生看门狗兜底。
        let readyProbe = WKUserScript(
            source: """
            (function(){
              var tries=0;
              var timer=setInterval(function(){
                tries++;
                var app=document.getElementById('app');
                var splash=document.getElementById('boot-splash');
                if(app && app.childElementCount>0 && !splash){
                  clearInterval(timer);
                  try{window.webkit.messageHandlers.jinhuShell.postMessage({type:'pageReady'})}catch(e){}
                } else if(tries>=60){ clearInterval(timer); }
              },250);
            })();
            """,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        config.userContentController.addUserScript(readyProbe)
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

        // 2.1.4 之前可能缓存了指向已缺失 chunk 的 Service Worker，服务器修复后
        // WKWebView 仍会被旧离线缓存劫持。每个原生版本首次启动只清 SW + HTTP
        // cache，保留 localStorage/cookies（登录态不会丢）。
        let cacheResetKey = "web-cache-reset-\(UpdateChecker.localVersionName)"
        if forceCacheReset || !UserDefaults.standard.bool(forKey: cacheResetKey) {
            let types: Set<String> = [
                WKWebsiteDataTypeServiceWorkerRegistrations,
                WKWebsiteDataTypeDiskCache,
                WKWebsiteDataTypeMemoryCache,
            ]
            config.websiteDataStore.removeData(ofTypes: types, modifiedSince: .distantPast) {
                if !forceCacheReset { UserDefaults.standard.set(true, forKey: cacheResetKey) }
                DispatchQueue.main.async { wv.load(URLRequest(url: initialUrl)) }
            }
        } else {
            wv.load(URLRequest(url: initialUrl))
        }
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
            case "pageReady":
                DispatchQueue.main.async { self.parent.onReady() }
            case "pageError":
                let detail = body["message"] as? String ?? "页面脚本启动失败"
                DispatchQueue.main.async { self.parent.onError(detail) }
            case "saveBio", "clearBio":
                break
            case "bioLogin":
                message.webView?.evaluateJavaScript("window.__jinhuBioLoginFail&&window.__jinhuBioLoginFail()")
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

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.onProcessTermination()
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
