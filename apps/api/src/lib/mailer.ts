import nodemailer from "nodemailer";

export interface AbsenteeAlert {
  to: string;
  guardianName: string;
  studentName: string;
  date: string;
  schoolName: string;
}

export interface NoticeEmail {
  to: string;
  name: string;
  title: string;
  body: string;
  schoolName: string;
}

export interface Mailer {
  sendAbsenteeAlert(alert: AbsenteeAlert): Promise<void>;
  sendNoticeEmail(email: NoticeEmail): Promise<void>;
}

// Brevo free SMTP relay (spec §2: 300/day, forever, no card) — the REAL
// notification channel until/unless SMS/WhatsApp is enabled (§7 Phase 1).
// Host smtp-relay.brevo.com:587 with STARTTLS; SMTP_USER is the Brevo login,
// SMTP_PASS its SMTP key, SMTP_FROM a verified sender (defaults to the login).
class SmtpMailer implements Mailer {
  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  private from(): string {
    return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@studyfy.local";
  }

  async sendAbsenteeAlert(alert: AbsenteeAlert): Promise<void> {
    await this.transporter.sendMail({
      from: this.from(),
      to: alert.to,
      subject: `Absent alert: ${alert.studentName} — ${alert.date} (${alert.schoolName})`,
      text: [
        `Dear ${alert.guardianName},`,
        ``,
        `This is to inform you that ${alert.studentName} was marked absent on ${alert.date} at ${alert.schoolName}.`,
        `If this is unexpected, please contact the school office.`,
        ``,
        `— ${alert.schoolName} via Studyfy`,
      ].join("\n"),
    });
  }

  async sendNoticeEmail(email: NoticeEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from(),
      to: email.to,
      subject: `${email.title} — ${email.schoolName}`,
      text: [`Dear ${email.name},`, ``, email.body, ``, `— ${email.schoolName} via Studyfy`].join("\n"),
    });
  }
}

export class MailerUnconfiguredError extends Error {
  constructor() {
    super("Email is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS (see .env.example).");
  }
}

let override: Mailer | null = null;

// Test seam: tests inject a recorder; production always uses SMTP.
// There is no log-only fallback — §7 says email is the real channel.
export function setMailer(mailer: Mailer | null): void {
  override = mailer;
}

// Base stub tests spread and override per-case: { ...stubMailer, sendX }.
export const stubMailer: Mailer = {
  sendAbsenteeAlert: async () => undefined,
  sendNoticeEmail: async () => undefined,
};

export function mailer(): Mailer {
  if (override) {
    return override;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new MailerUnconfiguredError();
  }
  return new SmtpMailer();
}
