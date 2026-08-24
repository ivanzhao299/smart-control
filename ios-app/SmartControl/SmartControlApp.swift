import SwiftUI

/// 金湖展贸中心智控 iOS 壳 — WKWebView 包 PWA, 行为对齐安卓壳 (android-app/):
/// 配置服务器地址 → 全屏 WebView 加载 PWA → 检查 APP 自身更新。
@main
struct SmartControlApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
