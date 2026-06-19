export function withAdminAuthorization(
  token: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') continue;
    merged[key] = value;
  }

  return {
    ...merged,
    Authorization: `Bearer ${token}`,
  };
}
