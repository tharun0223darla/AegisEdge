package com.meditrack.ai

enum class OcrSource {
    ML_KIT,
    SERVER,
    NONE,
}

data class OcrDetectedLine(
    val text: String,
    val confidence: Double,
    val left: Int?,
    val top: Int?,
    val right: Int?,
    val bottom: Int?,
    val blockIndex: Int,
    val lineIndex: Int,
)

data class OcrRecognitionCandidate(
    val source: OcrSource,
    val recognizedText: String,
    val text: String,
    val lines: List<OcrDetectedLine>,
    val averageConfidence: Double,
    val blockCount: Int,
    val elementCount: Int,
    val rotationDegrees: Int,
) {
    val lineCount: Int get() = lines.size
}

object OcrTextReconstructor {
    private val medicineCue = Regex(
        "\\b(?:mg|mcg|g|gm|ml|iu|tablets?|capsules?|dispersible|injection|syrup|suspension)\\b",
        RegexOption.IGNORE_CASE,
    )
    private val strengthCue = Regex(
        "\\b\\d+(?:\\.\\d+)?\\s*(?:mg|mcg|g|gm|ml|iu|%)\\b",
        RegexOption.IGNORE_CASE,
    )

    fun normalizeLine(value: String): String =
        value.trim().replace(Regex(" +"), " ")

    fun reconstruct(lines: List<OcrDetectedLine>, fallbackText: String = ""): String {
        if (lines.isEmpty()) return normalizeMultiline(fallbackText)

        return lines
            .groupBy { it.blockIndex }
            .values
            .sortedWith(
                compareBy<List<OcrDetectedLine>>(
                    { block -> block.mapNotNull { it.top }.minOrNull() ?: Int.MAX_VALUE },
                    { block -> block.mapNotNull { it.left }.minOrNull() ?: Int.MAX_VALUE },
                    { block -> block.firstOrNull()?.blockIndex ?: Int.MAX_VALUE },
                ),
            )
            .flatMap { block ->
                block.sortedWith(
                    compareBy<OcrDetectedLine>(
                        { it.top ?: Int.MAX_VALUE },
                        { it.left ?: Int.MAX_VALUE },
                        { it.lineIndex },
                    ),
                )
            }
            .map { normalizeLine(it.text) }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
    }

    fun normalizeMultiline(value: String): String =
        value
            .lineSequence()
            .map(::normalizeLine)
            .filter { it.isNotEmpty() }
            .joinToString("\n")

    fun isReadable(candidate: OcrRecognitionCandidate): Boolean {
        val tokens = candidate.text.split(Regex("\\s+")).filter { it.isNotBlank() }
        val alphaTokens = tokens.filter { token -> token.count(Char::isLetter) >= 1 }
        if (candidate.lineCount == 0 || alphaTokens.size < 2) return false

        val readableTokens = alphaTokens.count(::isReadableToken)
        val tinyTokens = alphaTokens.count { token -> token.filter(Char::isLetter).length <= 2 }
        val readableRatio = readableTokens.toDouble() / alphaTokens.size
        val tinyRatio = tinyTokens.toDouble() / alphaTokens.size
        val hasMedicineCue = medicineCue.containsMatchIn(candidate.text)
        val confidenceKnown = candidate.averageConfidence > 0.0

        return (hasMedicineCue || readableRatio >= 0.35) &&
            tinyRatio < 0.65 &&
            (!confidenceKnown || candidate.averageConfidence >= 0.35)
    }

    fun shouldRetryRotation(candidate: OcrRecognitionCandidate): Boolean =
        !isReadable(candidate)

    fun chooseBest(candidates: List<OcrRecognitionCandidate>): OcrRecognitionCandidate? =
        candidates
            .filter(::isReadable)
            .maxByOrNull(::qualityScore)

    fun qualityScore(candidate: OcrRecognitionCandidate): Double {
        val tokens = candidate.text.split(Regex("\\s+")).filter { it.isNotBlank() }
        val alphaTokens = tokens.filter { token -> token.any(Char::isLetter) }
        val readableRatio = if (alphaTokens.isEmpty()) {
            0.0
        } else {
            alphaTokens.count(::isReadableToken).toDouble() / alphaTokens.size
        }
        val tinyRatio = if (alphaTokens.isEmpty()) {
            1.0
        } else {
            alphaTokens.count { token -> token.filter(Char::isLetter).length <= 2 }
                .toDouble() / alphaTokens.size
        }
        val cueCount = medicineCue.findAll(candidate.text).count().coerceAtMost(6)
        val validStrengthCount = strengthCue.findAll(candidate.text).count().coerceAtMost(3)

        return candidate.averageConfidence * 100.0 +
            readableRatio * 60.0 -
            tinyRatio * 45.0 +
            cueCount * 8.0 +
            validStrengthCount * 25.0 +
            candidate.lineCount.coerceAtMost(16) * 0.75
    }

    private fun isReadableToken(token: String): Boolean {
        val letters = token.filter(Char::isLetter)
        if (letters.length < 3) return false
        if (letters.all { it.equals(letters.first(), ignoreCase = true) }) return false
        return true
    }
}
