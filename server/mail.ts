/**
 * Sending email, through whichever service has a key in the environment:
 *
 *   BREVO_API_KEY  + MAIL_FROM   Brevo (brevo.com). Free for 300 emails a day, and it can send from
 *                                one confirmed address, such as your own Gmail, with no domain.
 *   RESEND_API_KEY + MAIL_FROM   Resend (resend.com). Needs a domain you can add DNS records to.
 *
 * MAIL_FROM is the sender, e.g. "Bull Run <you@gmail.com>". With neither key the app still works:
 * nothing is sent, and the link that would have been emailed is written to the server log.
 */
export interface Mailer {
  /** Whether emails really go out (false: they are only logged). */
  readonly live: boolean;
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || "Sid's Arcade", email: m[2] } : { name: "Sid's Arcade", email: from.trim() };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv, log: (line: string) => void): Mailer {
  const from = env.MAIL_FROM ?? "";
  if (env.BREVO_API_KEY && from) {
    const sender = parseFrom(from);
    return {
      live: true,
      async send(to, subject, text, html) {
        const r = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": env.BREVO_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        });
        if (!r.ok) throw new Error(`Brevo refused the email (${r.status}): ${(await r.text()).slice(0, 300)}`);
      },
    };
  }
  if (env.RESEND_API_KEY && from) {
    return {
      live: true,
      async send(to, subject, text, html) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
        });
        if (!r.ok) throw new Error(`Resend refused the email (${r.status}): ${(await r.text()).slice(0, 300)}`);
      },
    };
  }
  return {
    live: false,
    async send(to, subject, text) {
      log(`Email not sent (no mail service set up) to ${to}: ${subject} :: ${text.replace(/\s+/g, " ")}`);
    },
  };
}

/** A mailer that keeps what it was asked to send, for tests. */
export function recordingMailer(): Mailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    live: true,
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };
}
