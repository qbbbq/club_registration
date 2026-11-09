export function getRawFile(uploadFile: unknown): File | null {
  if (uploadFile instanceof File) {
    return uploadFile;
  }

  if (
    uploadFile &&
    typeof uploadFile === 'object' &&
    'raw' in uploadFile &&
    uploadFile.raw instanceof File
  ) {
    return uploadFile.raw;
  }

  return null;
}
