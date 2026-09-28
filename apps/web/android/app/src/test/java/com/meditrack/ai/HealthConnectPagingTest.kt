package com.meditrack.ai

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthConnectPagingTest {
    @Test
    fun readsEveryPageUntilTheTokenIsExhausted() = runBlocking {
        val requestedTokens = mutableListOf<String?>()
        val pages = mapOf(
            null to HealthConnectPage(listOf(1, 2), "page-2"),
            "page-2" to HealthConnectPage(listOf(3), null),
        )

        val result = HealthConnectPaging.collect(
            maxItems = 10,
            maxPages = 5,
            fetchPage = { token ->
                requestedTokens += token
                requireNotNull(pages[token])
            },
            transform = { listOf(it) },
        )

        assertEquals(listOf(null, "page-2"), requestedTokens)
        assertEquals(listOf(1, 2, 3), result.items)
        assertEquals(3, result.sourceRecordCount)
        assertEquals(2, result.pageCount)
        assertFalse(result.truncated)
    }

    @Test
    fun reportsTruncationWhenAnExpandedRecordExceedsTheItemBudget() = runBlocking {
        val result = HealthConnectPaging.collect(
            maxItems = 3,
            maxPages = 5,
            fetchPage = {
                HealthConnectPage(
                    records = listOf(listOf(1, 2), listOf(3, 4)),
                    nextPageToken = null,
                )
            },
            transform = { it },
        )

        assertEquals(listOf(1, 2, 3), result.items)
        assertEquals(2, result.sourceRecordCount)
        assertTrue(result.truncated)
        assertEquals("ITEM_LIMIT_REACHED", result.stopReason)
    }

    @Test
    fun repeatedPageTokenStopsWithoutLoopingForever() = runBlocking {
        var calls = 0
        val result = HealthConnectPaging.collect(
            maxItems = 10,
            maxPages = 10,
            fetchPage = {
                calls += 1
                HealthConnectPage(listOf(calls), "same-token")
            },
            transform = { listOf(it) },
        )

        assertEquals(2, calls)
        assertTrue(result.truncated)
        assertEquals("REPEATED_PAGE_TOKEN", result.stopReason)
    }

    @Test
    fun pageLimitFailsClosedAndReportsPartialData() = runBlocking {
        val result = HealthConnectPaging.collect(
            maxItems = 100,
            maxPages = 2,
            fetchPage = { token ->
                HealthConnectPage(
                    records = listOf(if (token == null) 1 else 2),
                    nextPageToken = if (token == null) "page-2" else "page-3",
                )
            },
            transform = { listOf(it) },
        )

        assertEquals(listOf(1, 2), result.items)
        assertTrue(result.truncated)
        assertEquals("PAGE_LIMIT_REACHED", result.stopReason)
    }
}
