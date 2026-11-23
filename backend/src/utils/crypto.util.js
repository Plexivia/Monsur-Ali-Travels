import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-cbc";

// Derive a 32-byte encryption key from ACCESS_TOKEN_SECRET
const getEncryptionKey = () => {
  const secret = env.ACCESS_TOKEN_SECRET || "default_fallback_secret_must_be_long_enough";
  return crypto.createHash("sha256").update(String(secret)).digest("base64").substring(0, 32);
};

// Encrypt plain text using AES-256-CBC
export const encryptText = (text) => {
  if (!text) return "";
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
  } catch (error) {
    console.error("Encryption error:", error);
    return text;
  }
};

// Decrypt AES-256-CBC cipher text
export const decryptText = (text) => {
  if (!text) return "";
  const textParts = text.split(":");
  if (textParts.length !== 2) return text;
  try {
    const iv = Buffer.from(textParts[0], "hex");
    const encryptedText = Buffer.from(textParts[1], "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getEncryptionKey()), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("Decryption error:", error);
    return text;
  }
};
