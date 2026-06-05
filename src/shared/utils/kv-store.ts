export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
}

export function createTerminalStore(prefix = "t3rminal"): KvStore {
  return createBrowserKvStore(prefix);
}

function createBrowserKvStore(prefix: string): KvStore {
  const keyFor = (key: string) => `${prefix}:${key}`;
  const memory = new Map<string, string>();
  const getRaw = async (key: string): Promise<string | null> => {
    const storageKey = keyFor(key);
    try {
      return window.localStorage.getItem(storageKey) ?? memory.get(storageKey) ?? null;
    } catch {
      return memory.get(storageKey) ?? null;
    }
  };
  const setRaw = async (key: string, value: string): Promise<void> => {
    const storageKey = keyFor(key);
    memory.set(storageKey, value);
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // WKWebView storage can be unavailable during early product startup.
    }
  };
  return {
    async get(key) {
      return getRaw(key);
    },
    async set(key, value) {
      await setRaw(key, value);
    },
    async remove(key) {
      const storageKey = keyFor(key);
      memory.delete(storageKey);
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Memory fallback is already cleared.
      }
    },
    async getJSON<T>(key: string) {
      const raw = await getRaw(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      await setRaw(key, JSON.stringify(value));
    },
  };
}
