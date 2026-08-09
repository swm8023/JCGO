package com.jcgo.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BaseUrlPolicyTest {
    @Test
    fun normalizesBareHttpsHostWithTrailingSlash() {
        assertEquals("https://example.com/", normalizeHttpsBaseUrl("example.com"))
        assertEquals("https://example.com/jcgo/", normalizeHttpsBaseUrl("https://example.com/jcgo"))
    }

    @Test
    fun rejectsNonHttpsAndCredentialBearingAddresses() {
        assertNull(normalizeHttpsBaseUrl("http://example.com"))
        assertNull(normalizeHttpsBaseUrl("wss://example.com/ws"))
        assertNull(normalizeHttpsBaseUrl("https://user:pass@example.com"))
        assertNull(normalizeHttpsBaseUrl("https://example.com/?token=secret"))
    }

    @Test
    fun allowsOnlyTheConfiguredOriginPath() {
        val policy = BaseUrlPolicy("https://example.com/jcgo/")

        assertEquals(NavigationDecision.ALLOW, policy.decide("https://example.com/jcgo/", true))
        assertEquals(NavigationDecision.ALLOW, policy.decide("https://example.com/jcgo/game/1", false))
        assertEquals(NavigationDecision.EXTERNAL, policy.decide("https://other.example/game", true))
        assertEquals(NavigationDecision.BLOCK, policy.decide("https://other.example/game", false))
        assertEquals(NavigationDecision.BLOCK, policy.decide("http://example.com/jcgo/", true))
    }

    @Test
    fun rejectsPathLookalikesOutsideConfiguredPrefix() {
        val policy = BaseUrlPolicy("https://example.com/jcgo/")

        assertFalse(policy.contains("https://example.com/jcgo-evil/"))
        assertFalse(policy.contains("https://example.com/other/"))
        assertTrue(policy.contains("https://example.com/jcgo/analysis"))
    }

    @Test
    fun allowsOnlyBoundedHttpsProbeRedirects() {
        assertTrue(isAllowedProbeRedirect("https://example.com/", 1))
        assertTrue(isAllowedProbeRedirect("https://example.com/", 5))
        assertFalse(isAllowedProbeRedirect("http://example.com/", 1))
        assertFalse(isAllowedProbeRedirect("https://user:pass@example.com/", 1))
        assertFalse(isAllowedProbeRedirect("https://example.com/", 6))
    }
}
