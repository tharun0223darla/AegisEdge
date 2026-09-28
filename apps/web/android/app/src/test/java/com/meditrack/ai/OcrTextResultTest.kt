package com.meditrack.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrTextResultTest {
    @Test
    fun reconstructsMultipleBlocksWithReadableLineBreaks() {
        val lines = listOf(
            line("Folic   Acid Tablets", left = 10, top = 60, block = 1, line = 1),
            line("ArteferXT", left = 10, top = 90, block = 2, line = 0),
            line("Ferrous Ascorbate &", left = 10, top = 20, block = 1, line = 0),
        )

        assertEquals(
            "Ferrous Ascorbate &\nFolic Acid Tablets\nArteferXT",
            OcrTextReconstructor.reconstruct(lines),
        )
    }

    @Test
    fun selectsReadableRotatedCandidateWhenPrimaryOrientationIsEmpty() {
        val empty = candidate("", 0)
        val rotated = candidate("DOLO 650\nParacetamol Tablets IP", 90)

        assertTrue(OcrTextReconstructor.shouldRetryRotation(empty))
        assertEquals(90, OcrTextReconstructor.chooseBest(listOf(empty, rotated))?.rotationDegrees)
    }

    @Test
    fun rejectsLongFragmentedPrimaryTextAndSelectsReadableRotation() {
        val fragmented = candidate("EE 2 HEHE EE a Ec a", 0, confidence = 0.72)
        val rotated = candidate(
            "Vopaxa-200\nCefpodoxime Dispersible Tablets 200 mg",
            90,
            confidence = 0.86,
        )

        assertTrue(OcrTextReconstructor.shouldRetryRotation(fragmented))
        assertEquals(90, OcrTextReconstructor.chooseBest(listOf(fragmented, rotated))?.rotationDegrees)
    }

    @Test
    fun returnsNoCandidateWhenEveryOrientationHasNoText() {
        assertNull(
            OcrTextReconstructor.chooseBest(
                listOf(candidate("", 0), candidate("   ", 90)),
            ),
        )
    }

    private fun line(
        text: String,
        left: Int,
        top: Int,
        block: Int,
        line: Int,
    ) = OcrDetectedLine(text, 0.9, left, top, left + 100, top + 20, block, line)

    private fun candidate(
        text: String,
        rotation: Int,
        confidence: Double = 0.8,
    ) = OcrRecognitionCandidate(
        source = if (text.isBlank()) OcrSource.NONE else OcrSource.ML_KIT,
        recognizedText = text,
        text = text,
        lines = if (text.isBlank()) emptyList() else listOf(line(text, 0, 0, 0, 0)),
        averageConfidence = if (text.isBlank()) 0.0 else confidence,
        blockCount = if (text.isBlank()) 0 else 1,
        elementCount = if (text.isBlank()) 0 else 2,
        rotationDegrees = rotation,
    )
}
