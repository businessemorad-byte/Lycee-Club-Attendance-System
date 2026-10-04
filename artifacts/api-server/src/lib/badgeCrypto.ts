import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

type BadgePayload = {
  version: 1;
  studentId: string;
  massar: string;
  createdTimestamp: number;
  nonce: string;
};

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes to issue badges.");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("lycee-mustapha-el-maani", "utf8"),
      Buffer.from("club-digital-badge-v1", "utf8"),
      32,
    ),
  );
}

export function encryptBadge(studentId: string, massar: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload: BadgePayload = {
    version: 1,
    studentId,
    massar,
    createdTimestamp: Date.now(),
    nonce: randomBytes(12).toString("hex"),
  };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptBadge(token: string): BadgePayload | null {
  try {
    const [version, ivPart, tagPart, ciphertextPart, extra] = token.split(".");
    if (
      version !== VERSION ||
      !ivPart ||
      !tagPart ||
      !ciphertextPart ||
      extra !== undefined
    ) {
      return null;
    }
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (
      iv.length !== IV_BYTES ||
      tag.length !== TAG_BYTES ||
      ciphertext.length === 0 ||
      iv.toString("base64url") !== ivPart ||
      tag.toString("base64url") !== tagPart ||
      ciphertext.toString("base64url") !== ciphertextPart
    ) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as Partial<BadgePayload>;
    if (
      payload.version !== 1 ||
      typeof payload.studentId !== "string" ||
      typeof payload.massar !== "string" ||
      typeof payload.createdTimestamp !== "number" ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    return payload as BadgePayload;
  } catch {
    return null;
  }
}