import Foundation
import SwiftUI

@MainActor
final class NativeAppState: ObservableObject {
    @Published var authenticated = false
    @Published var connecting = true
    @Published var busy = false
    @Published var error: String?
    @Published var activeServerName = ""
    @Published var scenes: [NativeScene] = []
    @Published var lights: [LightZoneNative] = []
    @Published var hvacZones: [HVACZoneNative] = []
    @Published var powerCircuits: [PowerCircuitNative] = []
    @Published var runtimeDevices: [RuntimeDeviceNative] = []
    @Published var playback: [PlaybackChannelNative] = []

    private(set) var api: NativeAPI?
    private let tokenScope = "native-client-token"
    private let passwordScope = "native-client-password"

    func start() async {
        connecting = true
        defer { connecting = false }
        guard await selectServer() else {
            error = "现场服务器和远程服务器当前都无法连接"
            return
        }
        if let token = KeychainStore.password(scope: tokenScope) {
            api?.token = token
            do {
                _ = try await api?.request("system/info", as: SystemInfoNative.self)
                authenticated = true
                await refresh()
                return
            } catch { KeychainStore.clear(scope: tokenScope) }
        }
        if let password = KeychainStore.password(scope: passwordScope) {
            do { try await login(username: "", password: password, remember: true) }
            catch { self.error = nil }
        }
    }

    func selectServer() async -> Bool {
        let candidates = [Prefs.serverUrl ?? Prefs.defaultServerUrl, Prefs.remoteUrl ?? Prefs.defaultRemoteUrl]
        return await withTaskGroup(of: (Int, NativeAPI?).self) { group in
            for (index, address) in candidates.enumerated() {
                group.addTask {
                    guard let url = NativeAPI.apiURL(from: address) else { return (index, nil) }
                    let candidate = NativeAPI(baseURL: url)
                    do {
                        let _: PingNative = try await candidate.request("client-auth/ping")
                        return (index, candidate)
                    } catch { return (index, nil) }
                }
            }
            var found: [(Int, NativeAPI)] = []
            for await result in group { if let api = result.1 { found.append((result.0, api)) } }
            guard let selected = found.sorted(by: { $0.0 < $1.0 }).first else { return false }
            self.api = selected.1
            self.activeServerName = selected.0 == 0 ? "现场局域网" : "远程连接"
            return true
        }
    }

    func login(username: String, password: String, remember: Bool) async throws {
        guard let api else { throw APIError.invalidServer }
        busy = true
        defer { busy = false }
        let result: LoginResult = try await api.request(
            "client-auth/login", method: "POST",
            body: ["username": username, "password": password]
        )
        api.token = result.token
        KeychainStore.set(result.token, scope: tokenScope)
        if remember { KeychainStore.set(password, scope: passwordScope) }
        authenticated = true
        error = nil
        await refresh()
    }

    func logout() {
        KeychainStore.clear(scope: tokenScope)
        KeychainStore.clear(scope: passwordScope)
        api?.token = nil
        authenticated = false
    }

    func refresh() async {
        guard let api, authenticated else { return }
        do {
            async let scenes: Page<NativeScene> = api.request("scenes")
            async let lights: [LightZoneNative] = api.request("light-zones")
            async let hvac: [HVACZoneNative] = api.request("hvac/zones")
            async let power: [PowerCircuitNative] = api.request("power-circuits")
            async let runtime: [RuntimeDeviceNative] = api.request("system/runtime/devices")
            async let playback: [PlaybackChannelNative] = api.request("playback/channels")
            let values = try await (scenes, lights, hvac, power, runtime, playback)
            self.scenes = values.0.list.filter(\.enabled)
            self.lights = values.1.filter(\.enabled)
            self.hvacZones = values.2
            self.powerCircuits = values.3.filter(\.enabled)
            self.runtimeDevices = values.4
            self.playback = values.5
            error = nil
        } catch {
            self.error = error.localizedDescription
            if case APIError.server(401, _) = error { authenticated = false }
        }
    }

    func command(_ path: String, body: [String: Any]? = nil) async {
        guard let api else { return }
        busy = true
        defer { busy = false }
        do {
            let _: AnyResult = try await api.request(path, method: "POST", body: body)
            error = nil
            try? await Task.sleep(nanoseconds: 450_000_000)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}

struct PingNative: Codable { let ok: Bool; let serverTime: String? }
struct SystemInfoNative: Codable { let version: String? }

/// Command endpoints return different object shapes. This decoder deliberately
/// accepts any JSON object while the status refresh remains strongly typed.
struct AnyResult: Codable {
    init(from decoder: Decoder) throws { _ = try? decoder.singleValueContainer() }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encodeNil() }
}
