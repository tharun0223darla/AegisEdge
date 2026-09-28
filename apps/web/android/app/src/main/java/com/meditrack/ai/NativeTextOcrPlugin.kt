package com.meditrack.ai

import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executors

@CapacitorPlugin(name = "NativeTextOcr")
class NativeTextOcrPlugin : Plugin() {
    private val decodeExecutor = Executors.newSingleThreadExecutor()
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    @PluginMethod
    fun recognizeImage(call: PluginCall) {
        val startedAt = System.currentTimeMillis()
        val encoded = call.getString("imageBase64")?.substringAfter("base64,")?.trim()
        if (encoded.isNullOrEmpty()) {
            resolveFailure(call, "IMAGE_REQUIRED", startedAt)
            return
        }
        if (encoded.length > MAX_BASE64_CHARACTERS) {
            resolveFailure(call, "IMAGE_TOO_LARGE", startedAt)
            return
        }

        decodeExecutor.execute {
            try {
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                if (bytes.size > MAX_DECODED_BYTES) {
                    resolveFailure(call, "IMAGE_TOO_LARGE", startedAt)
                    return@execute
                }

                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                    resolveFailure(call, "IMAGE_DECODE_FAILED", startedAt)
                    return@execute
                }

                val options = BitmapFactory.Options().apply {
                    inSampleSize = calculateSampleSize(bounds.outWidth, bounds.outHeight)
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                if (bitmap == null) {
                    resolveFailure(call, "IMAGE_DECODE_FAILED", startedAt)
                    return@execute
                }

                recognizeBitmap(call, bitmap, startedAt)
            } catch (error: IllegalArgumentException) {
                resolveFailure(call, "IMAGE_CONVERSION_FAILED", startedAt)
            } catch (error: Exception) {
                resolveFailure(call, "IMAGE_CONVERSION_FAILED", startedAt)
            }
        }
    }

    private fun recognizeBitmap(call: PluginCall, bitmap: Bitmap, startedAt: Long) {
        recognizeRotation(call, bitmap, startedAt, 0, emptyList(), false)
    }

    private fun recognizeRotation(
        call: PluginCall,
        originalBitmap: Bitmap,
        startedAt: Long,
        index: Int,
        candidates: List<OcrRecognitionCandidate>,
        sawException: Boolean,
    ) {
        val rotation = ROTATION_CANDIDATES[index]
        val attemptBitmap = rotateBitmap(originalBitmap, rotation)
        recognizer.process(InputImage.fromBitmap(attemptBitmap, 0))
            .addOnSuccessListener { result ->
                val candidate = buildCandidate(result, rotation)
                val nextCandidates = candidates + candidate
                logCandidateDiagnostics(candidate)
                recycleAttemptBitmap(originalBitmap, attemptBitmap)

                if (index + 1 < ROTATION_CANDIDATES.size) {
                    recognizeRotation(
                        call,
                        originalBitmap,
                        startedAt,
                        index + 1,
                        nextCandidates,
                        sawException,
                    )
                } else {
                    resolveBestCandidate(call, originalBitmap, startedAt, nextCandidates, sawException)
                }
            }
            .addOnFailureListener {
                recycleAttemptBitmap(originalBitmap, attemptBitmap)
                if (index + 1 < ROTATION_CANDIDATES.size) {
                    recognizeRotation(
                        call,
                        originalBitmap,
                        startedAt,
                        index + 1,
                        candidates,
                        true,
                    )
                } else {
                    resolveBestCandidate(call, originalBitmap, startedAt, candidates, true)
                }
            }
    }

