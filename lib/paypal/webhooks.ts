import { verify } from 'node:crypto';
import { paypalFetch } from './rest';

export function crc32(raw: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(raw, 'utf8')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const certs = new Map<string, { pem: string; expires: number }>();
export function trustedCertificateUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.paypal.com') || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Untrusted PayPal certificate URL');
  return url;
}
export function verifyLocalSignature(raw: string, transmissionId: string, time: string, webhookId: string, signature: string, pem: string) {
  return verify('sha256', Buffer.from(`${transmissionId}|${time}|${webhookId}|${crc32(raw)}`), pem, Buffer.from(signature, 'base64'));
}
export async function verifyWebhook(raw: string, headers: Headers): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) throw new Error('PayPal webhook is not configured: set PAYPAL_WEBHOOK_ID in .env.local');
  const id = headers.get('paypal-transmission-id');
  const time = headers.get('paypal-transmission-time');
  const signature = headers.get('paypal-transmission-sig');
  const certUrl = headers.get('paypal-cert-url');
  const algorithm = headers.get('paypal-auth-algo');
  if (!id || !time || !signature || !certUrl || algorithm !== 'SHA256withRSA') return false;
  try { trustedCertificateUrl(certUrl); } catch { return false; }
  try {
    let cert = certs.get(certUrl);
    if (!cert || cert.expires < Date.now()) {
      const response = await fetch(certUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (!response.ok) throw new Error('Certificate download failed');
      const pem = await response.text();
      if (pem.length > 64_000 || !pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Invalid certificate');
      cert = { pem, expires: Date.now() + 3_600_000 };
      if (certs.size >= 100) certs.clear();
      certs.set(certUrl, cert);
    }
    if (verifyLocalSignature(raw, id, time, webhookId, signature, cert.pem)) return true;
  } catch { console.info('[paypal.webhook]', { verification: 'local-failed', transmissionId: id }); }
  const result = await paypalFetch<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', { method: 'POST', body: { auth_algo: algorithm, cert_url: certUrl, transmission_id: id, transmission_sig: signature, transmission_time: time, webhook_id: webhookId, webhook_event: JSON.parse(raw) } });
  return result.verification_status === 'SUCCESS';
}
