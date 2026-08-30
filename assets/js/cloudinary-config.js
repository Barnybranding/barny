// Barny Branding Co. — public Cloudinary browser configuration.
// The cloud name and an UNSIGNED upload preset are safe for frontend use;
// the preset should be scoped (folder, formats, size) in the Cloudinary
// dashboard. Never place the Cloudinary API secret in this file or any
// browser-accessible code.
export const CLOUDINARY_CLOUD_NAME = 'wztfczca';
export const CLOUDINARY_UPLOAD_PRESET = 'Barnypreset';

export const isCloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);

export async function uploadToCloudinary(file, folder) {
  if (!isCloudinaryConfigured) throw new Error('Cloudinary is not configured.');
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  if (folder) form.append('folder', folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Upload failed.');
  return { url: data.secure_url, publicId: data.public_id, resourceType: data.resource_type, originalFilename: data.original_filename };
}
