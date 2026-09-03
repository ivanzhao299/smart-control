import Foundation
import Network

/// 双地址自动选择 (对齐安卓壳 resolveAndLoad, 2026-07-25):
/// 现场地址 (展厅 LAN) 优先 —— ping 通就用它; 不通再试远程 (隧道/公网);
/// 都不通返回现场地址 (让 WebView 错误覆盖层出来, 业主可重试/重配)。
enum ServerResolver {

    /// 真正探测 backend，而不是只看前端页面是否返回 200。
    /// 5173 是 GK9000 前端，认证后端固定在同主机 3200；反代入口则保持原端口。
    static func ping(_ base0: String, completion: @escaping (Bool, String?) -> Void) {
        guard let url = healthURL(from: base0) else {
            completion(false, nil); return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            guard let http = resp as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let data = data,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(false, nil); return
            }
            let payload = (root["data"] as? [String: Any]) ?? root
            guard payload["ok"] as? Bool == true else { completion(false, nil); return }
            var time: String?
            if let iso = payload["serverTime"] as? String, iso.count >= 19 {
                let s = iso.index(iso.startIndex, offsetBy: 11)
                let e = iso.index(iso.startIndex, offsetBy: 19)
                time = String(iso[s..<e])
            }
            completion(true, time)
        }.resume()
    }

    static func healthURL(from serverAddress: String) -> URL? {
        guard var components = URLComponents(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme == "http" || components.scheme == "https",
              components.host != nil else { return nil }
        if components.port == 5173 { components.port = 3200 }
        components.path = "/api/client-auth/ping"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    /// 现场优先选地址; 主线程回调 (选中URL, 是否可达)。
    /// 2026-07-29 业主"连不上黑屏太久": 两个地址**并行**探测 (原先串行 3s+3s),
    /// 最坏 ~3s 出结果; reachable=false 让调用方**立即**弹提示, 不再把死地址塞给
    /// WebView 等它慢慢超时。
    static func resolve(local: String, remote: String?, completion: @escaping (String, Bool) -> Void) {
        let group = DispatchGroup()
        var localOk = false
        var remoteOk = false
        group.enter()
        ping(local) { ok, _ in localOk = ok; group.leave() }
        if let remote = remote, !remote.isEmpty {
            group.enter()
            ping(remote) { ok, _ in remoteOk = ok; group.leave() }
        }
        group.notify(queue: .main) {
            if localOk { completion(local, true) }
            else if remoteOk, let remote = remote { completion(remote, true) }
            else { completion(local, false) }
        }
    }
}

/// 系统网络路径监听 — 进出展厅 Wi-Fi / 隧道连断时触发重探 (2s 防抖)。
final class NetWatcher: ObservableObject {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "net-watcher")
    private var pending: DispatchWorkItem?
    var onChange: (() -> Void)?

    func start() {
        monitor.pathUpdateHandler = { [weak self] _ in
            guard let self = self else { return }
            self.pending?.cancel()
            let work = DispatchWorkItem { [weak self] in
                DispatchQueue.main.async { self?.onChange?() }
            }
            self.pending = work
            self.queue.asyncAfter(deadline: .now() + 2, execute: work)
        }
        monitor.start(queue: queue)
    }

    func stop() {
        monitor.cancel()
        pending?.cancel()
    }
}
