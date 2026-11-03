import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { MODEL_IMAGE_MAX_EDGE, isDecodable, prepareForModel } from "../src/extraction/image.js";

const png = (width, height, channels = 3, background = "#336699") => sharp({ create: { width, height, channels, background } }).png().toBuffer();

test("the cap is 1280 px on the longest edge", () => {
  assert.equal(MODEL_IMAGE_MAX_EDGE, 1280);
});

test("a tall flyer is scaled to 1280 px high, aspect ratio kept", async () => {
  const r = await prepareForModel(await png(1256, 1712), "image/png");
  assert.deepEqual([r.width, r.height], [939, 1280]);
  assert.deepEqual([r.originalWidth, r.originalHeight], [1256, 1712]);
  assert.equal(r.resized, true);
  assert.equal(r.mimeType, "image/jpeg");
  const m = await sharp(r.buffer).metadata();
  assert.deepEqual([m.format, m.width, m.height], ["jpeg", 939, 1280]);
});

test("a wide image is scaled by its width", async () => {
  const r = await prepareForModel(await png(3000, 1000), "image/png");
  assert.deepEqual([r.width, r.height], [1280, 427]);
});

test("an image within the cap is passed through byte for byte, never enlarged", async () => {
  const small = await png(400, 300);
  const r = await prepareForModel(small, "image/png");
  assert.equal(r.resized, false);
  assert.equal(r.buffer, small);
  assert.equal(r.mimeType, "image/png");
  assert.deepEqual([r.width, r.height], [400, 300]);
  const exact = await prepareForModel(await png(1280, 700), "image/png");
  assert.equal(exact.resized, false);
});

test("EXIF orientation is applied, so a phone photo is sent upright", async () => {
  // 2000x1000 pixels flagged as rotated 90 degrees: displayed as 1000x2000.
  const rotated = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#cc3300" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const r = await prepareForModel(rotated, "image/jpeg");
  assert.deepEqual([r.originalWidth, r.originalHeight], [1000, 2000]);
  assert.deepEqual([r.width, r.height], [640, 1280]);
  assert.equal(r.resized, true);
});

test("transparent pixels become white, not black, when converted to JPEG", async () => {
  const transparent = await sharp({ create: { width: 2000, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r = await prepareForModel(transparent, "image/png");
  const { data } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240, `pixel was ${[...data.subarray(0, 3)]}`);
});

test("isDecodable and prepareForModel reject bytes that are not an image", async () => {
  assert.equal(await isDecodable(await png(10, 10)), true);
  assert.equal(await isDecodable(Buffer.from("not an image")), false);
  assert.equal(await isDecodable(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)])), false);
  await assert.rejects(prepareForModel(Buffer.from("not an image"), "image/png"));
});
