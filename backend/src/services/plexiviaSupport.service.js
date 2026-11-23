import { SystemSettingsModel } from "../models/systemSettings.model.js";
import { encryptText, decryptText } from "../utils/crypto.util.js";

export const DEFAULT_PLEXIVIA_API_BASE_URL = "https://api.plexivia.com";
const KEY_RE = /^\d{6,24}\.[a-f0-9]{24,128}$/i;
const CACHE_MS = 30_000;

let cache = { at: 0, value: null };
const listeners = new Set();

// Strip trailing slashes and /api suffix from base URL
const normalizeBaseUrl = (url) => String(url || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");

// Load and decrypt Plexivia Support Desk configuration from database
export const getSupportConfig = async ({ fresh = false } = {}) => {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let doc = null;
  try {
    doc = await SystemSettingsModel.findOne({ key: "default" }).select("plexiviaSupport").lean();
  } catch {
    if (cache.value) return cache.value;
  }
  const s = doc?.plexiviaSupport || {};
  let key = "";
  if (s.keyEnc) {
    try {
      key = decryptText(s.keyEnc) || "";
    } catch {
      key = "";
    }
  }
  const value = {
    apiBaseUrl: normalizeBaseUrl(s.apiBaseUrl) || DEFAULT_PLEXIVIA_API_BASE_URL,
    key,
    keyHint: s.keyHint || "",
    configured: Boolean(key),
    updatedAt: s.updatedAt || null,
  };
  cache = { at: Date.now(), value };
  return value;
};

// Return safe non-secret support settings for UI display
export const publicSupportConfig = (cfg) => ({
  apiBaseUrl: cfg.apiBaseUrl,
  keyHint: cfg.keyHint,
  configured: cfg.configured,
  updatedAt: cfg.updatedAt,
});

// Create a 400 validation error
const validationError = (message) => Object.assign(new Error(message), { statusCode: 400 });

// Save or remove Plexivia Support Desk configuration and notify listeners
export const saveSupportConfig = async ({ apiBaseUrl, key, remove = false } = {}, userId = "") => {
  const set = { "plexiviaSupport.updatedAt": new Date(), "plexiviaSupport.updatedBy": String(userId || "") };

  if (apiBaseUrl !== undefined) {
    const url = normalizeBaseUrl(apiBaseUrl);
    if (url && !/^https?:\/\/[^\s/]+(:\d+)?$/i.test(url)) {
      throw validationError("Plexivia API URL must look like https://api.plexivia.com");
    }
    set["plexiviaSupport.apiBaseUrl"] = url;
  }

  if (remove) {
    set["plexiviaSupport.keyEnc"] = "";
    set["plexiviaSupport.keyHint"] = "";
  } else if (key !== undefined && String(key).trim()) {
    const raw = String(key).trim();
    if (!KEY_RE.test(raw)) {
      throw validationError("That does not look like a Plexivia support key (it should look like 1234567890123456.abcdef…)");
    }
    set["plexiviaSupport.keyEnc"] = encryptText(raw);
    set["plexiviaSupport.keyHint"] = `…${raw.slice(-4)}`;
  }

  await SystemSettingsModel.findOneAndUpdate(
    { key: "default" },
    { $set: set },
    { upsert: true, setDefaultsOnInsert: true }
  );
  const cfg = await getSupportConfig({ fresh: true });
  for (const fn of listeners) {
    try {
      fn(cfg);
    } catch {
      // Ignore listener errors
    }
  }
  return cfg;
};

// Register a callback when support config changes
export const onSupportConfigChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Test the saved Plexivia support key against upstream API
export const testSupportConnection = async (cfg) => {
  if (!cfg.configured) return { ok: false, message: "No support key saved yet." };
  try {
    const res = await fetch(`${cfg.apiBaseUrl}/api/support/client/tickets`, {
      headers: { Accept: "application/json", "X-Support-Key": cfg.key },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: true,
        message: `Connected to Plexivia. ${Array.isArray(body?.data) ? body.data.length : 0} ticket(s) on record.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Plexivia rejected the key (wrong, revoked, or the client is inactive)." };
    }
    return { ok: false, message: `Plexivia answered with HTTP ${res.status}.` };
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ${cfg.apiBaseUrl}: ${err?.cause?.code || err?.message || "network error"}`,
    };
  }
};
