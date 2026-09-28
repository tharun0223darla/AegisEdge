package com.meditrack.ai

internal data class HealthConnectPage<T>(
    val records: List<T>,
    val nextPageToken: String?,
)

internal data class HealthConnectPagedResult<T>(
    val items: List<T>,
    val sourceRecordCount: Int,
    val pageCount: Int,
    val truncated: Boolean,
    val stopReason: String?,
)

internal object HealthConnectPaging {
    suspend fun <T, R> collect(
        maxItems: Int,
        maxPages: Int,
        fetchPage: suspend (String?) -> HealthConnectPage<T>,
        transform: (T) -> List<R>,
    ): HealthConnectPagedResult<R> {
        require(maxItems > 0) { "maxItems must be positive." }
        require(maxPages > 0) { "maxPages must be positive." }

        val items = mutableListOf<R>()
        val seenTokens = mutableSetOf<String>()
        var pageToken: String? = null
        var sourceRecordCount = 0
        var pageCount = 0

        while (pageCount < maxPages) {
            val page = fetchPage(pageToken)
            pageCount += 1

            for ((index, record) in page.records.withIndex()) {
                sourceRecordCount += 1
                val transformed = transform(record)
                val remaining = maxItems - items.size
                if (transformed.size > remaining) {
                    items += transformed.take(remaining)
                    return result(
                        items,
                        sourceRecordCount,
                        pageCount,
                        truncated = true,
                        stopReason = "ITEM_LIMIT_REACHED",
                    )
                }
                items += transformed
                if (items.size == maxItems) {
                    val hasUnreadRecords = index < page.records.lastIndex
                    val hasNextPage = !page.nextPageToken.isNullOrBlank()
                    return result(
                        items,
                        sourceRecordCount,
                        pageCount,
                        truncated = hasUnreadRecords || hasNextPage,
                        stopReason =
                            if (hasUnreadRecords || hasNextPage) {
                                "ITEM_LIMIT_REACHED"
                            } else {
                                null
                            },
                    )
                }
            }

            val nextToken = page.nextPageToken?.takeIf { it.isNotBlank() }
                ?: return result(items, sourceRecordCount, pageCount)
            if (!seenTokens.add(nextToken)) {
                return result(
                    items,
                    sourceRecordCount,
                    pageCount,
                    truncated = true,
                    stopReason = "REPEATED_PAGE_TOKEN",
                )
            }
            pageToken = nextToken
        }

        return result(
            items,
            sourceRecordCount,
            pageCount,
            truncated = true,
            stopReason = "PAGE_LIMIT_REACHED",
        )
    }

    private fun <T> result(
        items: List<T>,
        sourceRecordCount: Int,
        pageCount: Int,
        truncated: Boolean = false,
        stopReason: String? = null,
    ) = HealthConnectPagedResult(
        items = items,
        sourceRecordCount = sourceRecordCount,
        pageCount = pageCount,
        truncated = truncated,
        stopReason = stopReason,
    )
}
