import SwiftUI

struct NativeRootView: View {
    @StateObject private var state = NativeAppState()

    var body: some View {
        Group {
            if state.connecting { ProgressView("正在选择最快的服务器…") }
            else if !state.authenticated { NativeLoginView(state: state) }
            else { NativeMainView(state: state) }
        }
        .preferredColorScheme(.dark)
        .task { await state.start() }
        .alert("操作提示", isPresented: Binding(get: { state.error != nil }, set: { if !$0 { state.error = nil } })) {
            Button("知道了") { state.error = nil }
        } message: { Text(state.error ?? "") }
    }
}

struct NativeLoginView: View {
    @ObservedObject var state: NativeAppState
    @State private var username = ""
    @State private var password = ""
    @State private var remember = true

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("用户名（可选）", text: $username).textInputAutocapitalization(.never)
                    SecureField("访问密码", text: $password)
                    Toggle("安全保存并自动登录", isOn: $remember)
                } header: { Text("金湖智控") }
                Section {
                    Button(state.busy ? "正在登录…" : "登录") {
                        Task {
                            do { try await state.login(username: username, password: password, remember: remember) }
                            catch { state.error = error.localizedDescription }
                        }
                    }.disabled(password.isEmpty || state.busy)
                }
                Section("当前路线") {
                    Label(state.activeServerName.isEmpty ? "未连接" : state.activeServerName, systemImage: "network")
                    Button("重新探测服务器") { Task { _ = await state.selectServer() } }
                }
            }
            .navigationTitle("原生控制系统")
        }
    }
}

struct NativeMainView: View {
    @ObservedObject var state: NativeAppState
    var body: some View {
        TabView {
            NavigationView { NativeDashboard(state: state) }
                .tabItem { Label("总览", systemImage: "square.grid.2x2.fill") }
            NavigationView { NativeLightingView(state: state) }
                .tabItem { Label("灯光", systemImage: "lightbulb.fill") }
            NavigationView { NativeHVACView(state: state) }
                .tabItem { Label("空调", systemImage: "snowflake") }
            NavigationView { NativePowerView(state: state) }
                .tabItem { Label("电源", systemImage: "bolt.fill") }
            NavigationView { NativeMoreView(state: state) }
                .tabItem { Label("更多", systemImage: "ellipsis.circle.fill") }
        }
        .overlay(alignment: .top) {
            if state.busy {
                ProgressView().padding(8).background(.ultraThinMaterial).clipShape(Capsule())
            } else if let notice = state.lastNotice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .font(.footnote).padding(10).background(.ultraThinMaterial).clipShape(Capsule())
            }
        }
        .task {
            while !Task.isCancelled && state.authenticated {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                if !Task.isCancelled { await state.refresh() }
            }
        }
    }
}

struct NativeDashboard: View {
    @ObservedObject var state: NativeAppState
    private let columns = [GridItem(.adaptive(minimum: 145), spacing: 12)]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Label(state.activeServerName, systemImage: "network")
                    Spacer()
                    Text("\(state.runtimeDevices.filter { ["online", "running"].contains($0.status) }.count)/\(state.runtimeDevices.count) 在线")
                }.font(.footnote).foregroundStyle(.secondary)
                if !state.runningScenes.isEmpty {
                    Text("正在执行").font(.headline)
                    ForEach(state.runningScenes) { execution in
                        HStack(spacing: 12) {
                            ProgressView()
                            VStack(alignment: .leading, spacing: 3) {
                                Text(execution.sceneName ?? execution.sceneCode).font(.subheadline.weight(.semibold))
                                Text(executionSummary(execution)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("停止", role: .destructive) {
                                Task { await state.command("scenes/\(execution.sceneCode)/stop") }
                            }.buttonStyle(.bordered)
                        }
                        .padding(12).background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                Text("情景模式").font(.headline)
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(state.scenes) { scene in
                        Button { Task { await state.command("scenes/\(scene.code)/execute") } } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Image(systemName: "sparkles").font(.title2)
                                Text(scene.name).font(.headline)
                                Text(scene.description ?? "一键执行").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }.frame(maxWidth: .infinity, minHeight: 92, alignment: .leading).padding()
                        }.buttonStyle(.borderedProminent).tint(.blue.opacity(0.7))
                    }
                }
            }.padding()
        }
        .navigationTitle("金湖智控")
        .toolbar { Button { Task { await state.refresh() } } label: { Image(systemName: "arrow.clockwise") } }
        .refreshable { await state.refresh() }
    }

    private func executionSummary(_ execution: SceneExecutionNative) -> String {
        let completed = execution.succeeded ?? 0
        let failed = execution.failed ?? 0
        let total = execution.totalActions ?? 0
        return total > 0 ? "已完成 \(completed + failed)/\(total) · 失败 \(failed)" : "设备指令执行中"
    }
}

