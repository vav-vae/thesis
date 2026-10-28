import { readJsonResponse } from "./http-response";

const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "dpnsayn8m";
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "libot_uploads";
const CLOUDINARY_SOURCE_FOLDER = process.env.NEXT_PUBLIC_CLOUDINARY_SOURCE_FOLDER || "libot/panorama-sources";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const CLOUDINARY_AUTO_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
const PANORAMA_WORKING_MAX_DIMENSION = 1600;

export const isRemoteImageUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\//i.test(value);

async function uploadToCloudinary(
  file: File,
  uploadUrl: string,
  options: { folder?: string } = {},
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  if (options.folder) formData.append("folder", options.folder);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  const data: unknown = await readJsonResponse(response, "Cloudinary could not upload this file.");
  if (
    typeof data !== "object"
    || data === null
    || !("secure_url" in data)
    || typeof data.secure_url !== "string"
  ) {
    throw new Error("Cloudinary did not return an image URL.");
  }

  return data.secure_url;
}

export const uploadImageToCloudinary = (file: File) =>
  uploadToCloudinary(file, CLOUDINARY_UPLOAD_URL);

export const uploadDocumentToCloudinary = (file: File) =>
  uploadToCloudinary(file, CLOUDINARY_AUTO_UPLOAD_URL);

async function ownerFolderId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function resizePanoramaSource(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const largestDimension = Math.max(bitmap.width, bitmap.height);
    if (largestDimension <= PANORAMA_WORKING_MAX_DIMENSION) return file;

    const scale = PANORAMA_WORKING_MAX_DIMENSION / largestDimension;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the panorama photo.");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("This browser could not resize the panorama photo.")),
        "image/jpeg",
        0.9,
      );
    });
    const baseName = file.name.replace(/\.[^.]+$/, "") || "panorama-source";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

function isExpectedPanoramaSourceUrl(value: string, folder: string): boolean {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.split("/").filter(Boolean);
    const expectedFolder = folder.split("/").filter(Boolean);
    return parsed.protocol === "https:"
      && parsed.hostname === "res.cloudinary.com"
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && !parsed.search
      && !parsed.hash
      && path[0] === CLOUDINARY_CLOUD_NAME
      && path[1] === "image"
      && path[2] === "upload"
      && /^v[1-9][0-9]*$/.test(path[3] || "")
      && expectedFolder.every((part, index) => path[index + 4] === part)
      && path.length === expectedFolder.length + 5
      && /^[A-Za-z0-9_-]{1,128}\.(?:jpe?g|png|webp)$/i.test(path.at(-1) || "");
  } catch {
    return false;
  }
}

const panoramaSourceUploads = new WeakMap<
  File,
  { userId: string; promise: Promise<string> }
>();

async function performPanoramaSourceUpload(
  file: File,
  userId: string,
): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error("Panorama sources must be JPG, PNG, or WEBP images no larger than 15 MB.");
  }
  const folder = `${CLOUDINARY_SOURCE_FOLDER}/${await ownerFolderId(userId)}`;
  const preparedFile = await resizePanoramaSource(file);
  const secureUrl = await uploadToCloudinary(preparedFile, CLOUDINARY_UPLOAD_URL, { folder });
  if (!isExpectedPanoramaSourceUrl(secureUrl, folder)) {
    throw new Error("Cloudinary did not place the panorama source in the protected application folder.");
  }
  return secureUrl;
}

export function uploadPanoramaSourceToCloudinary(
  file: File,
  userId: string,
): Promise<string> {
  const existing = panoramaSourceUploads.get(file);
  if (existing?.userId === userId) return existing.promise;

  const promise = performPanoramaSourceUpload(file, userId).catch((error) => {
    if (panoramaSourceUploads.get(file)?.promise === promise) {
      panoramaSourceUploads.delete(file);
    }
    throw error;
  });
  panoramaSourceUploads.set(file, { userId, promise });
  return promise;
}
