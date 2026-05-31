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
    private const val KEY_DISMISSED_VERSION = "update_dismissed_version_code"
    private const val KEY_DISMISSED_AT = "update_dismissed_at_ms"

    fun get(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getServerUrl(ctx: Context): String? = get(ctx).getString(KEY_SERVER_URL, null)

    fun setServerUrl(ctx: Context, url: String) {
        get(ctx).edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun clearServerUrl(ctx: Context) {
        get(ctx).edit().remove(KEY_SERVER_URL).apply()
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
