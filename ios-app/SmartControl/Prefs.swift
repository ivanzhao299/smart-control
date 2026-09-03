import Foundation

/// UserDefaults wrapper — 语义对齐安卓壳的 Prefs.kt:
/// 只存服务器地址 + 更新弹窗"稍后"的版本与时间。
enum Prefs {
    private static let keyServerUrl = "server_url"
    private static let keyRemoteUrl = "remote_url"
    private static let keyDismissedVersion = "update_dismissed_version_code"
    private static let keyDismissedAt = "update_dismissed_at_ms"
    private static let keyBiometricLock = "biometric_lock"

    /// 展厅现场地址默认值 (GK9000 静态 IP; 业主重新配置时不用从头输)
    static let defaultServerUrl = "http://192.168.77.54:5173/control/"
    /// 远程隧道地址默认提示 (WireGuard 里 GK9000 的地址)
    static let defaultRemoteUrl = "http://10.66.66.3:5173/control/"
    private static let retiredRemoteUrls = [
        "https://erp.cnjinhu.top:8443/control/",
        "https://erp.cnjinhu.top:8443/control"
    ]

    static var serverUrl: String? {
        get { UserDefaults.standard.string(forKey: keyServerUrl) }
        set { UserDefaults.standard.set(newValue, forKey: keyServerUrl) }
    }

    /// 远程地址 (隧道/公网, 可选) — 现场地址探不通时自动切它
    static var remoteUrl: String? {
        get {
            guard let stored = UserDefaults.standard.string(forKey: keyRemoteUrl) else { return nil }
            // 2.1.2: 旧公网入口不再作为生产端。已安装设备自动迁移到
            // GK9000 WireGuard 地址，避免继续选中历史反代。
            if retiredRemoteUrls.contains(stored) {
                UserDefaults.standard.set(defaultRemoteUrl, forKey: keyRemoteUrl)
                return defaultRemoteUrl
            }
            return stored
        }
        set {
            if let v = newValue, !v.isEmpty { UserDefaults.standard.set(v, forKey: keyRemoteUrl) }
            else { UserDefaults.standard.removeObject(forKey: keyRemoteUrl) }
        }
    }

    /// 面容 ID 应用锁 (2026-07-30 业主要求, 默认关) — 开着时启动/回前台超时先过系统验证
    static var biometricLock: Bool {
        get { UserDefaults.standard.bool(forKey: keyBiometricLock) }
        set { UserDefaults.standard.set(newValue, forKey: keyBiometricLock) }
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
