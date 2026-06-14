function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitBase64DataUrl(value: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value.trim());
  if (!match) return null;
  return {
    mimeType: match[1].trim().toLowerCase(),
    data: match[2].trim(),
  };
}

export function ensureBase64DataUrl(fileData: string, mimeType?: string | null): string {
  const trimmedData = asTrimmedString(fileData);
  if (!trimmedData) return trimmedData;
  if (splitBase64DataUrl(trimmedData)) return trimmedData;

  const normalizedMimeType = asTrimmedString(mimeType).toLowerCase();
  if (!normalizedMimeType) return trimmedData;
  return `data:${normalizedMimeType};base64,${trimmedData}`;
}
