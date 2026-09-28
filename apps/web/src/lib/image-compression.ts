export interface CompressedImageResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
}

interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
  maxBytes?: number;
  outputName?: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read the selected image.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to prepare the image for upload.'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

function scaledSize(width: number, height: number, maxDimension: number) {
  const largest = Math.max(width, height);
  if (largest <= maxDimension) return { width, height };
  const scale = maxDimension / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressedImageResult> {
  const maxDimension = options.maxDimension ?? 1600;
  const maxBytes = options.maxBytes ?? 2.5 * 1024 * 1024;
  let quality = options.quality ?? 0.82;

  const image = await loadImage(file);
  const size = scaledSize(image.naturalWidth, image.naturalHeight, maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: false,
  });
  if (!context) {
    throw new Error('Image preparation is not supported in this browser.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);

  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > maxBytes && quality > 0.52) {
    quality = Math.max(0.52, quality - 0.1);
    blob = await canvasToBlob(canvas, quality);
  }

  const safeName = ((options.outputName ?? file.name.replace(/\.[^.]+$/, '')) || 'package-photo')
    .replace(/[^a-z0-9_.-]+/gi, '-')
    .replace(/-+/g, '-');

  return {
    file: new File([blob], `${safeName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    }),
    originalBytes: file.size,
    compressedBytes: blob.size,
  };
}
