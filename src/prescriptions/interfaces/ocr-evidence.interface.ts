export interface OcrEvidence {
  /** Stable, content-derived identifier. Never use a random UUID here. */
  id?: string;
  text: string;
  confidence: number;
  lineNumber: number;
  /** Pixel-space [xMin, yMin, xMax, yMax] in the OCR variant image. */
  bbox: number[];
  /** Normalized [0..1] coordinates, allowing cross-variant comparison. */
  normalizedBbox?: number[];
  /** Original OCR polygon when the engine provides one. */
  polygon?: number[][];
  pageIndex?: number;
  engine: string;
  variant: string;
  sourceImage: string;
  sourceWidth?: number;
  sourceHeight?: number;
  transformId?: string;
}
