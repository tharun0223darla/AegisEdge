package com.meditrack.ai

enum class WearableIntegrationState {
    HEALTH_CONNECT_AVAILABLE,
    HEALTH_CONNECT_NO_RECORDS,
    STANDARD_BLE_SUPPORTED,
    PROPRIETARY_WATCH_UNSUPPORTED,
    MANUAL_ENTRY_REQUIRED,
}

enum class BleConnectionStatus {
    NOT_ATTEMPTED,
    CONNECTED,
    DISCONNECTED,
    TIMEOUT,
    FAILED,
}

data class BleProbeEvidence(
    val advertisedServiceUuids: List<String> = emptyList(),
    val discoveredServiceUuids: List<String> = emptyList(),
    val discoveredCharacteristicUuids: List<String> = emptyList(),
    val connectionStatus: BleConnectionStatus = BleConnectionStatus.NOT_ATTEMPTED,
    val gattErrorCode: Int? = null,
)

data class WearableClassification(
    val state: WearableIntegrationState,
    val route: String,
    val unsupportedReason: String? = null,
)

object WearableIntegrationClassifier {
    private const val HEART_RATE_SERVICE = "180d"
    private const val HEART_RATE_MEASUREMENT = "2a37"
    private const val HALO_PROPRIETARY_SERVICE = "3802"

    fun classifyHealthConnect(
        hasReadPermission: Boolean,
        recordCount: Int,
        readErrorCount: Int = 0,
    ): WearableClassification {
        if (!hasReadPermission) {
            return WearableClassification(
                WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
                route = "MANUAL",
                unsupportedReason = "HEALTH_CONNECT_PERMISSION_MISSING",
            )
        }
        if (recordCount == 0 && readErrorCount > 0) {
            return WearableClassification(
                WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
                route = "MANUAL",
                unsupportedReason = "HEALTH_CONNECT_READ_FAILED",
            )
        }
        return if (recordCount > 0) {
            WearableClassification(
                WearableIntegrationState.HEALTH_CONNECT_AVAILABLE,
                route = "HEALTH_CONNECT",
            )
        } else {
            WearableClassification(
                WearableIntegrationState.HEALTH_CONNECT_NO_RECORDS,
                route = "HEALTH_CONNECT",
                unsupportedReason = "HEALTH_CONNECT_RETURNED_ZERO_RECORDS",
            )
        }
    }

    fun classifyBle(evidence: BleProbeEvidence): WearableClassification {
        val advertised = evidence.advertisedServiceUuids.map(::normalizeUuid).toSet()
        val services = evidence.discoveredServiceUuids.map(::normalizeUuid).toSet()
        val characteristics =
            evidence.discoveredCharacteristicUuids.map(::normalizeUuid).toSet()

        val standardHeartRateAvailable =
            evidence.connectionStatus == BleConnectionStatus.CONNECTED &&
                HEART_RATE_SERVICE in services &&
                HEART_RATE_MEASUREMENT in characteristics
        if (standardHeartRateAvailable) {
            return WearableClassification(
                WearableIntegrationState.STANDARD_BLE_SUPPORTED,
                route = "STANDARD_BLE",
            )
        }

        val proprietaryHaloService =
            HALO_PROPRIETARY_SERVICE in advertised ||
                HALO_PROPRIETARY_SERVICE in services
        if (proprietaryHaloService) {
            return WearableClassification(
                WearableIntegrationState.PROPRIETARY_WATCH_UNSUPPORTED,
                route = "UNSUPPORTED",
                unsupportedReason =
                    if (evidence.connectionStatus == BleConnectionStatus.TIMEOUT ||
                        evidence.gattErrorCode == 147
                    ) {
                        "PROPRIETARY_0X3802_GATT_TIMEOUT"
                    } else {
                        "PROPRIETARY_0X3802_WITHOUT_STANDARD_HEART_RATE_SERVICE"
                    },
            )
        }

        return WearableClassification(
            WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
            route = "MANUAL",
            unsupportedReason =
                when {
                    evidence.connectionStatus == BleConnectionStatus.TIMEOUT ->
                        "GATT_CONNECTION_TIMEOUT"
                    HEART_RATE_SERVICE !in services ->
                        "STANDARD_HEART_RATE_SERVICE_NOT_DISCOVERED"
                    HEART_RATE_MEASUREMENT !in characteristics ->
                        "HEART_RATE_MEASUREMENT_NOT_DISCOVERED"
                    else -> "NO_SUPPORTED_WEARABLE_ROUTE"
                },
        )
    }

    private fun normalizeUuid(value: String): String {
        val compact = value
            .trim()
            .lowercase()
            .removePrefix("0x")
            .replace("-", "")
        return when {
            compact.length == 4 -> compact
            compact.length == 32 &&
                compact.endsWith("00001000800000805f9b34fb") ->
                compact.substring(4, 8)
            else -> compact
        }
    }
}
