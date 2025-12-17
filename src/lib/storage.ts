export const loadJson = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const saveJson = (key: string, value: unknown): void => {
  window.localStorage.setItem(key, JSON.stringify(value));
};
