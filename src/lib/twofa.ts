import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "crypto";

const ISSUER = "STATUS ONE";

export function novoSegredo() { return new OTPAuth.Secret({ size: 20 }).base32; }
export function totp(secret: string, label: string) { return new OTPAuth.TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }); }
export function verificarCodigo(secret: string, codigo: string) { const t = totp(secret, "x"); return t.validate({ token: codigo.replace(/\s/g, ""), window: 1 }) !== null; }
export async function qrSvg(secret: string, label: string) { return QRCode.toString(totp(secret, label).toString(), { type: "svg", margin: 1, width: 180 }); }
export async function gerarBackupCodes() { const codes = Array.from({ length: 8 }, () => `${randomInt(10000, 99999)}-${randomInt(10000, 99999)}`); const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 8))); return { codes, hashes }; }
export async function usarBackupCode(hashes: string[], codigo: string) { for (let i = 0; i < hashes.length; i++) if (await bcrypt.compare(codigo.trim(), hashes[i])) return hashes.filter((_, j) => j !== i); return null; }
export const preToken = () => randomBytes(24).toString("hex");