    private fun buildCandidate(
        result: com.google.mlkit.vision.text.Text,
        rotationDegrees: Int,
    ): OcrRecognitionCandidate {
        val detectedLines = mutableListOf<OcrDetectedLine>()
        var confidenceTotal = 0.0
        var confidenceCount = 0
        var elementCount = 0

        result.textBlocks.forEachIndexed { blockIndex, block ->
            block.lines.forEachIndexed { lineIndex, line ->
                val confidence = line.confidence?.toDouble() ?: 0.0
                if (confidence > 0) {
                    confidenceTotal += confidence
                    confidenceCount += 1
                }
                elementCount += line.elements.size
                val box = line.boundingBox
                detectedLines += OcrDetectedLine(
                    text = line.text,
                    confidence = confidence,
                    left = box?.left,
                    top = box?.top,
                    right = box?.right,
                    bottom = box?.bottom,
                    blockIndex = blockIndex,
                    lineIndex = lineIndex,
                )
            }
        }

        return OcrRecognitionCandidate(
            source = OcrSource.ML_KIT,
            recognizedText = OcrTextReconstructor.normalizeMultiline(result.text),
            text = OcrTextReconstructor.reconstruct(detectedLines, result.text),
            lines = detectedLines,
            averageConfidence = if (confidenceCount > 0) confidenceTotal / confidenceCount else 0.0,
            blockCount = result.textBlocks.size,
            elementCount = elementCount,
            rotationDegrees = rotationDegrees,
        )
    }

    private fun resolveBestCandidate(
        call: PluginCall,
        bitmap: Bitmap,
        startedAt: Long,
        candidates: List<OcrRecognitionCandidate>,
        sawException: Boolean,
    ) {
        val best = OcrTextReconstructor.chooseBest(candidates)
        if (best == null) {
            bitmap.recycle()
            resolveFailure(
                call,
                when {
                    sawException && candidates.isEmpty() -> "ML_KIT_EXCEPTION"
                    candidates.any { it.text.isNotBlank() } -> "ML_KIT_LOW_QUALITY"
                    else -> "ML_KIT_EMPTY_TEXT"
                },
                startedAt,
            )
        } else {
            resolveSuccess(call, best, bitmap, startedAt)
        }
    }

    private fun resolveSuccess(
        call: PluginCall,
        candidate: OcrRecognitionCandidate,
        bitmap: Bitmap,
        startedAt: Long,
    ) {
        val processingMs = System.currentTimeMillis() - startedAt
        val lines = JSArray()
        candidate.lines.forEach { line ->
            lines.put(JSObject().apply {
                put("text", OcrTextReconstructor.normalizeLine(line.text))
                put("confidence", line.confidence)
                if (line.left != null && line.top != null && line.right != null && line.bottom != null) {
                    put("bbox", JSObject().apply {
                        put("left", line.left)
                        put("top", line.top)
                        put("right", line.right)
                        put("bottom", line.bottom)
                    })
                }
            })
        }

        logDiagnostics(
            source = OcrSource.ML_KIT,
            success = true,
            textLength = candidate.text.length,
            blockCount = candidate.blockCount,
            lineCount = candidate.lineCount,
            elementCount = candidate.elementCount,
            fallbackReason = null,
            processingMs = processingMs,
            rotationDegrees = candidate.rotationDegrees,
        )
        Log.i(
            TAG,
            "selectedRotationDegrees=${candidate.rotationDegrees}" +
                " qualityScore=${"%.2f".format(OcrTextReconstructor.qualityScore(candidate))}",
        )
        call.resolve(JSObject().apply {
            put("source", OcrSource.ML_KIT.name)
            put("success", true)
            put("text", candidate.text)
            put("lines", lines)
            put("confidence", candidate.averageConfidence)
            put("engine", "mlkit-android-latin-v2")
            put("fallbackReason", null)
            put("processingMs", processingMs)
            put("blockCount", candidate.blockCount)
            put("lineCount", candidate.lineCount)
            put("elementCount", candidate.elementCount)
            put("rotationDegrees", candidate.rotationDegrees)
            put("imageWidth", bitmap.width)
            put("imageHeight", bitmap.height)
        })
        bitmap.recycle()
    }

