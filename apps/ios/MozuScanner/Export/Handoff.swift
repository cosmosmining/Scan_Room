// Build the MOZU `/scan` deep link from a scan — the same wire format as the
// SDK's `handoffUrl`: `poly` + `h` always, plus a base64url `scan` payload when
// there are openings/objects. Opening this URL drops the user into the MOZU
// configurator on their measured room.

import Foundation

enum Handoff {
    static func url(webBase: String, scan: RoomScan) -> URL? {
        var base = webBase.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        guard !base.isEmpty else { return nil }

        let poly = scan.polygon
            .map { "\(Int($0.x.rounded())),\(Int($0.z.rounded()))" }
            .joined(separator: ";")

        var components = URLComponents(string: base + "/scan")
        var items = [
            URLQueryItem(name: "poly", value: poly),
            URLQueryItem(name: "h", value: String(Int(scan.height.rounded()))),
            URLQueryItem(name: "src", value: scan.source.rawValue),
        ]
        let hasRichPayload = !scan.openings.isEmpty || !scan.objects.isEmpty || !scan.fixtures.isEmpty
        if hasRichPayload, let data = scan.jsonData() {
            let b64 = data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            items.append(URLQueryItem(name: "scan", value: b64))
        }
        components?.queryItems = items
        return components?.url
    }

    /// Pretty-printed JSON for the share sheet / debugging.
    static func prettyJSON(_ scan: RoomScan) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes, .sortedKeys]
        return (try? encoder.encode(scan)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

/// Send a scan to the MOZU web platform and get back a short code.
///
/// The deep link above is the right thing when the iPad and the browser are the
/// same device, or when a link can be pasted between them. It is the wrong thing
/// for the job people actually do: scan on an iPad, design on a laptop. There is
/// no link to paste across that gap, and a whole house is tens of kilobytes of
/// JSON — base64 inflates it by a third, and every browser, proxy and chat app
/// truncates long URLs at a different length. A link that works for a galley
/// kitchen and silently fails for a house is worse than one that never worked.
///
/// So the scan is POSTed once and comes back as six characters a person can
/// read out, type, or photograph.
enum ScanHandoff {

    struct Ticket: Equatable {
        /// Six characters from an unambiguous alphabet — no O/0, no I/1/L.
        let code: String
        /// The page to open on the laptop.
        let url: String
        /// When the code stops working.
        let expiresAt: String?
    }

    enum Failure: LocalizedError {
        case badBase(String)
        case network(String)
        case server(status: Int, message: String)
        case malformedResponse

        var errorDescription: String? {
            switch self {
            case .badBase(let base):
                return "“\(base)” is not a web address MOZU can reach."
            case .network(let why):
                return "Could not reach MOZU: \(why)"
            case .server(let status, let message):
                return message.isEmpty ? "MOZU refused the scan (HTTP \(status))." : message
            case .malformedResponse:
                return "MOZU replied with something this app cannot read."
            }
        }
    }

    /// Upload the scan. Returns the ticket to show the user.
    static func send(_ scan: RoomScan, webBase: String) async throws -> Ticket {
        var base = webBase.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        guard let endpoint = URL(string: base + "/api/scan-handoff"), endpoint.host != nil else {
            throw Failure.badBase(webBase)
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = scan.jsonData()
        // A survey happens in a kitchen, which is where the signal is worst;
        // failing fast with a clear message beats a spinner that never resolves.
        request.timeoutInterval = 20

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure.network(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            // The server explains itself in JSON; pass that through rather than
            // inventing a friendlier lie about what went wrong.
            let message = (try? JSONSerialization.jsonObject(with: data))
                .flatMap { ($0 as? [String: Any])?["error"] as? String } ?? ""
            throw Failure.server(status: status, message: message)
        }

        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = object["code"] as? String,
              let url = object["url"] as? String else {
            throw Failure.malformedResponse
        }
        return Ticket(code: code, url: url, expiresAt: object["expiresAt"] as? String)
    }
}
