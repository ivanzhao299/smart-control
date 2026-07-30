import LocalAuthentication

/// 面容 ID / 触控 ID / 锁屏密码验证 — 语义对齐安卓壳的 BiometricPrompt 封装。
/// `.deviceOwnerAuthentication` 自动落到面容→触控→锁屏密码, 与安卓
/// BIOMETRIC_WEAK|DEVICE_CREDENTIAL 同一策略。
enum BiometricAuth {
    /// 设备是否配了任一可用验证方式 (面容/触控/锁屏密码)
    static var available: Bool {
        var err: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
    }

    /// 弹系统验证; 回调保证回主线程
    static func authenticate(reason: String, completion: @escaping (Bool) -> Void) {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            DispatchQueue.main.async { completion(false) }
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
            DispatchQueue.main.async { completion(ok) }
        }
    }
}
