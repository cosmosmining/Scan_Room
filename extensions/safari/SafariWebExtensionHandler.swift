// Native bridge for the MOZU Room Scanner Safari Web Extension.
//
// Safari Web Extensions are a web extension (the assets in `Resources/`, shared
// 1:1 with the Chrome build) wrapped in a tiny native app + extension. This
// handler is the messaging bridge; the scan → floorplan logic is all in the web
// layer (scanner.js → @mozu/scan-sdk). Generated/owned by the Xcode project.

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        os_log(.default, "MOZU Room Scanner received message: %@", String(describing: message))

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message ?? ""]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
