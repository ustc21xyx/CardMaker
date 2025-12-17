export const tryParseJson = <T>(text: string): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export const extractFirstJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

export const extractFirstJsonArray = (text: string): string | null => {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
};
