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

export interface FeeReminderEmail {
  to: string;
  name: string;
  studentName: string;
  schoolName: string;
  amountDue: string;
  dueDate: string;
  daysOverdue: number;
}

export interface Mailer {
  sendAbsenteeAlert(alert: AbsenteeAlert): Promise<void>;
  sendNoticeEmail(email: NoticeEmail): Promise<void>;
  sendFeeReminder(email: FeeReminderEmail): Promise<void>;
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

  async sendFeeReminder(email: FeeReminderEmail): Promise<void> {
    const headline =
      email.daysOverdue > 0
        ? `was due on ${email.dueDate} (${email.daysOverdue} day${email.daysOverdue === 1 ? "" : "s"} overdue)`
        : email.daysOverdue === 0
          ? `is due today (${email.dueDate})`
          : `is due on ${email.dueDate}`;
    await this.transporter.sendMail({
      from: this.from(),
      to: email.to,
      subject: `Fee reminder: ${email.studentName} — ${email.amountDue} ${email.daysOverdue > 0 ? "overdue" : "due"}`,
      text: [
        `Dear ${email.name},`,
        ``,
        `A fee of ${email.amountDue} for ${email.studentName} at ${email.schoolName} ${headline}.`,
        `Please pay at the school office or online. If already paid, ignore this reminder.`,
        ``,
        `— ${email.schoolName} via Studyfy`,
      ].join("\n"),
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
  sendFeeReminder: async () => undefined,
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
