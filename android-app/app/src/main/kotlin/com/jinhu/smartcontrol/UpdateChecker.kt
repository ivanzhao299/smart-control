package com.jinhu.smartcontrol

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * 检查 backend 的 /api/app/android/latest, 决定是否弹"新版本"对话框.
 *
 * 规则:
 *   1. backend 返回 {enabled:false} 或 data:null → 不弹
 *   2. 远端 versionCode <= 本地 → 不弹
 *   3. 本地 < minSupportedVersionCode → 强制弹 (没"稍后" 按钮)
 *   4. forceUpdate=true → 强制弹
 *   5. 业主 7 天内对这个 versionCode dismiss 过 → 不弹 (除非 forceUpdate)
 *
 * 点击"立即更新" → Intent.ACTION_VIEW 跳浏览器, downloadUrl 通常是 GitHub release
 * asset, 业主下载完手动安装 (Android 不让 web 类源直接装).
 */
object UpdateChecker {

    private const val DISMISS_TTL_MS = 7L * 24 * 60 * 60 * 1000  // 7 天

    data class Latest(
        val versionCode: Int,
        val versionName: String,
        val downloadUrl: String,
        val notes: String?,
        val forceUpdate: Boolean,
        val minSupportedVersionCode: Int,
        val enabled: Boolean,
    )

    fun checkAsync(activity: AppCompatActivity, serverBaseUrl: String) {
        thread {
            val latest = fetchLatest(serverBaseUrl) ?: return@thread
            activity.runOnUiThread {
                decideAndShow(activity, latest)
            }
        }
    }

    private fun fetchLatest(serverBaseUrl: String): Latest? {
        val base = serverBaseUrl.trimEnd('/')
        val url = "$base/api/app/android/latest"
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            conn.requestMethod = "GET"
            if (conn.responseCode !in 200..299) {
                conn.disconnect()
                return null
            }
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val root = JSONObject(text)
            val data = root.optJSONObject("data") ?: return null
            // service 返回 data:null 表示无该平台数据
            if (data.length() == 0) return null
            Latest(
                versionCode = data.optInt("versionCode", -1),
                versionName = data.optString("versionName", "?"),
                downloadUrl = data.optString("downloadUrl", ""),
                notes = data.optString("notes", "").takeIf { it.isNotBlank() },
                forceUpdate = data.optBoolean("forceUpdate", false),
                minSupportedVersionCode = data.optInt("minSupportedVersionCode", 1),
                enabled = data.optBoolean("enabled", true),
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun decideAndShow(activity: AppCompatActivity, latest: Latest) {
        if (!latest.enabled) return
        val current = BuildConfig.VERSION_CODE
        // 远端版本不比本地高 → 不弹
        if (latest.versionCode <= current) return
        // 没有 downloadUrl → 不弹 (业主没填好)
        if (latest.downloadUrl.isBlank()) return

        val mustUpdate = latest.forceUpdate || current < latest.minSupportedVersionCode

        // 业主"稍后"过这个版本, 7 天内不再弹 (除非强制)
        if (!mustUpdate) {
            val dismissedVer = Prefs.getDismissedVersion(activity)
            val dismissedAt = Prefs.getDismissedAt(activity)
            if (dismissedVer == latest.versionCode &&
                System.currentTimeMillis() - dismissedAt < DISMISS_TTL_MS) {
                return
            }
        }

        showDialog(activity, latest, mustUpdate)
    }

    private fun showDialog(activity: AppCompatActivity, latest: Latest, mustUpdate: Boolean) {
        val title = if (mustUpdate) "必须更新" else "发现新版本 v${latest.versionName}"
        val message = buildString {
            if (mustUpdate) {
                append("当前版本 (v${BuildConfig.VERSION_NAME}) 不再支持, 必须升级到 v${latest.versionName} 才能继续使用.\n\n")
            }
            if (!latest.notes.isNullOrBlank()) {
                append(latest.notes)
            } else {
                append("点击下方按钮跳转浏览器下载新版本 APK.")
            }
        }
        val builder = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setCancelable(!mustUpdate)
            .setPositiveButton("立即更新") { _, _ ->
                openInBrowser(activity, latest.downloadUrl)
                if (mustUpdate) activity.finish()
            }
        if (!mustUpdate) {
            builder.setNegativeButton("稍后") { d, _ ->
                Prefs.setDismissed(activity, latest.versionCode)
                d.dismiss()
            }
        }
        builder.show()
    }

    private fun openInBrowser(ctx: Context, url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
        } catch (e: Exception) {
            // 没浏览器 → no-op (业主可以自己复制链接, 概率低)
        }
    }
}
