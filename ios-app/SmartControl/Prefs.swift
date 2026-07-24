import Foundation

/// UserDefaults wrapper — 语义对齐安卓壳的 Prefs.kt:
/// 只存服务器地址 + 更新弹窗"稍后"的版本与时间。
enum Prefs {
    private static let keyServerUrl = "server_url"
    private static let keyDismissedVersion = "update_dismissed_version_code"
    private static let keyDismissedAt = "update_dismissed_at_ms"

    /// 安卓壳 BuildConfig.DEFAULT_SERVER_URL 同款默认值 (业主重新配置时不用从头输)
    static let defaultServerUrl = "http://192.168.124.11:5173/control/"

    static var serverUrl: String? {
        get { UserDefaults.standard.string(forKey: keyServerUrl) }
        set { UserDefaults.standard.set(newValue, forKey: keyServerUrl) }
    }

    static var dismissedVersion: Int {
        get { UserDefaults.standard.integer(forKey: keyDismissedVersion) }
        set { UserDefaults.standard.set(newValue, forKey: keyDismissedVersion) }
    }

    /// 毫秒时间戳, 对齐安卓的 System.currentTimeMillis()
    static var dismissedAtMs: Double {
        get { UserDefaults.standard.double(forKey: keyDismissedAt) }
        set { UserDefaults.standard.set(newValue, forKey: keyDismissedAt) }
    }

    static func setDismissed(versionCode: Int) {
        dismissedVersion = versionCode
        dismissedAtMs = Date().timeIntervalSince1970 * 1000
    }
}
