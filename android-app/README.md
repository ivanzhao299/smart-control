# 金湖中控 Android 壳

> 一个简单的 WebView 壳, 业主在 APP 内配置 PWA 地址, 之后 APP 加载该地址.
> 体积 < 5MB, minSdk 24 (Android 7.0+).

## 主要功能

- 启动检测 SharedPreferences 是否保存 server URL
  - 没有 → 显示配置页 (URL 输入 + 测试连接 + 保存)
  - 有 → WebView 直接加载
- 右上角小齿轮按钮 → 回配置页 (业主切环境用)
- 加载失败 → 全屏错误覆盖 + 重试 / 切换服务器 双按钮
- 全屏沉浸模式 (无状态栏 / 导航栏), 跟 PWA 体验一致
- 禁缩放, 屏幕常亮 (展厅运营场景)
- 双击返回键退出
- 深色主题 (v3 配色, 跟 PWA 一致)

## 包名

`com.jinhu.smartcontrol`

## 构建方式 — 两个选项

### 选项 A: GitHub Actions 全自动发布 (2026-07-27 起, 业主零操作)

仓库已配 `.github/workflows/android-build.yml`, push 改动后全自动:

1. `assembleRelease` — 用仓库内**固定签名** `signing/internal.p12`
   (内部分发密钥, 非机密; 每次构建同签名, 终端可直接覆盖安装升级。
   此前用 assembleDebug, 每台 CI runner 的 debug 签名都不同, 覆盖安装必失败)
2. APK + manifest.json 自动提交到 `deploy/assets/app/` → 随部署链落到 GK9000
3. 后端启动自愈: 仓库带的版本比库里新 → 更新 `app_release` 表,
   downloadUrl 指向展厅本地 `/api/app/android/download`
4. 各终端 App 启动检查 `/api/app/android/latest` → 弹"发现新版本" →
   内网直接下载安装 (不再依赖 GitHub)

**发新版只需要**: 改 `app/build.gradle.kts` 的 versionCode +1、versionName,
push main, 等两轮 CI 跑绿即可。Actions 页面仍留 artifact 兜底。

### 选项 B: 本地 Android Studio (需装环境)

1. 装 [Android Studio](https://developer.android.com/studio) (含 JDK 17 + SDK 34)
2. Open Project → `~/projects/smart-control/android-app/`
3. Gradle Sync (首次几分钟)
4. Build → Build Bundle(s) / APK(s) → Build APK(s)
5. APK 输出: `app/build/outputs/apk/debug/app-debug.apk`

### Release 签名 (上架 Google Play 或正式分发)

```bash
# 1. 生成 keystore (一次性, 妥善保管)
keytool -genkey -v -keystore jinhu-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias jinhu

# 2. app/build.gradle.kts 加 signingConfigs (查 Android 文档)
# 3. ./gradlew assembleRelease
# 4. 输出: app/build/outputs/apk/release/app-release.apk
```

## 业主操作

1. 第一次开 APP → 看到配置页
2. 输入服务器地址 (e.g. `http://192.168.77.54:5173/control/`)
3. 点 "测试连接" → 看到绿色"连接成功" → 点 "保存并启动"
4. 进入 PWA → 看到 PWA 自己的 `/client-login` (业主输 1234 默认密码)
5. 之后开 APP → 直接进 PWA, 不再问地址 (除非业主主动点右上角齿轮)

## 切换服务器

WebView 加载后, **右上角 44×44 小齿轮按钮**, 半透明灰色, 点击 → 回配置页.

## 文件结构

```
android-app/
├── app/
│   ├── build.gradle.kts            # Android plugin + 依赖
│   └── src/main/
│       ├── AndroidManifest.xml     # 权限 / Activity 声明 / 网络配置
│       ├── kotlin/com/jinhu/smartcontrol/
│       │   ├── MainActivity.kt     # 主入口, 含 Config 和 WebView 切换
│       │   └── Prefs.kt            # SharedPreferences wrapper
│       └── res/
│           ├── layout/             # activity_main + panel_config
│           ├── values/             # strings/colors/themes (v3 配色)
│           ├── values-night/       # 夜间模式同款
│           ├── drawable/           # 按钮背景 / 输入框背景
│           └── xml/network_security_config.xml  # 允许明文 HTTP (局域网必须)
├── build.gradle.kts                # 顶层 plugin 声明
├── settings.gradle.kts             # repository 配置
├── gradle.properties               # Gradle JVM args
└── README.md (本文件)
```

## 已知限制

- **不能强制全屏**: Android 系统 immersive mode 业主上滑能调出状态栏 (Android 设计如此, 不能根本禁)
- **HTTP cleartext**: 默认允许任意 HTTP. 正式上线 Play Store 应限定到具体域名 (改 network_security_config.xml)
- **签名**: 当前 debug build, 用 Android 默认 debug keystore. 生产分发需自签

## 后续可加

- iOS 版本 (同思路, SwiftUI + WKWebView)
- 自动更新检查 (调 backend `/api/system/info` 看 versionCode 比较)
- 离线模式 (PWA 本身有 service worker, APP 壳不用额外做)
- 推送通知 (FCM, 后端推告警)
