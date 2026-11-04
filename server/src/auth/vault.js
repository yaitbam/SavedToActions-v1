import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
export function createVault(dir, secret) {
  let key;
  if (secret) { key = Buffer.from(secret, "hex"); if (key.length !== 32) throw new Error("TOKEN_ENC_KEY must be 64 hex characters"); }
  else {
    if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENC_KEY is required in production");
    const file = path.join(dir, "token.key");
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
    key = fs.readFileSync(file);
  }
  return {
    seal(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return { encrypted: "v1", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    },
    open(value) {
      if (value?.encrypted !== "v1") throw new Error("Unencrypted credentials require reconnect");
      const cipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
      cipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, "base64")), cipher.final()]).toString());
    },
  };
}
