package com.jinhu.smartcontrol

import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerUrlsTest {
    @Test
    fun `maps onsite frontend to backend port`() {
        assertEquals(
            "http://192.168.77.54:3200/api/client-auth/ping",
            ServerUrls.apiUrl(
                URL("http://192.168.77.54:5173/control/"),
                "/api/client-auth/ping",
            ).toString(),
        )
    }

    @Test
    fun `keeps public production api under control scope`() {
        assertEquals(
            "https://park.cnjinhu.com/control/api/client-auth/ping",
            ServerUrls.apiUrl(
                URL("https://park.cnjinhu.com/control/"),
                "/api/client-auth/ping",
            ).toString(),
        )
    }
}
