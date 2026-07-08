const CLOUDINARY_UPLOAD_URL = "https://api.cloudinary.com/v1_1/dpnsayn8m/image/upload";
const CLOUDINARY_AUTO_UPLOAD_URL = "https://api.cloudinary.com/v1_1/dpnsayn8m/auto/upload";
const CLOUDINARY_UPLOAD_PRESET = "libot_uploads";

export const isRemoteImageUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\//i.test(value);

async function uploadToCloudinary(file: File, uploadUrl: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Cloudinary rejected the image upload.");
  }

  const data: unknown = await response.json();
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
