import type { Env } from '../types';

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  frontendUrl: string;
}

export function getEmailConfig(env: Env): EmailConfig | null {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.FRONTEND_URL) return null;
  return { apiKey: env.RESEND_API_KEY, fromEmail: env.RESEND_FROM_EMAIL, frontendUrl: env.FRONTEND_URL };
}

/** Posts to the Resend API directly (no SDK — Workers-friendly, one dependency-free fetch). Returns
 * false on any failure instead of throwing, since a notification email is never allowed to block or
 * fail the action that triggered it (matches ExotelVoiceProvider's own "best-effort" callers). */
export async function sendEmail(config: EmailConfig, to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.fromEmail, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error('Resend send failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('Resend send threw', e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Kept deliberately plain (no images/fonts) — every field is dynamic, so this stays readable as raw HTML with no external assets to break. */
export function welcomeEmailHtml(config: EmailConfig, displayName: string, roleNames: string[]): string {
  const name = escapeHtml(displayName);
  const roles = escapeHtml(roleNames.join(', ') || 'no role assigned yet');
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin-bottom: 4px;">Welcome to ECHT Connect</h2>
      <p>Hi ${name},</p>
      <p>You've been added to <strong>ECHT Connect</strong> as <strong>${roles}</strong>. You can sign in now with your Google account:</p>
      <p style="margin: 24px 0;">
        <a href="${config.frontendUrl}" style="background: #22E9A6; color: #070B14; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Open ECHT Connect</a>
      </p>
      <p style="color: #666; font-size: 13px;">Sign in with the Google account matching this email address — no separate password needed.</p>
    </div>
  `.trim();
}
