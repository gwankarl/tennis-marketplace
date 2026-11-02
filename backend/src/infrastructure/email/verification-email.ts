import type { VerificationDeliveryPayload } from './encrypted-delivery-payload.js';
import type { OutboundEmail } from './email-transport.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function renderVerificationEmail(
  payload: VerificationDeliveryPayload,
  frontendOrigin: string,
  expectedEmail: string,
  expectedExpiry: Date,
): OutboundEmail {
  const url = new URL(payload.verificationUrl);
  const token = url.searchParams.get('token');

  if (
    url.origin !== frontendOrigin ||
    url.pathname !== '/verify-email' ||
    url.searchParams.size !== 1 ||
    !token ||
    !TOKEN_PATTERN.test(token) ||
    payload.recipientEmail !== expectedEmail ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    Date.parse(payload.expiresAt) !== expectedExpiry.getTime()
  ) {
    throw new Error('Verification delivery payload is invalid.');
  }

  const safeUrl = escapeHtml(url.toString());

  return {
    to: expectedEmail,
    subject: 'Verify your Tennis Xpress email',
    text:
      `Use this link to verify your Tennis Xpress email address:\n\n` +
      `${url.toString()}\n\nThis link expires in 24 hours.`,
    html:
      '<!doctype html><html><body>' +
      '<p>Use this link to verify your Tennis Xpress email address:</p>' +
      `<p><a href="${safeUrl}">Verify email</a></p>` +
      '<p>This link expires in 24 hours.</p>' +
      '</body></html>',
  };
}
