export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const types: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const FILE_ACCEPT = Object.keys(types)
  .map((ext) => `.${ext}`)
  .join(",");
export function fileInfo(file: { name: string; size: number; type: string }) {
  if (!file.size) throw new Error("Choose a file that is not empty.");
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Choose a file smaller than 20 MB.");
  const mime = types[file.name.split(".").at(-1)?.toLowerCase() || ""];
  if (!mime)
    throw new Error(
      "Choose an image, video, audio file, PDF, text file, or Office document.",
    );
  const name = file.name
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .slice(0, 200);
  return { name, size: file.size, mime };
}
export function fileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}
