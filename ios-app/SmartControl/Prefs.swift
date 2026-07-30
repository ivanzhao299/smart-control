import Foundation

/// UserDefaults wrapper — 语义对齐安卓壳的 Prefs.kt:
/// 只存服务器地址 + 更新弹窗"稍后"的版本与时间。
enum Prefs {
    private static let keyServerUrl = "server_url"
    private static let keyRemoteUrl = "remote_url"
    private static let keyDismissedVersion = "update_dismissed_version_code"
    private static let keyDismissedAt = "update_dismissed_at_ms"

    /// 展厅现场地址默认值 (GK9000 静态 IP; 业主重新配置时不用从头输)
    static let defaultServerUrl = "http://192.168.77.54:5173/control/"
    /// 远程隧道地址默认提示 (WireGuard 里 GK9000 的地址)
    static let defaultRemoteUrl = "https://erp.cnjinhu.top:8443/control/"

    static var serverUrl: String? {
        get { UserDefaults.standard.string(forKey: keyServerUrl) }
        set { UserDefaults.standard.set(newValue, forKey: keyServerUrl) }
    }

    /// 远程地址 (隧道/公网, 可选) — 现场地址探不通时自动切它
    static var remoteUrl: String? {
        get { UserDefaults.standard.string(forKey: keyRemoteUrl) }
        set {
            if let v = newValue, !v.isEmpty { UserDefaults.standard.set(v, forKey: keyRemoteUrl) }
            else { UserDefaults.standard.removeObject(forKey: keyRemoteUrl) }
        }
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
