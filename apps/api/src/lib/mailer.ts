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

export interface PasswordResetEmail {
  to: string;
  name: string;
  link: string;
  schoolName: string;
}

// What one send attempt resolved to. Callers count "sent" for their
// emailed tallies and treat anything else as skipped — a suppressed demo
// email must never inflate a sent count (§13.11).
export type EmailDelivery = "sent" | "suppressed-demo";

// The only school context any send needs: the demo flag that switches
// sending to logging, plus the slug that identifies the school in the log.
export interface MailSchool {
  isDemo: boolean;
  slug: string;
}

export interface Mailer {
  sendAbsenteeAlert(alert: AbsenteeAlert): Promise<EmailDelivery>;
  sendNoticeEmail(email: NoticeEmail): Promise<EmailDelivery>;
  sendFeeReminder(email: FeeReminderEmail): Promise<EmailDelivery>;
  sendPasswordResetEmail(email: PasswordResetEmail): Promise<EmailDelivery>;
}

// Brevo free SMTP relay (spec §2: 300/day, forever, no card) — the REAL
// notification channel until/unless SMS/WhatsApp is enabled (§7 Phase 1).
// Host smtp-relay.brevo.com:587 with STARTTLS; SMTP_USER is the Brevo login,
// SMTP_PASS its SMTP key, SMTP_FROM a verified sender (defaults to the login).
class SmtpMailer implements Mailer {
  constructor(private readonly school: MailSchool) {}

  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Best-effort must also be BOUNDED: with no explicit timeouts a dead or
    // hanging relay (blocked port, DNS blackhole) holds the awaiting HTTP
    // response - notice publish, attendance save, fee reminders - hostage
    // for the socket's full patience. Fail fast instead; callers log and
    // the publish still succeeds without the email.
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 5000,
  });

  private from(): string {
    return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@studyfy.local";
  }

  // THE choke point (§13.11): every outbound email in the product funnels
  // through this one function. Demo schools (seeded `.demo` addresses that
  // don't exist) get log-instead-of-send — a bounce stream would damage the
  // free email account's reputation, and anyone could burn its daily quota
  // in a loop. Real schools send normally. One guard, one log shape, no
  // per-module suppression blocks (those silently diverge — this one can't).
  private async dispatch(kind: string, to: string, send: () => Promise<unknown>): Promise<EmailDelivery> {
    if (this.school.isDemo) {
      logSuppressed(kind, this.school, to);
      return "suppressed-demo";
    }
    await send();
    return "sent";
  }

  async sendAbsenteeAlert(alert: AbsenteeAlert): Promise<EmailDelivery> {
    return this.dispatch("absentee-alert", alert.to, () =>
      this.transporter.sendMail({
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
      }),
    );
  }

  async sendNoticeEmail(email: NoticeEmail): Promise<EmailDelivery> {
    return this.dispatch("notice", email.to, () =>
      this.transporter.sendMail({
        from: this.from(),
        to: email.to,
        subject: `${email.title} — ${email.schoolName}`,
        text: [`Dear ${email.name},`, ``, email.body, ``, `— ${email.schoolName} via Studyfy`].join("\n"),
      }),
    );
  }

  async sendFeeReminder(email: FeeReminderEmail): Promise<EmailDelivery> {
    return this.dispatch(
      "fee-reminder",
      email.to,
      () => {
        const headline =
          email.daysOverdue > 0
            ? `was due on ${email.dueDate} (${email.daysOverdue} day${email.daysOverdue === 1 ? "" : "s"} overdue)`
            : email.daysOverdue === 0
              ? `is due today (${email.dueDate})`
              : `is due on ${email.dueDate}`;
        return this.transporter.sendMail({
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
      },
    );
  }

  async sendPasswordResetEmail(email: PasswordResetEmail): Promise<EmailDelivery> {
    return this.dispatch("password-reset", email.to, () =>
      this.transporter.sendMail({
        from: this.from(),
        to: email.to,
        subject: `Reset your Studyfy password — ${email.schoolName}`,
        text: [
          `Dear ${email.name},`,
          ``,
          `Someone requested a password reset for your Studyfy account at ${email.schoolName}.`,
          `Use this link within 1 hour (single use — it dies after one reset):`,
          ``,
          email.link,
          ``,
          `If that was not you, ignore this email — your password stays unchanged.`,
          ``,
          `— ${email.schoolName} via Studyfy`,
        ].join("\n"),
      }),
    );
  }
}

export class MailerUnconfiguredError extends Error {
  constructor() {
    super("Email is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS (see .env.example).");
  }
}

let override: Mailer | null = null;

// Test seam: tests inject a recorder; production always uses SMTP —
// wrapped by the demo guard in mailerFor() when the school isDemo.
export function setMailer(mailer: Mailer | null): void {
  override = mailer;
}

// Base stub tests spread and override per-case: { ...stubMailer, sendX }.
// Stubs report "sent" — suppression is the SmtpMailer decorator's job, and
// tests that need it go through mailerFor() with a demo school instead.
export const stubMailer: Mailer = {
  sendAbsenteeAlert: async () => "sent",
  sendNoticeEmail: async () => "sent",
  sendFeeReminder: async () => "sent",
  sendPasswordResetEmail: async () => "sent",
};

// THE single send function (§13.11): every outbound email in the product is
// acquired here, with the school it belongs to — never a bare mailer().
// The demo guard wraps EVERYTHING below, including the test override: a
// demo school's email is logged, never delivered, no matter which sender
// sits underneath. Real schools get the override (tests) or SMTP. There is
// no other construction path: SmtpMailer is module-private and the old
// no-school mailer() is gone, so a new send that bypasses the demo guard is
// a compile error, not a review catch. A test asserts exactly that (no bare
// mailer() call in src/).
export function mailerFor(school: MailSchool): Mailer {
  const inner = override ?? smtpMailerOrThrow(school);
  if (!school.isDemo) {
    return inner;
  }
  const suppressed = (kind: string) => async (email: { to: string }): Promise<EmailDelivery> => {
    logSuppressed(kind, school, email.to);
    return "suppressed-demo";
  };
  return {
    sendAbsenteeAlert: suppressed("absentee-alert"),
    sendNoticeEmail: suppressed("notice"),
    sendFeeReminder: suppressed("fee-reminder"),
    sendPasswordResetEmail: suppressed("password-reset"),
  };
}

function logSuppressed(kind: string, school: MailSchool, to: string): void {
  console.log(`[demo] email suppressed (${kind}) for ${school.slug}: logged, not sent to ${to}.`);
}

function smtpMailerOrThrow(school: MailSchool): Mailer {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new MailerUnconfiguredError();
  }
  return new SmtpMailer(school);
}
