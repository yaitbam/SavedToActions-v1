// Downscale the screenshot before it goes to the model. Only the copy sent to the model is resized,
// the original file on disk is never touched. Smaller images mean fewer image tokens and a faster call.
import sharp from "sharp";

export const MODEL_IMAGE_MAX_EDGE = 1280;
const JPEG_QUALITY = 90;

/** Cheap header check, so an upload with a valid signature but a broken body is rejected before it is stored. */
export async function isDecodable(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return Boolean(meta.width && meta.height);
  } catch {
    return false;
  }
}

/**
 * Returns { buffer, mimeType, width, height, originalWidth, originalHeight, resized }.
 * - Longest edge is capped at maxEdge, aspect ratio kept, never enlarged.
 * - EXIF orientation is applied, so phone screenshots arrive upright.
 * - An image already small enough and upright is passed through unchanged.
 * Throws if the bytes are not a decodable image.
 */
export async function prepareForModel(buffer, mimeType, { maxEdge = MODEL_IMAGE_MAX_EDGE } = {}) {
  const meta = await sharp(buffer).metadata();
  const orientation = meta.orientation ?? 1;
  const swapped = orientation >= 5;
  const originalWidth = swapped ? meta.height : meta.width;
  const originalHeight = swapped ? meta.width : meta.height;
  if (!originalWidth || !originalHeight) throw new Error("image has no dimensions");

  if (Math.max(originalWidth, originalHeight) <= maxEdge && orientation === 1) {
    return { buffer, mimeType, width: originalWidth, height: originalHeight, originalWidth, originalHeight, resized: false };
  }

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
    originalWidth,
    originalHeight,
    resized: info.width !== originalWidth || info.height !== originalHeight,
  };
}
