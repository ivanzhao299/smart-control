import Foundation
import UIKit

/// 检查 backend 的 /api/app/ios/latest, 决定是否弹"新版本"提示。
/// 规则 1:1 对齐安卓壳 UpdateChecker.kt:
///   1. enabled=false 或 data 为空 → 不弹
///   2. 远端 versionCode <= 本地 → 不弹
///   3. 本地 < minSupportedVersionCode 或 forceUpdate=true → 强制弹 (没"稍后")
///   4. 业主 7 天内对这个 versionCode 点过"稍后" → 不弹 (除非强制)
/// "立即更新" → 用 Safari 打开 downloadUrl (侧载安装包页面 / TestFlight 链接均可)。
enum UpdateChecker {
    static let dismissTtlMs: Double = 7 * 24 * 60 * 60 * 1000

    struct Latest {
        let versionCode: Int
        let versionName: String
        let downloadUrl: String
        let notes: String?
        let forceUpdate: Bool
        let minSupportedVersionCode: Int
        let enabled: Bool
    }

    /// 弹窗内容 — ContentView 用它渲染 SwiftUI alert
    struct Prompt: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        let downloadUrl: String
        let mustUpdate: Bool
        let versionCode: Int
    }

    static var localVersionCode: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1
    }

    static var localVersionName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    /// 拉最新版本信息并按规则决定要不要提示; 主线程回调 (nil = 不弹)
    static func check(serverBaseUrl: String, completion: @escaping (Prompt?) -> Void) {
        guard let url = ServerResolver.apiURL(from: serverBaseUrl, endpoint: "/api/app/ios/latest") else {
            completion(nil)
            return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 4
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            var prompt: Prompt?
            defer { DispatchQueue.main.async { completion(prompt) } }
            guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let data = data,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let d = root["data"] as? [String: Any], !d.isEmpty else { return }
            let latest = Latest(
                versionCode: d["versionCode"] as? Int ?? -1,
                versionName: d["versionName"] as? String ?? "?",
                downloadUrl: d["downloadUrl"] as? String ?? "",
                notes: (d["notes"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                forceUpdate: d["forceUpdate"] as? Bool ?? false,
                minSupportedVersionCode: d["minSupportedVersionCode"] as? Int ?? 1,
                enabled: d["enabled"] as? Bool ?? true
            )
            prompt = decide(latest)
        }.resume()
    }

    private static func decide(_ latest: Latest) -> Prompt? {
        guard latest.enabled else { return nil }
        let current = localVersionCode
        guard latest.versionCode > current else { return nil }
        guard !latest.downloadUrl.isEmpty else { return nil }

        let must = latest.forceUpdate || current < latest.minSupportedVersionCode
        if !must {
            let nowMs = Date().timeIntervalSince1970 * 1000
            if Prefs.dismissedVersion == latest.versionCode,
               nowMs - Prefs.dismissedAtMs < dismissTtlMs {
                return nil
            }
        }
        let title = must ? "必须更新" : "发现新版本 v\(latest.versionName)"
        var message = ""
        if must {
            message += "当前版本 (v\(localVersionName)) 不再支持, 必须升级到 v\(latest.versionName) 才能继续使用。\n\n"
        }
        message += latest.notes ?? "点击下方按钮跳转下载新版本。"
        return Prompt(title: title, message: message, downloadUrl: latest.downloadUrl,
                      mustUpdate: must, versionCode: latest.versionCode)
    }

    static func openDownload(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        UIApplication.shared.open(url)
    }
}
