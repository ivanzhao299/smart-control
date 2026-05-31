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

    fun get(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getServerUrl(ctx: Context): String? = get(ctx).getString(KEY_SERVER_URL, null)

    fun setServerUrl(ctx: Context, url: String) {
        get(ctx).edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun clearServerUrl(ctx: Context) {
        get(ctx).edit().remove(KEY_SERVER_URL).apply()
    }
}
