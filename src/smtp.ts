import nodemailer, { type Transporter } from "nodemailer";
import type { Account } from "./config.js";

const transports = new Map<string, Transporter>();

export function getTransport(account: Account): Transporter {
  const existing = transports.get(account.name);
  if (existing) return existing;
  const t = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.smtp.user, pass: account.smtp.pass },
    tls: account.smtp.allowInvalidCert ? { rejectUnauthorized: false } : undefined,
  });
  transports.set(account.name, t);
  return t;
}

export function closeAllSmtp(): void {
  for (const t of transports.values()) t.close();
  transports.clear();
}
