import SwiftUI

/// 单页状态机 — 对齐安卓壳 MainActivity:
///   无 server_url → 配置页; 有 → 全屏 WebView。
///   齿轮按钮: 只在 PWA 登录页 (/client-login) 或加载出错时显示 (业主 2026-05-31:
///   登录成功后这个图标没必要再存在)。
///   错误覆盖层: 重试 / 切换服务器。
///   进 WebView 后异步检查 APP 自身版本 (UpdateChecker)。
struct ContentView: View {
    @State private var serverUrl: String? = Prefs.serverUrl
    /// 探测选中的实际加载地址 (现场 or 远程), nil = 正在探测
    @State private var activeUrl: String?
    @State private var showConfig = Prefs.serverUrl == nil
    @State private var gearVisible = false
    @State private var errorText: String?
    @State private var reloadToken = 0
    @State private var updatePrompt: UpdateChecker.Prompt?
    @StateObject private var netWatcher = NetWatcher()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if showConfig || serverUrl == nil {
                ConfigView { saved in
                    serverUrl = saved
                    showConfig = false
                    errorText = nil
                    activeUrl = nil
                    reResolve()
                    checkUpdate(saved)
                }
            } else if activeUrl == nil {
                // 正在探测现场/远程哪个通
                VStack(spacing: 14) {
                    ProgressView().tint(.white)
                    Text("正在连接服务器…")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                }
            } else if let s = activeUrl, let u = URL(string: s) {
                WebView(
                    initialUrl: u,
                    reloadToken: reloadToken,
                    onUrlChange: { url in
                        // 对齐安卓 applyGearVisibility: 登录页才露齿轮
                        gearVisible = url.contains("/client-login")
                    },
                    onError: { msg in
                        errorText = msg
                    }
                )
                .ignoresSafeArea()

                // 齿轮 (右上角) — 登录页或出错时可切服务器
                if gearVisible || errorText != nil {
                    VStack {
                        HStack {
                            Spacer()
                            Button {
                                showConfig = true
                                errorText = nil
                            } label: {
                                Image(systemName: "gearshape.fill")
                                    .font(.system(size: 18))
                                    .foregroundColor(.white.opacity(0.85))
                                    .padding(10)
                                    .background(Color.black.opacity(0.35))
                                    .clipShape(Circle())
                            }
                            .padding(.top, 14)
                            .padding(.trailing, 14)
                        }
                        Spacer()
                    }
                }

                // 错误覆盖层 — 对齐安卓 errorOverlay
                if let err = errorText {
                    VStack(spacing: 18) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 44))
                            .foregroundColor(.orange)
                        Text("页面加载失败")
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundColor(.white)
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 30)
                        HStack(spacing: 14) {
                            Button("重试") {
                                errorText = nil
                                reloadToken += 1
                            }
                            .padding(.horizontal, 26).padding(.vertical, 11)
                            .background(Color.accentColor)
                            .foregroundColor(.white)
                            .cornerRadius(9)

                            Button("切换服务器") {
                                errorText = nil
                                showConfig = true
                            }
                            .padding(.horizontal, 22).padding(.vertical, 11)
                            .background(Color.white.opacity(0.14))
                            .foregroundColor(.white)
                            .cornerRadius(9)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.92).ignoresSafeArea())
                }
            }
        }
        // 状态栏隐藏走 Info.plist 的 UIStatusBarHidden (statusBarHidden() 是 iOS16+ API)
        .onAppear {
            // 对应安卓 FLAG_KEEP_SCREEN_ON — 展厅平板常亮
            UIApplication.shared.isIdleTimerDisabled = true
            // 网络一变 (进出展厅 Wi-Fi / 隧道连断) 就重探现场/远程哪个通, 自动切换
            netWatcher.onChange = { reResolve() }
            netWatcher.start()
            reResolve()
            if let s = serverUrl { checkUpdate(s) }
        }
        .onDisappear { netWatcher.stop() }
        .alert(item: $updatePrompt) { p in
            if p.mustUpdate {
                return Alert(
                    title: Text(p.title),
                    message: Text(p.message),
                    dismissButton: .default(Text("立即更新")) {
                        UpdateChecker.openDownload(p.downloadUrl)
                    }
                )
            }
            return Alert(
                title: Text(p.title),
                message: Text(p.message),
                primaryButton: .default(Text("立即更新")) {
                    UpdateChecker.openDownload(p.downloadUrl)
                },
                secondaryButton: .cancel(Text("稍后")) {
                    Prefs.setDismissed(versionCode: p.versionCode)
                }
            )
        }
    }

    /// 现场优先探测选地址; 选中的变了才动 WebView (initialUrl 变化会触发重载)
    private func reResolve() {
        guard let local = serverUrl, !showConfig else { return }
        ServerResolver.resolve(local: local, remote: Prefs.remoteUrl) { chosen in
            if chosen != activeUrl {
                errorText = nil
                activeUrl = chosen
            }
        }
    }

    private func checkUpdate(_ base: String) {
        UpdateChecker.check(serverBaseUrl: base) { prompt in
            updatePrompt = prompt
        }
    }
}
