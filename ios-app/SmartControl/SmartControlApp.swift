import SwiftUI

/// 金湖展贸中心原生 iOS 控制系统。
/// 日常控制由 SwiftUI + URLSession 原生实现；复杂管理工作台保留兼容入口。
@main
struct SmartControlApp: App {
    var body: some Scene {
        WindowGroup {
            NativeRootView()
                .preferredColorScheme(.dark)
        }
    }
}
