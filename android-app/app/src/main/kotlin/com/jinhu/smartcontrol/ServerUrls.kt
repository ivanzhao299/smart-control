package com.jinhu.smartcontrol

import java.net.URL

/** Keeps native-shell page URLs and API probes on the same production route. */
object ServerUrls {
    fun apiUrl(input: URL, endpoint: String): URL {
        val backendPort = if (input.port == 5173) 3200 else input.port
        val apiPath = if (endpoint.startsWith('/')) endpoint else "/$endpoint"
        val scopedPrefix = if (input.host.equals("park.cnjinhu.com", ignoreCase = true)) {
            "/control"
        } else {
            ""
        }
        return URL(input.protocol, input.host, backendPort, scopedPrefix + apiPath)
    }
}
