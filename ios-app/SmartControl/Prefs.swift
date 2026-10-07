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
    // 这是到 GK9000 的远程入口，不是另一台生产服务器。
    static let defaultRemoteUrl = "https://erp.cnjinhu.com/control/"
    private static let retiredPwaHost = "park.cnjinhu.com"
    private static let productionRemoteHost = "erp.cnjinhu.top"
    private static let retiredRemotePort = 8443

    static var serverUrl: String? {
        get {
            guard let saved = UserDefaults.standard.string(forKey: keyServerUrl) else { return nil }
            let normalized = normalizedServerUrl(saved)
            if normalized != saved { UserDefaults.standard.set(normalized, forKey: keyServerUrl) }
            return normalized
        }
        set {
            guard let value = newValue else {
                UserDefaults.standard.removeObject(forKey: keyServerUrl)
                return
            }
            UserDefaults.standard.set(normalizedServerUrl(value), forKey: keyServerUrl)
        }
    }

    /// 远程地址 (隧道/公网, 可选) — 现场地址探不通时自动切它
    static var remoteUrl: String? {
        get {
            guard let saved = UserDefaults.standard.string(forKey: keyRemoteUrl) else { return nil }
            let normalized = normalizedRemoteUrl(saved)
            if normalized != saved { UserDefaults.standard.set(normalized, forKey: keyRemoteUrl) }
            return normalized
        }
        set {
            if let v = newValue, !v.isEmpty {
                UserDefaults.standard.set(normalizedRemoteUrl(v), forKey: keyRemoteUrl)
            }
            else { UserDefaults.standard.removeObject(forKey: keyRemoteUrl) }
        }
    }

    /// 2.1.6 曾误把浏览器 PWA 入口写进原生 App 配置。现场地址栏和远程地址栏
    /// 都在读写时收敛，避免旧缓存或再次手填把 App 带回错误服务器。
    private static func normalizedServerUrl(_ value: String) -> String {
        URL(string: value)?.host?.lowercased() == retiredPwaHost ? defaultServerUrl : value
    }

    /// 新公网代理使用标准 HTTPS 443。迁移历史 8443 保存值后，客户端不再依赖
    /// 云安全组中的非标准端口，同时继续使用原生产域名和同一套业务数据。
    private static func normalizedRemoteUrl(_ value: String) -> String {
        guard let url = URL(string: value), let host = url.host?.lowercased() else { return value }
        if host == retiredPwaHost || (host == productionRemoteHost && url.port == retiredRemotePort) {
            return defaultRemoteUrl
        }
        return value
    }

    /// Retire the old app-lock flag on upgrade without touching normal login data.
    static func removeLegacyBiometricLock() {
        UserDefaults.standard.removeObject(forKey: keyBiometricLock)
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
