import SwiftUI

/// 服务器配置页 — 对齐安卓壳 panel_config:
/// 输 url → 测试 (GET /api/client-auth/ping, 显示服务器时间) → 保存进 WebView。
struct ConfigView: View {
    @State private var urlText: String
    @State private var remoteText: String
    @State private var testing = false
    @State private var statusText: String?
    @State private var statusOk = false
    let onSave: (String) -> Void

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
        _urlText = State(initialValue: Prefs.serverUrl ?? Prefs.defaultServerUrl)
        _remoteText = State(initialValue: Prefs.remoteUrl ?? "")
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("金湖智控")
                .font(.system(size: 30, weight: .bold))
            Text("配置一次, 现场/远程自动切换")
                .font(.system(size: 15))
                .foregroundColor(.secondary)

            VStack(alignment: .leading, spacing: 6) {
                Text("现场地址 (展厅局域网)")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                TextField("http://192.168.77.54:5173/control/", text: $urlText)
                    .keyboardType(.URL)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .padding(12)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(10)
            }
            .padding(.horizontal, 28)

            VStack(alignment: .leading, spacing: 6) {
                Text("远程地址 (隧道/公网, 可选)")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                TextField(Prefs.defaultRemoteUrl, text: $remoteText)
                    .keyboardType(.URL)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .padding(12)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(10)
            }
            .padding(.horizontal, 28)

            if let s = statusText {
                Text(s)
                    .font(.system(size: 13))
                    .foregroundColor(statusOk ? .green : .red)
                    .padding(.horizontal, 28)
            }

            HStack(spacing: 14) {
                Button(action: onTest) {
                    Text(testing ? "测试中…" : "测试连接")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .disabled(testing)
                .background(Color(.tertiarySystemBackground))
                .cornerRadius(10)

                Button(action: doSave) {
                    Text("保存并进入")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundColor(.white)
                }
                .background(Color.accentColor)
                .cornerRadius(10)
            }
            .padding(.horizontal, 28)

            Spacer()
            Text("v\(UpdateChecker.localVersionName) (\(UpdateChecker.localVersionCode))")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .padding(.bottom, 16)
        }
    }

    private func normalized() -> String? {
        let t = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else {
            status("请输入服务器地址", ok: false); return nil
        }
        guard t.hasPrefix("http://") || t.hasPrefix("https://") else {
            status("地址必须以 http:// 或 https:// 开头", ok: false); return nil
        }
        return t
    }

    private func onTest() {
        guard let local = normalized() else { return }
        let remote = remoteText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !remote.isEmpty && !remote.hasPrefix("http://") && !remote.hasPrefix("https://") {
            status("远程地址必须以 http:// 或 https:// 开头", ok: false); return
        }
        testing = true
        statusText = nil
        // 两个地址都测, 结果并排 (在展厅只有现场通、在外面只有远程通都是正常态)
        ServerResolver.ping(local) { lok, ltime in
            let localLine = lok ? "现场: 连接成功 ✓ \(ltime ?? "")" : "现场: 连不上"
            if remote.isEmpty {
                DispatchQueue.main.async {
                    testing = false
                    status(localLine, ok: lok)
                }
                return
            }
            ServerResolver.ping(remote) { rok, rtime in
                DispatchQueue.main.async {
                    testing = false
                    let remoteLine = rok ? "远程: 连接成功 ✓ \(rtime ?? "")" : "远程: 连不上"
                    status(localLine + "\n" + remoteLine, ok: lok || rok)
                }
            }
        }
    }

    private func doSave() {
        guard let t = normalized() else { return }
        let remote = remoteText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !remote.isEmpty && !remote.hasPrefix("http://") && !remote.hasPrefix("https://") {
            status("远程地址必须以 http:// 或 https:// 开头", ok: false); return
        }
        Prefs.serverUrl = t
        Prefs.remoteUrl = remote.isEmpty ? nil : remote
        onSave(t)
    }

    private func status(_ s: String, ok: Bool) {
        statusText = s
        statusOk = ok
    }
}
