import { HttpResponseError, readJsonResponse } from "./http-response";
import { panoramaApiFetch } from "./panorama-api";

const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "dpnsayn8m";
const CLOUDINARY_SOURCE_FOLDER = process.env.NEXT_PUBLIC_CLOUDINARY_SOURCE_FOLDER || "libot/panorama-sources";
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const PANORAMA_WORKING_MAX_DIMENSION = 1600;

export const isRemoteImageUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\//i.test(value);

async function uploadToCloudinary(
  file: File,
  purpose: "image" | "document" | "panorama-source",
): Promise<string> {
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 15 MB.");
  const allowedTypes = purpose === "document"
    ? ["image/jpeg", "image/png", "image/webp", "application/pdf"]
    : ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) throw new Error("Choose a JPG, PNG, WEBP image or a supported PDF document.");
  const authorization = await panoramaApiFetch("/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose }),
  });
  const signed = await readJsonResponse<{ cloud_name: string; resource_type: string; params: Record<string, string> }>(authorization, "Unable to authorize this upload.");
  const uploadUrl = `https://api.cloudinary.com/v1_1/${signed.cloud_name}/${signed.resource_type}/upload`;
  const formData = new FormData();
  formData.append("file", file);
  for (const [key, value] of Object.entries(signed.params)) formData.append(key, value);

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw new Error("Cloudinary could not be reached. Check your connection and retry the photo upload.", { cause: error });
  }

  const data: unknown = await readJsonResponse(response, "Cloudinary could not upload this file.");
  if (
    typeof data !== "object"
    || data === null
    || !("secure_url" in data)
    || typeof data.secure_url !== "string"
  ) {
    throw new HttpResponseError("Cloudinary did not return an image URL.", response);
  }

  return data.secure_url;
}

export const uploadImageToCloudinary = (file: File) =>
  uploadToCloudinary(file, "image");

export const uploadDocumentToCloudinary = (file: File) =>
  uploadToCloudinary(file, "document");

async function ownerFolderId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function resizePanoramaSource(file: File): Promise<File> {
  let bitmap: ImageBitmap | null = null;
  let imageUrl = "";
  try {
    try {
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      }
    } catch {
      // The camera JPEG can still decode in an image element on some phones.
    }
    let source: CanvasImageSource;
    let sourceWidth: number;
    let sourceHeight: number;
    if (bitmap) {
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } else {
      imageUrl = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("This photo could not be decoded for upload. Retake it or use a different photo."));
        image.src = imageUrl;
      });
      source = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    }
    const largestDimension = Math.max(sourceWidth, sourceHeight);
    if (largestDimension <= PANORAMA_WORKING_MAX_DIMENSION) return file;

    const scale = PANORAMA_WORKING_MAX_DIMENSION / largestDimension;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the panorama photo.");
    context.drawImage(source, 0, 0, width, height);
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
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
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
  const secureUrl = await uploadToCloudinary(preparedFile, "panorama-source");
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
