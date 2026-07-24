import SwiftUI

/// 服务器配置页 — 对齐安卓壳 panel_config:
/// 输 url → 测试 (GET /api/client-auth/ping, 显示服务器时间) → 保存进 WebView。
struct ConfigView: View {
    @State private var urlText: String
    @State private var testing = false
    @State private var statusText: String?
    @State private var statusOk = false
    let onSave: (String) -> Void

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
        _urlText = State(initialValue: Prefs.serverUrl ?? Prefs.defaultServerUrl)
    }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Text("金湖智控")
                .font(.system(size: 30, weight: .bold))
            Text("请输入服务器地址")
                .font(.system(size: 15))
                .foregroundColor(.secondary)

            TextField("http://192.168.x.x:5173/control/", text: $urlText)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(12)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
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
        guard let base0 = normalized() else { return }
        let base = base0.hasSuffix("/") ? String(base0.dropLast()) : base0
        guard let url = URL(string: "\(base)/api/client-auth/ping") else {
            status("地址无法解析", ok: false); return
        }
        testing = true
        statusText = nil
        var req = URLRequest(url: url)
        req.timeoutInterval = 4
        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                testing = false
                if let err = err {
                    status("连接失败: \(err.localizedDescription)", ok: false); return
                }
                guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                    let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                    status("连接失败: HTTP \(code)", ok: false); return
                }
                // 摘 serverTime 的 HH:mm:ss 给业主看 (对齐安卓壳)
                var timeStr = ""
                if let data = data,
                   let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let d = (root["data"] as? [String: Any]) ?? root
                    if let iso = d["serverTime"] as? String, iso.count >= 19 {
                        let start = iso.index(iso.startIndex, offsetBy: 11)
                        let end = iso.index(iso.startIndex, offsetBy: 19)
                        timeStr = String(iso[start..<end])
                    }
                }
                status("连接成功 ✓ 服务器时间 \(timeStr)", ok: true)
            }
        }.resume()
    }

    private func doSave() {
        guard let t = normalized() else { return }
        Prefs.serverUrl = t
        onSave(t)
    }

    private func status(_ s: String, ok: Bool) {
        statusText = s
        statusOk = ok
    }
}
