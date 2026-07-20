const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_CLIPBOARD_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"]
]);

function imageBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("剪贴板图片数据无效");
}

function matchesImageSignature(bytes, mimeType) {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "image/gif") return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  if (mimeType === "image/bmp") return bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM";
  return false;
}

function saveClipboardImage(payload, directory) {
  const mimeType = String(payload?.mimeType || "").toLowerCase().split(";")[0].trim();
  const extension = IMAGE_EXTENSIONS.get(mimeType);
  if (!extension) throw new Error("剪贴板中的图片格式暂不支持");
  const bytes = imageBytes(payload?.bytes);
  if (!bytes.length) throw new Error("剪贴板图片为空");
  if (bytes.length > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error("剪贴板图片超过 25 MB");
  if (!matchesImageSignature(bytes, mimeType)) throw new Error("剪贴板图片内容与格式不匹配");
  const targetDirectory = path.resolve(String(directory || ""));
  fs.mkdirSync(targetDirectory, { recursive: true });
  const filename = `pasted-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  const target = path.join(targetDirectory, filename);
  fs.writeFileSync(target, bytes, { flag: "wx" });
  return target;
}

module.exports = {
  IMAGE_EXTENSIONS,
  MAX_CLIPBOARD_IMAGE_BYTES,
  matchesImageSignature,
  saveClipboardImage
};
