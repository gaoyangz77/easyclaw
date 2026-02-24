import type { PendingImage } from "./chat-utils.js";
import { COMPRESS_MAX_DIMENSION, COMPRESS_TARGET_BYTES, COMPRESS_INITIAL_QUALITY, COMPRESS_MIN_QUALITY } from "./chat-utils.js";

/**
 * Compress an image (as a data-URL) by resizing and reducing JPEG quality.
 * Progressively lowers quality until the base64 output fits the target size.
 */
export function compressImage(dataUrl: string): Promise<PendingImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > COMPRESS_MAX_DIMENSION || height > COMPRESS_MAX_DIMENSION) {
        const scale = COMPRESS_MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = "image/jpeg";
      let quality = COMPRESS_INITIAL_QUALITY;
      let resultDataUrl = canvas.toDataURL(mimeType, quality);
      let base64 = resultDataUrl.split(",")[1] ?? "";

      // Progressively reduce quality if over target
      while (base64.length > COMPRESS_TARGET_BYTES && quality > COMPRESS_MIN_QUALITY) {
        quality -= 0.1;
        resultDataUrl = canvas.toDataURL(mimeType, quality);
        base64 = resultDataUrl.split(",")[1] ?? "";
      }

      resolve({ dataUrl: resultDataUrl, base64, mimeType });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function readFileAsPending(file: File): Promise<PendingImage | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      if (base64.length > COMPRESS_TARGET_BYTES) {
        resolve(await compressImage(dataUrl));
        return;
      }
      resolve({ dataUrl, base64, mimeType: file.type });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