struct NativeLightingView: View {
    @ObservedObject var state: NativeAppState
    @State private var brightness: [Int: Double] = [:]
    var body: some View {
        List(state.lights) { zone in
            VStack(alignment: .leading, spacing: 12) {
                HStack { Text(zone.name).font(.headline); Spacer(); Text(zone.floor).foregroundStyle(.secondary) }
                Slider(value: Binding(get: { brightness[zone.id] ?? 80 }, set: { brightness[zone.id] = $0 }), in: 0...100, step: 5)
                HStack {
                    Button("关闭") { Task { await state.command("lighting/zone/\(zone.id)/off") } }.buttonStyle(.bordered)
                    Button("开启") { Task { await state.command("lighting/zone/\(zone.id)/on") } }.buttonStyle(.borderedProminent)
                    Button("调至 \(Int(brightness[zone.id] ?? 80))%") {
                        Task { await state.command("lighting/zone/\(zone.id)/brightness", body: ["value": Int(brightness[zone.id] ?? 80)]) }
                    }.buttonStyle(.bordered)
                }.font(.caption)
            }.padding(.vertical, 6)
        }.navigationTitle("灯光分区").refreshable { await state.refresh() }
    }
}

struct NativeHVACView: View {
    @ObservedObject var state: NativeAppState
    @State private var temperature: [String: Double] = [:]
    var body: some View {
        List(state.hvacZones) { zone in
            VStack(alignment: .leading, spacing: 10) {
                HStack { Text(zone.name).font(.headline); Spacer(); Text("\(zone.indoors.count) 台 · \(zone.floor)").foregroundStyle(.secondary) }
                Stepper("设定温度 \(Int(temperature[zone.code] ?? 24))°C", value: Binding(get: { temperature[zone.code] ?? 24 }, set: { temperature[zone.code] = $0 }), in: 16...30)
                HStack {
                    Button("关闭") { Task { await state.command("hvac/zone/\(zone.code)/off") } }.buttonStyle(.bordered)
                    Button("开启") { Task { await state.command("hvac/zone/\(zone.code)/on") } }.buttonStyle(.borderedProminent)
                    Button("设温") { Task { await state.command("hvac/zone/\(zone.code)/temperature", body: ["value": Int(temperature[zone.code] ?? 24)]) } }.buttonStyle(.bordered)
                }
            }.padding(.vertical, 6)
        }.navigationTitle("中央空调").refreshable { await state.refresh() }
    }
}

struct NativePowerView: View {
    @ObservedObject var state: NativeAppState
    var body: some View {
        List {
            Section {
                HStack {
                    Button("时序关机", role: .destructive) { Task { await state.command("power-circuits/sequencer/all-off") } }.buttonStyle(.bordered)
                    Spacer()
                    Button("时序开机") { Task { await state.command("power-circuits/sequencer/all-on") } }.buttonStyle(.borderedProminent)
                }
            }
            ForEach(state.powerCircuits) { circuit in
                HStack {
                    VStack(alignment: .leading) {
                        Text(circuit.name).font(.headline)
                        Text("\(circuit.floor) · \(circuit.reading?.power.map { String(format: "%.0f W", $0) } ?? "暂无读数")").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(get: { circuit.reading?.on ?? false }, set: { on in Task { await state.command("power-circuits/\(circuit.id)/\(on ? "on" : "off")") } }))
                }.padding(.vertical, 5)
            }
        }.navigationTitle("电源系统").refreshable { await state.refresh() }
    }
}

struct NativeMoreView: View {
    @ObservedObject var state: NativeAppState
    @State private var showLegacy = false
    var body: some View {
        List {
            Section("播放系统") {
                NavigationLink("LED 大屏控制") { NativePlaybackView(state: state, slot: 1, title: "LED 大屏") }
                NavigationLink("投影控制") { NativePlaybackView(state: state, slot: 2, title: "投影") }
                NavigationLink("音响与背景音乐") { NativeAudioView(state: state) }
                ForEach(state.playback) { channel in
                    VStack(alignment: .leading) {
                        Text(channel.slot == 1 ? "LED 大屏" : channel.slot == 2 ? "投影" : "播放通道 \(channel.slot)")
                        Text(channel.currentMediaName ?? channel.status ?? "空闲").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("兼容工作台") {
                Button("媒体库与后台管理") { showLegacy = true }
                Text("媒体上传和工程配置继续使用原网页工作台；播放与音响日常控制已原生化。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("连接") {
                Label(state.activeServerName, systemImage: "network")
                Button("退出登录", role: .destructive) { state.logout() }
            }
        }
        .navigationTitle("更多")
        .sheet(isPresented: $showLegacy) { LegacyPortalView() }
    }
}

struct LegacyPortalView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            Group {
                if let url = URL(string: Prefs.serverUrl ?? Prefs.defaultServerUrl) {
                    WebView(initialUrl: url, reloadToken: 0, onUrlChange: { _ in }, onError: { _ in })
                } else { Text("服务器地址无效") }
            }
            .navigationTitle("兼容工作台")
            .toolbar { Button("完成") { dismiss() } }
        }
    }
}
