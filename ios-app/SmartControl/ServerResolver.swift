import Foundation
import Network

/// 双地址自动选择 (对齐安卓壳 resolveAndLoad, 2026-07-25):
/// 现场地址 (展厅 LAN) 优先 —— ping 通就用它; 不通再试远程 (隧道/公网);
/// 都不通返回现场地址 (让 WebView 错误覆盖层出来, 业主可重试/重配)。
enum ServerResolver {

    /// GET {base}/api/client-auth/ping, 3s 超时 → (通不通, 服务器时间 HH:mm:ss)
    static func ping(_ base0: String, completion: @escaping (Bool, String?) -> Void) {
        let base = base0.hasSuffix("/") ? String(base0.dropLast()) : base0
        guard let url = URL(string: "\(base)/api/client-auth/ping") else {
            completion(false, nil); return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                completion(false, nil); return
            }
            var time: String?
            if let data = data,
               let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let d = (root["data"] as? [String: Any]) ?? root
                if let iso = d["serverTime"] as? String, iso.count >= 19 {
                    let s = iso.index(iso.startIndex, offsetBy: 11)
                    let e = iso.index(iso.startIndex, offsetBy: 19)
                    time = String(iso[s..<e])
                }
            }
            completion(true, time)
        }.resume()
    }

    /// 现场优先选地址; 主线程回调选中的 URL 字符串
    static func resolve(local: String, remote: String?, completion: @escaping (String) -> Void) {
        ping(local) { ok, _ in
            if ok {
                DispatchQueue.main.async { completion(local) }
                return
            }
            guard let remote = remote, !remote.isEmpty else {
                DispatchQueue.main.async { completion(local) }
                return
            }
            ping(remote) { rok, _ in
                DispatchQueue.main.async { completion(rok ? remote : local) }
            }
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
