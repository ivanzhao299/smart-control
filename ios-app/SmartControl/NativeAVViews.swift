import SwiftUI

struct NativePlaybackView: View {
    @ObservedObject var state: NativeAppState
    let slot: Int
    let title: String
    @State private var confirmStop = false

    private var channel: PlaybackChannelNative? { state.playback.first { $0.slot == slot } }
    private var playlist: [PlaylistItemNative] { state.playlists[slot] ?? [] }

    var body: some View {
        List {
            Section("当前状态") {
                statusRow("连接", channel?.alive == false ? "播放器离线" : "在线")
                statusRow("正在播放", channel?.currentMediaName ?? "待机")
                if channel?.currentMediaKind == "doc" {
                    statusRow("文档页", "\(channel?.docPage ?? 1) / \(channel?.currentMediaPageCount.map { String($0) } ?? "—")")
                    HStack {
                        Button("上一页") { page(-1) }.buttonStyle(.bordered)
                        Button("下一页") { page(1) }.buttonStyle(.borderedProminent)
                        Spacer()
                        Button("缩小") { zoom(-15) }
                        Button("放大") { zoom(15) }
                    }
                }
                Picker("画面模式", selection: Binding(get: { channel?.displayFit ?? "fill" }, set: { fit in Task { await state.command("playback/channels/\(slot)/display-fit", body: ["fit": fit]) } })) {
                    Text("铺满").tag("fill")
                    Text("保持比例").tag("contain")
                    Text("裁切铺满").tag("cover")
                }
                HStack {
                    Button(channel?.paused == true ? "继续" : "暂停") {
                        Task { await state.command("playback/channels/\(slot)/\(channel?.paused == true ? "resume" : "pause")") }
                    }.buttonStyle(.bordered)
                    Button("上一项") { Task { await state.command("playback/channels/\(slot)/prev") } }.buttonStyle(.bordered)
                    Button("下一项") { Task { await state.command("playback/channels/\(slot)/next") } }.buttonStyle(.bordered)
                    Button("停止", role: .destructive) { confirmStop = true }.buttonStyle(.bordered)
                }.font(.caption)
            }
            Section("欢迎画面") {
                Button("播放可编辑欢迎页") { Task { await state.command("playback/channels/\(slot)/welcome", body: ["variant": "editable"]) } }
                Button("播放默认欢迎画面") { Task { await state.command("playback/channels/\(slot)/welcome", body: ["variant": "default"]) } }
            }
            Section("播放列表") {
                if playlist.isEmpty { Text("播放列表为空").foregroundStyle(.secondary) }
                ForEach(playlist) { item in
                    Button {
                        guard !item.missing else { state.error = "该媒体已经被删除"; return }
                        Task { await state.command("playback/channels/\(slot)/publish", body: ["mediaId": item.mediaId, "loopMode": "loop"]) }
                    } label: {
                        HStack {
                            Image(systemName: icon(item.kind))
                            VStack(alignment: .leading) {
                                Text(item.title)
                                if item.missing { Text("媒体已删除").font(.caption).foregroundStyle(.red) }
                            }
                            Spacer()
                            if channel?.currentMediaId == item.mediaId { Image(systemName: "waveform").foregroundStyle(.blue) }
                        }
                    }.disabled(item.missing)
                }
            }
        }
        .navigationTitle(title)
        .refreshable { await state.refresh() }
        .confirmationDialog("确定停止播放并回到待机画面？", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("停止播放", role: .destructive) { Task { await state.command("playback/channels/\(slot)/stop") } }
        }
    }

    private func page(_ delta: Int) {
        let target = max(1, min(channel?.currentMediaPageCount ?? Int.max, (channel?.docPage ?? 1) + delta))
        Task { await state.command("playback/channels/\(slot)/doc-page", body: ["page": target]) }
    }
    private func zoom(_ delta: Int) {
        let target = max(50, min(200, (channel?.docZoom ?? 100) + delta))
        Task { await state.command("playback/channels/\(slot)/doc-zoom", body: ["zoom": target]) }
    }
    private func icon(_ kind: String?) -> String {
        switch kind { case "video": return "film"; case "audio": return "music.note"; case "doc": return "doc.text"; case "image": return "photo"; default: return "play.rectangle" }
    }
    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).foregroundStyle(.secondary) }
    }
}

struct NativeAudioView: View {
    @ObservedObject var state: NativeAppState
    @State private var volumes: [Int: Double] = [:]
    @State private var muted: Set<Int> = []

    var body: some View {
        List {
            Section("一键场景") {
                ForEach(state.audioScenes) { scene in
                    Button {
                        Task { await state.command("audio/scene/apply/\(scene.presetNum)", body: [:]) }
                    } label: {
                        HStack {
                            Text(scene.name)
                            Spacer()
                            Text("U\(String(format: "%02d", scene.presetNum))").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("输出分区") {
                ForEach(state.audioZones) { zone in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(zone.name).font(.headline)
                            Spacer()
                            Button(muted.contains(zone.id) ? "取消静音" : "静音") { toggleMute(zone) }.buttonStyle(.bordered)
                        }
                        HStack {
                            Image(systemName: "speaker.wave.1")
                            Slider(value: Binding(get: { volumes[zone.id] ?? 50 }, set: { volumes[zone.id] = $0 }), in: 0...100, step: 1)
                            Text("\(Int(volumes[zone.id] ?? 50))%").monospacedDigit().frame(width: 44)
                            Button("应用") { applyVolume(zone) }.buttonStyle(.borderedProminent)
                        }
                    }.padding(.vertical, 5)
                }
            }
            Section("背景音乐") {
                NavigationLink("打开 BGM 播放列表") { NativePlaybackView(state: state, slot: 3, title: "背景音乐") }
            }
        }
        .navigationTitle("音响系统")
        .refreshable { await state.refresh() }
    }

    private func applyVolume(_ zone: AudioZoneNative) {
        Task { await state.command("audio/audio_out\(zone.channel + 1)/volume", body: ["value": Int(volumes[zone.id] ?? 50), "zone": "out\(zone.channel + 1)"]) }
    }
    private func toggleMute(_ zone: AudioZoneNative) {
        let next = !muted.contains(zone.id)
        if next { muted.insert(zone.id) } else { muted.remove(zone.id) }
        Task { await state.command("audio/audio_out\(zone.channel + 1)/mute", body: ["muted": next, "zone": "out\(zone.channel + 1)"]) }
    }
}
