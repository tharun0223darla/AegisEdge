package com.meditrack.ai

import org.junit.Assert.assertEquals
import org.junit.Test

class WearableIntegrationClassifierTest {
    @Test
    fun healthConnectRecordsSelectHealthConnectRoute() {
        val result =
            WearableIntegrationClassifier.classifyHealthConnect(
                hasReadPermission = true,
                recordCount = 4,
            )

        assertEquals(
            WearableIntegrationState.HEALTH_CONNECT_AVAILABLE,
            result.state,
        )
        assertEquals("HEALTH_CONNECT", result.route)
    }

    @Test
    fun zeroHealthConnectRecordsAreNotReportedAsIntegrated() {
        val result =
            WearableIntegrationClassifier.classifyHealthConnect(
                hasReadPermission = true,
                recordCount = 0,
            )

        assertEquals(
            WearableIntegrationState.HEALTH_CONNECT_NO_RECORDS,
            result.state,
        )
        assertEquals(
            "HEALTH_CONNECT_RETURNED_ZERO_RECORDS",
            result.unsupportedReason,
        )
    }

    @Test
    fun readFailureWithoutRecordsRequiresManualEntry() {
        val result =
            WearableIntegrationClassifier.classifyHealthConnect(
                hasReadPermission = true,
                recordCount = 0,
                readErrorCount = 1,
            )

        assertEquals(
            WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
            result.state,
        )
        assertEquals("HEALTH_CONNECT_READ_FAILED", result.unsupportedReason)
    }

    @Test
    fun standardHeartRateServiceAndMeasurementAreSupportedAfterDiscovery() {
        val result =
            WearableIntegrationClassifier.classifyBle(
                BleProbeEvidence(
                    discoveredServiceUuids =
                        listOf("0000180D-0000-1000-8000-00805F9B34FB"),
                    discoveredCharacteristicUuids = listOf("0x2A37"),
                    connectionStatus = BleConnectionStatus.CONNECTED,
                ),
            )

        assertEquals(
            WearableIntegrationState.STANDARD_BLE_SUPPORTED,
            result.state,
        )
    }

    @Test
    fun serviceWithoutHeartRateMeasurementFailsClosed() {
        val result =
            WearableIntegrationClassifier.classifyBle(
                BleProbeEvidence(
                    discoveredServiceUuids = listOf("180d"),
                    connectionStatus = BleConnectionStatus.CONNECTED,
                ),
            )

        assertEquals(
            WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
            result.state,
        )
        assertEquals(
            "HEART_RATE_MEASUREMENT_NOT_DISCOVERED",
            result.unsupportedReason,
        )
    }

    @Test
    fun genericGattTimeoutRequiresManualEntry() {
        val result =
            WearableIntegrationClassifier.classifyBle(
                BleProbeEvidence(
                    connectionStatus = BleConnectionStatus.TIMEOUT,
                    gattErrorCode = 147,
                ),
            )

        assertEquals(
            WearableIntegrationState.MANUAL_ENTRY_REQUIRED,
            result.state,
        )
        assertEquals("GATT_CONNECTION_TIMEOUT", result.unsupportedReason)
    }

    @Test
    fun haloProprietaryServiceIsUnsupported() {
        val result =
            WearableIntegrationClassifier.classifyBle(
                BleProbeEvidence(
                    advertisedServiceUuids = listOf("0x3802"),
                    connectionStatus = BleConnectionStatus.DISCONNECTED,
                ),
            )

        assertEquals(
            WearableIntegrationState.PROPRIETARY_WATCH_UNSUPPORTED,
            result.state,
        )
        assertEquals(
            "PROPRIETARY_0X3802_WITHOUT_STANDARD_HEART_RATE_SERVICE",
            result.unsupportedReason,
        )
    }

    @Test
    fun haloGattTimeoutReportsExactUnsupportedReason() {
        val result =
            WearableIntegrationClassifier.classifyBle(
                BleProbeEvidence(
                    advertisedServiceUuids = listOf("3802"),
                    connectionStatus = BleConnectionStatus.TIMEOUT,
                    gattErrorCode = 147,
                ),
            )

        assertEquals(
            WearableIntegrationState.PROPRIETARY_WATCH_UNSUPPORTED,
            result.state,
        )
        assertEquals(
            "PROPRIETARY_0X3802_GATT_TIMEOUT",
            result.unsupportedReason,
        )
    }
}
