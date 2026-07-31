package com.jinhu.smartcontrol

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences wrapper — 只存一件事: 业主配的服务器地址.
 * Key 命名跟 frontend localStorage 区分 (那边是 sc.client.baseURL).
 */
object Prefs {
    private const val PREFS_NAME = "jinhu_shell"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_REMOTE_URL = "remote_url"
    private const val KEY_DISMISSED_VERSION = "update_dismissed_version_code"
    private const val KEY_DISMISSED_AT = "update_dismissed_at_ms"
    private const val KEY_BIOMETRIC_LOCK = "biometric_lock"

    fun get(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getServerUrl(ctx: Context): String? = get(ctx).getString(KEY_SERVER_URL, null)

    fun setServerUrl(ctx: Context, url: String) {
        get(ctx).edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun clearServerUrl(ctx: Context) {
        get(ctx).edit().remove(KEY_SERVER_URL).apply()
    }

    /** 远程地址 (隧道/公网, 可选) — 现场地址探不通时自动切它, 见 MainActivity.resolveAndLoad */
    fun getRemoteUrl(ctx: Context): String? = get(ctx).getString(KEY_REMOTE_URL, null)

    fun setRemoteUrl(ctx: Context, url: String?) {
        if (url.isNullOrBlank()) get(ctx).edit().remove(KEY_REMOTE_URL).apply()
        else get(ctx).edit().putString(KEY_REMOTE_URL, url).apply()
    }

    // ============ 面容登录密码 (2026-07-31) ============
    // 访问密码存 Android Keystore 加密的 SharedPreferences (独立文件), 只在
    // 系统生物验证通过后由壳读出注回登录页。个别 ROM 的 Keystore 会抽风,
    // 初始化失败就退化为普通私有 prefs (仍是应用私有目录, 不比 PWA 现状
    // localStorage 明文差) —— 功能可用性优先。
    private const val SECURE_PREFS = "jinhu_secure"
    private const val KEY_BIO_PASSWORD = "bio_password"
    private var securePrefs: SharedPreferences? = null

    private fun secure(ctx: Context): SharedPreferences {
        securePrefs?.let { return it }
        val sp = try {
            val master = androidx.security.crypto.MasterKey.Builder(ctx)
                .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                .build()
            androidx.security.crypto.EncryptedSharedPreferences.create(
                ctx, SECURE_PREFS, master,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            ctx.getSharedPreferences(SECURE_PREFS + "_plain", Context.MODE_PRIVATE)
        }
        securePrefs = sp
        return sp
    }

    /** scope: "client"=业主访问密码 (兼容 v1.1.9 老 key) / "admin"=后台管理密码 (v1.1.10) */
    private fun bioKey(scope: String): String =
        if (scope == "admin") KEY_BIO_PASSWORD + "_admin" else KEY_BIO_PASSWORD

    fun getBioPassword(ctx: Context, scope: String = "client"): String? =
        secure(ctx).getString(bioKey(scope), null)

    fun setBioPassword(ctx: Context, pwd: String, scope: String = "client") {
        secure(ctx).edit().putString(bioKey(scope), pwd).apply()
    }

    fun clearBioPassword(ctx: Context, scope: String = "client") {
        secure(ctx).edit().remove(bioKey(scope)).apply()
    }

    /** 面容/指纹应用锁 (2026-07-30 业主要求, 默认关) — 开着时启动/回前台超时要先过系统生物验证 */
    fun isBiometricLock(ctx: Context): Boolean = get(ctx).getBoolean(KEY_BIOMETRIC_LOCK, false)

    fun setBiometricLock(ctx: Context, on: Boolean) {
        get(ctx).edit().putBoolean(KEY_BIOMETRIC_LOCK, on).apply()
    }

    /** 业主点了"稍后"对哪个 versionCode dismiss 过 */
    fun getDismissedVersion(ctx: Context): Int = get(ctx).getInt(KEY_DISMISSED_VERSION, -1)
    fun getDismissedAt(ctx: Context): Long = get(ctx).getLong(KEY_DISMISSED_AT, 0L)

    fun setDismissed(ctx: Context, versionCode: Int) {
        get(ctx).edit()
            .putInt(KEY_DISMISSED_VERSION, versionCode)
            .putLong(KEY_DISMISSED_AT, System.currentTimeMillis())
            .apply()
    }
}
