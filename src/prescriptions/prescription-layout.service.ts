import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface LayoutResult {
  rxCrop: Buffer;
  instructionCrop: Buffer;
  layoutConfidence: number;
}

interface RxDetectionResult {
  topRatio: number;
  leftRatio: number;
  confidence: number;
  detectedGapStart: number | null;
  detectedGapEnd: number | null;
  detectedDividerX: number | null;
}

/**
 * Conservative prescription-region detector.
 *
 * It preserves the full page for validation but sends only the probable
 * lower prescription region to the medicine OCR pipeline.
 *
 * The detector searches for a horizontal whitespace boundary between
 * patient/vital information and the handwritten Rx section.
 */
@Injectable()
export class PrescriptionLayoutService {
  private readonly logger = new Logger(PrescriptionLayoutService.name);

  private readonly maxDimension = Number(
    process.env.OCR_MAX_IMAGE_DIMENSION || 2600,
  );

  private readonly maxPixels = Number(
    process.env.OCR_MAX_IMAGE_PIXELS || 25_000_000,
  );

  async segmentPrescription(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<LayoutResult> {
    if (!imageBuffer?.length) {
      throw new BadRequestException('Uploaded prescription image is empty');
    }

    if (mimeType && !/^image\/(?:jpeg|png|webp|tiff?)$/i.test(mimeType)) {
      throw new BadRequestException(
        `Unsupported prescription image type: ${mimeType}`,
      );
    }

    let metadata: sharp.Metadata;

    try {
      metadata = await sharp(imageBuffer, {
        failOn: 'error',
        limitInputPixels: this.maxPixels,
      }).metadata();
    } catch {
      throw new BadRequestException(
        'Prescription image is corrupt or unreadable',
      );
    }

    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;

    if (sourceWidth < 200 || sourceHeight < 200) {
      throw new BadRequestException(
        'Prescription image resolution is too small for reliable OCR',
      );
    }

    const longestSide = Math.max(sourceWidth, sourceHeight);

    const resize =
      longestSide > this.maxDimension
        ? {
            width:
              sourceWidth >= sourceHeight ? this.maxDimension : undefined,
            height:
              sourceHeight > sourceWidth ? this.maxDimension : undefined,
            fit: 'inside' as const,
            withoutEnlargement: true,
          }
        : undefined;

    const normalizationPipeline = sharp(imageBuffer, {
      failOn: 'error',
      limitInputPixels: this.maxPixels,
    })
      .rotate()
      .flatten({ background: '#ffffff' });

    const normalizedResult = resize
      ? await normalizationPipeline
          .resize(resize)
          .png()
          .toBuffer({ resolveWithObject: true })
      : await normalizationPipeline
          .png()
          .toBuffer({ resolveWithObject: true });

    const normalizedPage = normalizedResult.data;
    const width = normalizedResult.info.width;
    const height = normalizedResult.info.height;

    const detection = await this.detectRxRegion(normalizedPage);

    const configuredTop = Number(process.env.OCR_RX_TOP_RATIO);
    const configuredLeft = Number(process.env.OCR_RX_LEFT_RATIO);
    const configuredBottom = Number(process.env.OCR_RX_BOTTOM_RATIO);

    const detectedTopRatio =
      Number.isFinite(configuredTop) &&
      configuredTop >= 0.2 &&
      configuredTop <= 0.8
        ? configuredTop
        : detection.topRatio;

    const detectedLeftRatio =
      Number.isFinite(configuredLeft) &&
      configuredLeft >= 0 &&
      configuredLeft <= 0.8
        ? configuredLeft
        : detection.leftRatio;

    const bottomRatio =
      Number.isFinite(configuredBottom) &&
      configuredBottom >= 0.6 &&
      configuredBottom <= 1
        ? configuredBottom
        : 0.94;

    const paddedTopRatio = Math.max(0.28, detectedTopRatio - 0.025);

    const left = Math.max(0, Math.round(width * detectedLeftRatio));
    const top = Math.max(0, Math.round(height * paddedTopRatio));
    const right = Math.min(width, Math.round(width * 0.98));
    const bottom = Math.min(height, Math.round(height * bottomRatio));

    const cropWidth = Math.max(1, right - left);
    const cropHeight = Math.max(1, bottom - top);

    // Refuse an implausibly small crop and use a conservative lower-page crop.
    const safeTop =
      cropHeight < Math.round(height * 0.25)
        ? Math.round(height * 0.4)
        : top;

    const safeHeight = Math.max(
      1,
      Math.min(height - safeTop, bottom - safeTop),
    );

    const rxCrop = await sharp(normalizedPage)
      .extract({
        left,
        top: safeTop,
        width: cropWidth,
        height: safeHeight,
      })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    // The downstream pipeline currently expects both buffers.
    // Keep them identical until instruction extraction becomes independent.
    const instructionCrop = rxCrop;

    const layoutConfidence = Math.round(
      65 + Math.min(1, detection.confidence) * 25,
    );

    this.logger.log(
      [
        `Detected probable Rx region`,
        `page=${width}x${height}`,
        `crop=${left},${safeTop},${cropWidth},${safeHeight}`,
        `topRatio=${(safeTop / height).toFixed(3)}`,
        `leftRatio=${(left / width).toFixed(3)}`,
        `confidence=${layoutConfidence}`,
        detection.detectedDividerX !== null
          ? `dividerX=${detection.detectedDividerX}`
          : 'dividerX=none',
        detection.detectedGapStart !== null
          ? `gap=${detection.detectedGapStart}-${detection.detectedGapEnd}`
          : 'gap=fallback',
      ].join(' | '),
    );

    return {
      rxCrop,
      instructionCrop,
      layoutConfidence,
    };
  }

  private async detectRxRegion(
    normalizedPage: Buffer,
  ): Promise<RxDetectionResult> {
    const analysisWidth = 900;

    const analysis = await sharp(normalizedPage)
      .resize({
        width: analysisWidth,
        withoutEnlargement: true,
      })
      .grayscale()
      .normalize()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = analysis.info.width;
    const height = analysis.info.height;
    const pixels = analysis.data;

    // Detect a long vertical divider near the centre of the document.
    // Many clinical forms place history on the left and Rx on the right.
    const dividerSearchStart = Math.round(width * 0.32);
    const dividerSearchEnd = Math.round(width * 0.68);
    const dividerYStart = Math.round(height * 0.23);
    const dividerYEnd = Math.round(height * 0.94);

    let bestDividerX: number | null = null;
    let bestDividerDensity = 0;
    let bestDividerContinuity = 0;
    let bestDividerScore = 0;

    for (let x = dividerSearchStart; x <= dividerSearchEnd; x++) {
      let darkPixels = 0;
      let currentRun = 0;
      let longestRun = 0;
      let toleratedGap = 0;

      for (let y = dividerYStart; y < dividerYEnd; y++) {
        if (pixels[y * width + x] < 185) {
          darkPixels++;
          currentRun += toleratedGap + 1;
          toleratedGap = 0;
          longestRun = Math.max(longestRun, currentRun);
        } else if (currentRun > 0 && toleratedGap < 2) {
          toleratedGap++;
        } else {
          currentRun = 0;
          toleratedGap = 0;
        }
      }

      const examinedHeight = Math.max(1, dividerYEnd - dividerYStart);
      const density = darkPixels / examinedHeight;
      const continuity = longestRun / examinedHeight;
      const score = continuity * 0.8 + density * 0.2;

      if (score > bestDividerScore) {
        bestDividerScore = score;
        bestDividerDensity = density;
        bestDividerContinuity = continuity;
        bestDividerX = x;
      }
    }

    // A real form divider must be substantially continuous. Isolated
    // handwriting strokes must never be treated as a column boundary.
    const hasReliableDivider =
      bestDividerX !== null &&
      bestDividerDensity >= 0.1 &&
      bestDividerContinuity >= 0.2;

    // Start slightly to the right of the divider so the divider itself and
    // left-column text cannot pollute medicine OCR.
    const contentLeft = hasReliableDivider
      ? Math.min(
          Math.round(width * 0.72),
          bestDividerX! + Math.round(width * 0.018),
        )
      : Math.round(width * 0.04);

    const contentRight = Math.round(width * 0.97);
    const usableWidth = Math.max(1, contentRight - contentLeft);

    const rowDensity: number[] = new Array(height).fill(0);

    for (let y = 0; y < height; y++) {
      let darkPixels = 0;
      const rowOffset = y * width;

      for (let x = contentLeft; x < contentRight; x++) {
        if (pixels[rowOffset + x] < 205) {
          darkPixels++;
        }
      }

      rowDensity[y] = darkPixels / usableWidth;
    }

    const smoothRadius = Math.max(2, Math.round(height * 0.004));
    const smoothed = this.smooth(rowDensity, smoothRadius);

    const searchStart = Math.round(height * 0.28);
    const searchEnd = Math.round(height * 0.68);

    const searchValues = smoothed.slice(searchStart, searchEnd);
    const lowDensityReference = this.percentile(searchValues, 0.28);

    const whitespaceThreshold = Math.min(
      0.025,
      Math.max(0.0035, lowDensityReference * 1.35),
    );

    const minimumGapHeight = Math.max(4, Math.round(height * 0.008));

    let bestStart: number | null = null;
    let bestEnd: number | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let runStart: number | null = null;

    for (let y = searchStart; y <= searchEnd; y++) {
      const isWhitespace =
        y < searchEnd && smoothed[y] <= whitespaceThreshold;

      if (isWhitespace && runStart === null) {
        runStart = y;
      }

      if ((!isWhitespace || y === searchEnd) && runStart !== null) {
        const runEnd = y - 1;
        const runLength = runEnd - runStart + 1;

        if (runLength >= minimumGapHeight) {
          const center = (runStart + runEnd) / 2;
          const centerRatio = center / height;
          const positionPenalty =
            Math.abs(centerRatio - 0.45) * height * 0.35;
          const score = runLength * 2 - positionPenalty;

          if (score > bestScore) {
            bestScore = score;
            bestStart = runStart;
            bestEnd = runEnd;
          }
        }

        runStart = null;
      }
    }

    const leftRatio = this.clamp(contentLeft / width, 0.02, 0.72);

    if (bestEnd !== null) {
      const topRatio = this.clamp(
        (bestEnd + Math.round(height * 0.008)) / height,
        0.3,
        0.66,
      );

      const gapLength =
        bestStart !== null ? bestEnd - bestStart + 1 : minimumGapHeight;

      const gapConfidence = this.clamp(
        gapLength / Math.max(minimumGapHeight * 4, 1),
        0.35,
        1,
      );

      const dividerConfidence = hasReliableDivider
        ? this.clamp(bestDividerDensity * 2, 0.55, 1)
        : 0.3;

      return {
        topRatio,
        leftRatio,
        confidence: Math.max(gapConfidence, dividerConfidence),
        detectedGapStart: bestStart,
        detectedGapEnd: bestEnd,
        detectedDividerX: hasReliableDivider ? bestDividerX : null,
      };
    }

    return {
      topRatio: hasReliableDivider ? 0.40 : 0.48,
      leftRatio,
      confidence: hasReliableDivider ? 0.65 : 0.3,
      detectedGapStart: null,
      detectedGapEnd: null,
      detectedDividerX: hasReliableDivider ? bestDividerX : null,
    };
  }

  private smooth(values: number[], radius: number): number[] {
    const output = new Array(values.length).fill(0);
    const prefix = new Array(values.length + 1).fill(0);

    for (let i = 0; i < values.length; i++) {
      prefix[i + 1] = prefix[i] + values[i];
    }

    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - radius);
      const end = Math.min(values.length - 1, i + radius);
      const count = end - start + 1;

      output[i] = (prefix[end + 1] - prefix[start]) / count;
    }

    return output;
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * percentile)),
    );

    return sorted[index];
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }
}