    private fun resolveFailure(call: PluginCall, fallbackReason: String, startedAt: Long) {
        val processingMs = System.currentTimeMillis() - startedAt
        logDiagnostics(
            source = OcrSource.NONE,
            success = false,
            textLength = 0,
            blockCount = 0,
            lineCount = 0,
            elementCount = 0,
            fallbackReason = fallbackReason,
            processingMs = processingMs,
            rotationDegrees = 0,
        )
        call.resolve(JSObject().apply {
            put("source", OcrSource.NONE.name)
            put("success", false)
            put("text", "")
            put("lines", JSArray())
            put("confidence", 0.0)
            put("engine", "mlkit-android-latin-v2")
            put("fallbackReason", fallbackReason)
            put("processingMs", processingMs)
            put("blockCount", 0)
            put("lineCount", 0)
            put("elementCount", 0)
            put("rotationDegrees", 0)
            put("imageWidth", 0)
            put("imageHeight", 0)
        })
    }

    private fun rotateBitmap(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun recycleAttemptBitmap(originalBitmap: Bitmap, attemptBitmap: Bitmap) {
        if (attemptBitmap !== originalBitmap && !attemptBitmap.isRecycled) attemptBitmap.recycle()
    }

    private fun logDiagnostics(
        source: OcrSource,
        success: Boolean,
        textLength: Int,
        blockCount: Int,
        lineCount: Int,
        elementCount: Int,
        fallbackReason: String?,
        processingMs: Long,
        rotationDegrees: Int,
    ) {
        Log.i(
            TAG,
            "source=" + source.name +
                " success=" + success +
                " textLength=" + textLength +
                " blockCount=" + blockCount +
                " lineCount=" + lineCount +
                " elementCount=" + elementCount +
                " fallbackReason=" + (fallbackReason ?: "NONE") +
                " processingMs=" + processingMs +
                " rotationDegrees=" + rotationDegrees,
        )
    }

    private fun calculateSampleSize(width: Int, height: Int): Int {
        var sampleSize = 1
        while (width / sampleSize > MAX_IMAGE_DIMENSION ||
            height / sampleSize > MAX_IMAGE_DIMENSION
        ) {
            sampleSize *= 2
        }
        return sampleSize
    }

    private fun logCandidateDiagnostics(candidate: OcrRecognitionCandidate) {
        Log.i(
            TAG,
            "attemptRotationDegrees=${candidate.rotationDegrees}" +
                " readable=${OcrTextReconstructor.isReadable(candidate)}" +
                " qualityScore=${"%.2f".format(OcrTextReconstructor.qualityScore(candidate))}" +
                " recognizedTextLength=${candidate.recognizedText.length}" +
                " reconstructedTextLength=${candidate.text.length}" +
                " blockCount=${candidate.blockCount}" +
                " lineCount=${candidate.lineCount}" +
                " elementCount=${candidate.elementCount}" +
                " averageConfidence=${"%.3f".format(candidate.averageConfidence)}",
        )
        val isDebuggable =
            (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (isDebuggable) {
            Log.d(
                TAG,
                "recognizedText[${candidate.rotationDegrees}]=${candidate.recognizedText.take(MAX_DEBUG_TEXT_CHARACTERS)}",
            )
            Log.d(
                TAG,
                "reconstructedText[${candidate.rotationDegrees}]=${candidate.text.take(MAX_DEBUG_TEXT_CHARACTERS)}",
            )
        }
    }

    override fun handleOnDestroy() {
        decodeExecutor.shutdownNow()
        recognizer.close()
        super.handleOnDestroy()
    }

    companion object {
        private const val TAG = "MediTrackOcr"
        private const val MAX_DECODED_BYTES = 6 * 1024 * 1024
        private const val MAX_BASE64_CHARACTERS = 8 * 1024 * 1024
        private const val MAX_IMAGE_DIMENSION = 2048
        private const val MAX_DEBUG_TEXT_CHARACTERS = 4_000
        private val ROTATION_CANDIDATES = listOf(0, 90, 270, 180)
    }
}
