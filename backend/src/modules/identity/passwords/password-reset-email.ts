import type { PasswordResetDeliveryPayload } from '../verification/delivery/encrypted-delivery-payload.js';
import type { OutboundEmail } from '../../../infrastructure/email/email-transport.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function renderPasswordResetEmail(
  payload: PasswordResetDeliveryPayload,
  frontendOrigin: string,
  expectedEmail: string,
  expectedExpiry: Date,
): OutboundEmail {
  const url = new URL(payload.passwordResetUrl);
  const token = url.searchParams.get('token');

  if (
    url.origin !== frontendOrigin ||
    url.pathname !== '/reset-password' ||
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
    throw new Error('Password reset delivery payload is invalid.');
  }

  const safeUrl = escapeHtml(url.toString());

  return {
    to: expectedEmail,
    subject: 'Reset your Tennis Xpress password',
    text:
      `Use this link to choose a new Tennis Xpress password:\n\n` +
      `${url.toString()}\n\nThis link expires in 30 minutes.`,
    html:
      '<!doctype html><html><body>' +
      '<p>Use this link to choose a new Tennis Xpress password:</p>' +
      `<p><a href="${safeUrl}">Reset password</a></p>` +
      '<p>This link expires in 30 minutes.</p>' +
      '</body></html>',
  };
}
