package com.meditrack.ai

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VopaxaOcrInstrumentedTest {
    @Test
    fun sidewaysVopaxaStripSelectsReadableRotation() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val bitmap = context.assets.open("vopaxa-strip-regression.jpg").use {
            BitmapFactory.decodeStream(it)
        }
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

        try {
            val candidates = listOf(0, 90, 270, 180).map { rotation ->
                val rotated = rotate(bitmap, rotation)
                val result = Tasks.await(recognizer.process(InputImage.fromBitmap(rotated, 0)))
                val lines = result.textBlocks.flatMapIndexed { blockIndex, block ->
                    block.lines.mapIndexed { lineIndex, line ->
                        val box = line.boundingBox
                        OcrDetectedLine(
                            text = line.text,
                            confidence = line.confidence?.toDouble() ?: 0.0,
                            left = box?.left,
                            top = box?.top,
                            right = box?.right,
                            bottom = box?.bottom,
                            blockIndex = blockIndex,
                            lineIndex = lineIndex,
                        )
                    }
                }
                val candidate = OcrRecognitionCandidate(
                    source = OcrSource.ML_KIT,
                    recognizedText = OcrTextReconstructor.normalizeMultiline(result.text),
                    text = OcrTextReconstructor.reconstruct(lines, result.text),
                    lines = lines,
                    averageConfidence = lines
                        .map { it.confidence }
                        .filter { it > 0.0 }
                        .average()
                        .takeUnless(Double::isNaN) ?: 0.0,
                    blockCount = result.textBlocks.size,
                    elementCount = result.textBlocks.sumOf { block ->
                        block.lines.sumOf { it.elements.size }
                    },
                    rotationDegrees = rotation,
                )
                Log.i(
                    TAG,
                    "rotation=$rotation blocks=${candidate.blockCount} " +
                        "lines=${candidate.lineCount} elements=${candidate.elementCount} " +
                        "recognized=${candidate.recognizedText} " +
                        "reconstructed=${candidate.text}",
                )
                if (rotated !== bitmap) rotated.recycle()
                candidate
            }

            val best = OcrTextReconstructor.chooseBest(candidates)
            assertNotNull(best)
            Log.i(
                TAG,
                "selectedRotation=${best!!.rotationDegrees} " +
                    "qualityScore=${OcrTextReconstructor.qualityScore(best)} " +
                    "reconstructed=${best.text}",
            )
            val normalized = best.text.lowercase()
            assertTrue("brand missing from: ${best.text}", normalized.contains("vopaxa-200"))
            assertTrue("generic missing from: ${best.text}", normalized.contains("cefpodoxime"))
            assertTrue(
                "strength missing from: ${best.text}",
                Regex("""200\s*mg""").containsMatchIn(normalized),
            )
        } finally {
            recognizer.close()
            bitmap.recycle()
        }
    }

    private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    companion object {
        private const val TAG = "VopaxaOcrTest"
    }
}
