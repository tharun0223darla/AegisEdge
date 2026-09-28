package com.meditrack.ai

import android.content.Intent
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private data class MetricReadResult(
    val metricType: String,
    val permissionGranted: Boolean,
    val records: List<JSObject> = emptyList(),
    val sourceRecordCount: Int = 0,
    val pageCount: Int = 0,
    val originCount: Int = 0,
    val truncated: Boolean = false,
    val stopReason: String? = null,
    val errorCode: String? = null,
) {
    fun diagnosticsPayload() = JSObject().apply {
        put("metricType", metricType)
        put("permissionGranted", permissionGranted)
        put("sourceRecordCount", sourceRecordCount)
        put("outputRecordCount", records.size)
        put("pageCount", pageCount)
        put("originCount", originCount)
        put("truncated", truncated)
        put("stopReason", stopReason)
        put("errorCode", errorCode)
    }
}

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val providerPackage = "com.google.android.apps.healthdata"
    private val permissions = linkedMapOf(
        "heartRate" to HealthPermission.getReadPermission(HeartRateRecord::class),
        "oxygenSaturation" to HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        "bloodPressure" to HealthPermission.getReadPermission(BloodPressureRecord::class),
        "bloodGlucose" to HealthPermission.getReadPermission(BloodGlucoseRecord::class),
    )

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val status = sdkStatus()
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            call.resolve(statusPayload(status, emptySet()))
            return
        }

        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                call.resolve(statusPayload(status, granted))
            } catch (error: Exception) {
                call.reject("Unable to check Health Connect permissions.", error)
            }
        }
    }

    @PluginMethod
    fun requestReadPermissions(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect is unavailable or needs an update.")
            return
        }

        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(context, permissions.values.toSet())
        startActivityForResult(call, intent, "permissionResult")
    }

    @ActivityCallback
    private fun permissionResult(call: PluginCall, result: ActivityResult) {
        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                call.resolve(statusPayload(sdkStatus(), granted))
            } catch (error: Exception) {
                call.reject("Unable to verify Health Connect permissions.", error)
            }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Unable to open Health Connect settings.", error)
        }
    }

    @PluginMethod
    fun readRecords(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect is unavailable or needs an update.")
            return
        }

        val hours = (call.getInt("lookbackHours") ?: 24).coerceIn(1, 168)
        val end = Instant.now()
        val start = end.minusSeconds(hours.toLong() * 60L * 60L)
        val startedAt = System.currentTimeMillis()

        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                if (granted.isEmpty()) {
                    logReadDiagnostic(
                        success = false,
                        recordCount = 0,
                        deniedTypeCount = permissions.size,
                        durationMs = System.currentTimeMillis() - startedAt,
                        reason = "PERMISSION_MISSING",
                    )
                    call.reject("Health Connect permission has not been granted.")
                    return@launch
                }

                val deniedTypes = JSArray()
                val metricResults = listOf(
                    readMetric(
                        metricType = "HEART_RATE",
                        permissionGranted =
                            permissions.getValue("heartRate") in granted,
                        deniedTypes = deniedTypes,
                    ) { readHeartRate(start, end) },
                    readMetric(
                        metricType = "OXYGEN_SATURATION",
                        permissionGranted =
                            permissions.getValue("oxygenSaturation") in granted,
                        deniedTypes = deniedTypes,
                    ) { readOxygenSaturation(start, end) },
                    readMetric(
                        metricType = "BLOOD_PRESSURE",
                        permissionGranted =
                            permissions.getValue("bloodPressure") in granted,
                        deniedTypes = deniedTypes,
                    ) { readBloodPressure(start, end) },
                    readMetric(
                        metricType = "BLOOD_GLUCOSE",
                        permissionGranted =
                            permissions.getValue("bloodGlucose") in granted,
                        deniedTypes = deniedTypes,
                    ) { readBloodGlucose(start, end) },
                )
                val output = JSArray().apply {
                    metricResults.flatMap { it.records }.forEach(::put)
                }
                val failedMetricCount =
                    metricResults.count { it.errorCode != null }

                val classification =
                    WearableIntegrationClassifier.classifyHealthConnect(
                        hasReadPermission = granted.isNotEmpty(),
                        recordCount = output.length(),
                        readErrorCount = failedMetricCount,
                    )
                val durationMs = System.currentTimeMillis() - startedAt
                metricResults.forEach(::logMetricDiagnostic)
                logReadDiagnostic(
                    success = failedMetricCount == 0,
                    recordCount = output.length(),
                    deniedTypeCount = deniedTypes.length(),
                    durationMs = durationMs,
                    reason = classification.unsupportedReason,
                )
                call.resolve(JSObject().apply {
                    put("records", output)
                    put("deniedTypes", deniedTypes)
                    put("lookbackHours", hours)
                    put("truncated", metricResults.any { it.truncated })
                    put("integrationState", classification.state.name)
                    put(
                        "metricDiagnostics",
                        JSArray().apply {
                            metricResults
                                .map(MetricReadResult::diagnosticsPayload)
                                .forEach(::put)
                        },
                    )
                    put("diagnostics", JSObject().apply {
                        put("route", classification.route)
                        put("healthConnectRecordCount", output.length())
                        put("deniedTypeCount", deniedTypes.length())
                        put("failedMetricCount", failedMetricCount)
                        put(
                            "pageCount",
                            metricResults.sumOf { it.pageCount },
                        )
                        put("success", failedMetricCount == 0)
                        put("durationMs", durationMs)
                        put("unsupportedReason", classification.unsupportedReason)
                        put(
                            "metrics",
                            JSArray().apply {
                                metricResults
                                    .map(MetricReadResult::diagnosticsPayload)
                                    .forEach(::put)
                            },
                        )
                        put("build", buildIdentityPayload())
                    })
                })
            } catch (error: SecurityException) {
                logReadDiagnostic(
                    success = false,
                    recordCount = 0,
                    deniedTypeCount = 0,
                    durationMs = System.currentTimeMillis() - startedAt,
                    reason = "ACCESS_REVOKED",
                )
                call.reject("Health Connect access was revoked. Review access in Settings.", error)
            } catch (error: Exception) {
                logReadDiagnostic(
                    success = false,
                    recordCount = 0,
                    deniedTypeCount = 0,
                    durationMs = System.currentTimeMillis() - startedAt,
                    reason = error.javaClass.simpleName,
                )
                call.reject("Unable to read Health Connect data.", error)
            }
        }
    }

    private suspend fun readMetric(
        metricType: String,
        permissionGranted: Boolean,
        deniedTypes: JSArray,
        reader: suspend () -> MetricReadResult,
    ): MetricReadResult {
        if (!permissionGranted) {
            deniedTypes.put(metricType)
            return MetricReadResult(
                metricType = metricType,
                permissionGranted = false,
            )
        }
        return try {
            reader()
        } catch (error: SecurityException) {
            deniedTypes.put(metricType)
            MetricReadResult(
                metricType = metricType,
                permissionGranted = false,
                stopReason = "ACCESS_REVOKED",
                errorCode = error.javaClass.simpleName,
            )
        } catch (error: Exception) {
            MetricReadResult(
                metricType = metricType,
                permissionGranted = true,
                stopReason = "READ_FAILED",
                errorCode = error.javaClass.simpleName,
            )
        }
    }

    private suspend fun readHeartRate(
        start: Instant,
        end: Instant,
    ): MetricReadResult {
        val origins = mutableSetOf<String>()
        val result = HealthConnectPaging.collect(
            maxItems = MAX_ITEMS_PER_METRIC,
            maxPages = MAX_PAGES_PER_METRIC,
            fetchPage = { pageToken ->
                val response = client().readRecords(
                    ReadRecordsRequest(
                        recordType = HeartRateRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        ascendingOrder = false,
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                HealthConnectPage(response.records, response.pageToken)
            },
            transform = { record ->
                val originPackage = record.metadata.dataOrigin.packageName
                origins += originPackage
                record.samples
                    .mapIndexed { index, sample -> index to sample }
                    .asReversed()
                    .map { (index, sample) ->
                        baseRecord(
                            recordId =
                                "${record.metadata.id}:sample:" +
                                    "${sample.time.toEpochMilli()}:$index",
                            originPackage = originPackage,
                        ).apply {
                            put("metricType", "HEART_RATE")
                            put("recordedAt", sample.time.toString())
                            put(
                                "timezoneOffsetMinutes",
                                record.endZoneOffset?.totalSeconds?.div(60),
                            )
                            put("unit", "bpm")
                            put(
                                "value",
                                JSObject()
                                    .put("heartRate", sample.beatsPerMinute)
                                    .put("context", "UNKNOWN"),
                            )
                        }
                    }
            },
        )
        return result.toMetricReadResult("HEART_RATE", origins.size)
    }

    private suspend fun readOxygenSaturation(
        start: Instant,
        end: Instant,
    ): MetricReadResult {
        val origins = mutableSetOf<String>()
        val result = HealthConnectPaging.collect(
            maxItems = MAX_ITEMS_PER_METRIC,
            maxPages = MAX_PAGES_PER_METRIC,
            fetchPage = { pageToken ->
                val response = client().readRecords(
                    ReadRecordsRequest(
                        recordType = OxygenSaturationRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        ascendingOrder = false,
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                HealthConnectPage(response.records, response.pageToken)
            },
            transform = { record ->
                val originPackage = record.metadata.dataOrigin.packageName
                origins += originPackage
                listOf(
                    baseRecord(record.metadata.id, originPackage).apply {
                        put("metricType", "OXYGEN_SATURATION")
                        put("recordedAt", record.time.toString())
                        put(
                            "timezoneOffsetMinutes",
                            record.zoneOffset?.totalSeconds?.div(60),
                        )
                        put("unit", "%")
                        put(
                            "value",
                            JSObject().put(
                                "oxygenSaturation",
                                record.percentage.value,
                            ),
                        )
                    },
                )
            },
        )
        return result.toMetricReadResult("OXYGEN_SATURATION", origins.size)
    }

    private suspend fun readBloodPressure(
        start: Instant,
        end: Instant,
    ): MetricReadResult {
        val origins = mutableSetOf<String>()
        val result = HealthConnectPaging.collect(
            maxItems = MAX_ITEMS_PER_METRIC,
            maxPages = MAX_PAGES_PER_METRIC,
            fetchPage = { pageToken ->
                val response = client().readRecords(
                    ReadRecordsRequest(
                        recordType = BloodPressureRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        ascendingOrder = false,
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                HealthConnectPage(response.records, response.pageToken)
            },
            transform = { record ->
                val originPackage = record.metadata.dataOrigin.packageName
                origins += originPackage
                listOf(
                    baseRecord(record.metadata.id, originPackage).apply {
                        put("metricType", "BLOOD_PRESSURE")
                        put("recordedAt", record.time.toString())
                        put(
                            "timezoneOffsetMinutes",
                            record.zoneOffset?.totalSeconds?.div(60),
                        )
                        put("unit", "mmHg")
                        put("value", JSObject().apply {
                            put(
                                "systolic",
                                record.systolic.inMillimetersOfMercury,
                            )
                            put(
                                "diastolic",
                                record.diastolic.inMillimetersOfMercury,
                            )
                        })
                    },
                )
            },
        )
        return result.toMetricReadResult("BLOOD_PRESSURE", origins.size)
    }

    private suspend fun readBloodGlucose(
        start: Instant,
        end: Instant,
    ): MetricReadResult {
        val origins = mutableSetOf<String>()
        val result = HealthConnectPaging.collect(
            maxItems = MAX_ITEMS_PER_METRIC,
            maxPages = MAX_PAGES_PER_METRIC,
            fetchPage = { pageToken ->
                val response = client().readRecords(
                    ReadRecordsRequest(
                        recordType = BloodGlucoseRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        ascendingOrder = false,
                        pageSize = PAGE_SIZE,
                        pageToken = pageToken,
                    ),
                )
                HealthConnectPage(response.records, response.pageToken)
            },
            transform = { record ->
                val originPackage = record.metadata.dataOrigin.packageName
                origins += originPackage
                listOf(
                    baseRecord(record.metadata.id, originPackage).apply {
                        put("metricType", "BLOOD_GLUCOSE")
                        put("recordedAt", record.time.toString())
                        put(
                            "timezoneOffsetMinutes",
                            record.zoneOffset?.totalSeconds?.div(60),
                        )
                        put("unit", "mg/dL")
                        put(
                            "value",
                            JSObject()
                                .put(
                                    "glucose",
                                    record.level.inMilligramsPerDeciliter,
                                )
                                .put("mealStatus", "UNKNOWN"),
                        )
                    },
                )
            },
        )
        return result.toMetricReadResult("BLOOD_GLUCOSE", origins.size)
    }

    private fun baseRecord(recordId: String, originPackage: String) = JSObject().apply {
        put("clientRecordId", "hc:$recordId")
        put("originPackage", originPackage)
    }

    private fun statusPayload(status: Int, granted: Set<String>) = JSObject().apply {
        put("availability", when (status) {
            HealthConnectClient.SDK_AVAILABLE -> "AVAILABLE"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "UPDATE_REQUIRED"
            else -> "UNAVAILABLE"
        })
        put("permissions", JSObject().apply {
            permissions.forEach { (name, permission) -> put(name, permission in granted) }
        })
        put("allGranted", permissions.values.all { it in granted })
        put("build", buildIdentityPayload())
    }

    private fun sdkStatus() = HealthConnectClient.getSdkStatus(context, providerPackage)

    private fun client() = HealthConnectClient.getOrCreate(context, providerPackage)

    private fun buildIdentityPayload() = JSObject().apply {
        put("versionName", BuildConfig.VERSION_NAME)
        put("versionCode", BuildConfig.VERSION_CODE)
        put("commitSha", BuildConfig.GIT_COMMIT_SHA)
        put("dirty", BuildConfig.BUILD_DIRTY)
    }

    private fun logMetricDiagnostic(result: MetricReadResult) {
        Log.i(
            DIAGNOSTIC_TAG,
            "metric=${result.metricType} permission=${result.permissionGranted} " +
                "sourceRecords=${result.sourceRecordCount} " +
                "outputRecords=${result.records.size} pages=${result.pageCount} " +
                "origins=${result.originCount} truncated=${result.truncated} " +
                "stopReason=${result.stopReason ?: "NONE"} " +
                "error=${result.errorCode ?: "NONE"}",
        )
    }

    private fun logReadDiagnostic(
        success: Boolean,
        recordCount: Int,
        deniedTypeCount: Int,
        durationMs: Long,
        reason: String?,
    ) {
        Log.i(
            DIAGNOSTIC_TAG,
            "route=HEALTH_CONNECT success=$success recordCount=$recordCount " +
                "deniedTypeCount=$deniedTypeCount durationMs=$durationMs " +
                "reason=${reason ?: "NONE"}",
        )
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    companion object {
        private const val PAGE_SIZE = 250
        private const val MAX_ITEMS_PER_METRIC = 2_000
        private const val MAX_PAGES_PER_METRIC = 100
        private const val DIAGNOSTIC_TAG = "MediTrackWearable"
    }
}

private fun HealthConnectPagedResult<JSObject>.toMetricReadResult(
    metricType: String,
    originCount: Int,
) = MetricReadResult(
    metricType = metricType,
    permissionGranted = true,
    records = items,
    sourceRecordCount = sourceRecordCount,
    pageCount = pageCount,
    originCount = originCount,
    truncated = truncated,
    stopReason = stopReason,
)
