import Foundation
import Security

/// 面容登录密码的 Keychain 存取 (2026-07-31) — 语义对齐安卓壳的
/// EncryptedSharedPreferences: 本机专用 (ThisDeviceOnly, 不进 iCloud 同步),
/// 解锁后可读; 读取动作只由壳在系统面容验证通过后发起。
enum KeychainStore {
    private static let service = "com.jinhu.smartcontrol.bio"

    /// scope: "client"=业主访问密码 (v1.1.9 兼容账户名) / "admin"=后台管理密码 (v1.1.10)
    private static func account(_ scope: String) -> String {
        scope == "admin" ? "admin-password" : "client-password"
    }

    static func password(scope: String = "client") -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(scope),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func hasPassword(scope: String = "client") -> Bool { password(scope: scope) != nil }

    static func set(_ pwd: String, scope: String = "client") {
        clear(scope: scope)
        guard let data = pwd.data(using: .utf8) else { return }
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(scope),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: data,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func clear(scope: String = "client") {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(scope),
        ]
        SecItemDelete(query as CFDictionary)
    }
}
