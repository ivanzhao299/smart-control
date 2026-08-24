import Foundation

enum APIError: LocalizedError {
    case invalidServer
    case invalidResponse
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidServer: return "服务器地址无效"
        case .invalidResponse: return "服务器返回了无法识别的数据"
        case let .server(code, message): return "\(message)（HTTP \(code)）"
        }
    }
}

struct APIEnvelope<T: Decodable>: Decodable {
    let message: String?
    let data: T
}

struct EmptyResult: Codable {}

final class NativeAPI {
    var baseURL: URL
    var token: String?

    init(baseURL: URL, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
    }

    static func apiURL(from appURL: String) -> URL? {
        guard var parts = URLComponents(string: appURL) else { return nil }
        if parts.port == 5173 { parts.port = 3200 }
        parts.path = "/api"
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        as type: T.Type = T.self
    ) async throws -> T {
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = baseURL.appendingPathComponent(clean)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue(token, forHTTPHeaderField: "X-Client-Token") }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = root?["message"] as? String ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError.server(http.statusCode, message)
        }
        do { return try JSONDecoder.smart.decode(APIEnvelope<T>.self, from: data).data }
        catch { throw APIError.invalidResponse }
    }
}

extension JSONDecoder {
    static var smart: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

struct LoginResult: Codable { let token: String; let expiresAt: String }

struct Page<T: Codable>: Codable {
    let list: [T]
    let total: Int?
}

struct NativeScene: Codable, Identifiable {
    let id: Int
    let code: String
    let name: String
    let description: String?
    let enabled: Bool
}

struct LightZoneNative: Codable, Identifiable {
    let id: Int
    let code: String
    let name: String
    let floor: String
    let enabled: Bool
}

struct HVACZoneNative: Codable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let floor: String
    let indoors: [Int]
}

struct PowerReadingNative: Codable {
    let on: Bool?
    let current: Double?
    let voltage: Double?
    let power: Double?
    let energy: Double?
}

struct PowerCircuitNative: Codable, Identifiable {
    let id: Int
    let code: String
    let name: String
    let floor: String
    let category: String?
    let enabled: Bool
    let reading: PowerReadingNative?
}

struct RuntimeDeviceNative: Codable, Identifiable {
    var id: String { device }
    let device: String
    let status: String
    let updatedAt: String?
}

struct PlaybackChannelNative: Codable, Identifiable {
    var id: Int { slot }
    let slot: Int
    let status: String?
    let currentMediaName: String?
    let paused: Bool?
}
