//
//  SafariWebExtensionHandler.swift
//  QuickEdit for Squarespace Extension
//
//  Created by Jimmy Obomsawin on 6/5/26.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        // QuickEdit does not use native messaging (browser.runtime.sendNativeMessage),
        // so there is nothing to handle. Complete with an empty response rather than
        // parsing or logging message contents (the stock template echoed and logged
        // every message). This keeps the required handler well-formed and silent.
        context.completeRequest(returningItems: [], completionHandler: nil)
    }

}
