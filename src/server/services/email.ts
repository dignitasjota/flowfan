import { Resend } from "resend";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("email-service");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "FlowFan <noreply@flowfan.app>";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!RESEND_API_KEY) {
    return null;
  }
  if (!resend) {
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const client = getResend();
  if (!client) {
    log.warn({ to, subject }, "Email not sent — RESEND_API_KEY not configured");
    return;
  }

  const { error } = await client.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    log.error({ err: error, to, subject }, "Failed to send email");
    throw new Error(`Email send failed: ${error.message}`);
  }

  log.info({ to, subject }, "Email sent successfully");
}

// ============================================================
// Templates
// ============================================================

function wrapTemplate(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">FlowFan</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">${title}</p>
  </div>
  <div style="background:#1f2937;padding:32px 24px;border-radius:0 0 12px 12px;color:#e5e7eb;font-size:14px;line-height:1.6;">
    ${content}
  </div>
  <p style="text-align:center;color:#6b7280;font-size:12px;margin-top:16px;">
    &copy; ${new Date().getFullYear()} FlowFan — CRM para Creadores
  </p>
</div>
</body>
</html>`;
}

function buttonHtml(text: string, url: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${text}</a>
  </div>`;
}

// ============================================================
// Email methods
// ============================================================

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = wrapTemplate(
    "Verifica tu email",
    `<p>Gracias por registrarte en FlowFan. Haz clic en el boton para verificar tu email:</p>
    ${buttonHtml("Verificar email", verifyUrl)}
    <p style="color:#9ca3af;font-size:12px;">Si no creaste esta cuenta, puedes ignorar este email. El enlace expira en 24 horas.</p>`
  );
  await send(to, "Verifica tu email — FlowFan", html);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = wrapTemplate(
    "Restablecer contrasena",
    `<p>Has solicitado restablecer tu contrasena. Haz clic en el boton:</p>
    ${buttonHtml("Restablecer contrasena", resetUrl)}
    <p style="color:#9ca3af;font-size:12px;">Este enlace expira en 1 hora. Si no solicitaste esto, ignora este email.</p>`
  );
  await send(to, "Restablecer contrasena — FlowFan", html);
}

export type DailySummaryData = {
  creatorName: string;
  newContacts: number;
  totalMessages: number;
  atRiskCount: number;
  topAction: string;
  date: string;
};

export async function sendDailySummary(to: string, data: DailySummaryData): Promise<void> {
  const html = wrapTemplate(
    `Resumen diario — ${data.date}`,
    `<p>Hola ${data.creatorName}, aqui tienes tu resumen del dia:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#9ca3af;">Nuevos contactos</td><td style="padding:8px 0;text-align:right;font-weight:600;color:white;">${data.newContacts}</td></tr>
      <tr><td style="padding:8px 0;color:#9ca3af;">Mensajes recibidos</td><td style="padding:8px 0;text-align:right;font-weight:600;color:white;">${data.totalMessages}</td></tr>
      <tr><td style="padding:8px 0;color:#9ca3af;">Contactos en riesgo</td><td style="padding:8px 0;text-align:right;font-weight:600;color:${data.atRiskCount > 0 ? "#ef4444" : "#22c55e"};">${data.atRiskCount}</td></tr>
    </table>
    ${data.topAction ? `<p style="background:#374151;padding:12px;border-radius:8px;border-left:3px solid #6366f1;"><strong>Accion recomendada:</strong> ${data.topAction}</p>` : ""}
    ${buttonHtml("Ir a FlowFan", process.env.NEXTAUTH_URL ?? "https://app.flowfan.app")}`
  );
  await send(to, `Resumen diario — ${data.date}`, html);
}

export type WeeklySummaryData = {
  creatorName: string;
  newContacts: number;
  revenueEur: number;
  churnRate: number;
  topContacts: { name: string; stage: string }[];
  weekStart: string;
  weekEnd: string;
};

export async function sendWeeklySummary(to: string, data: WeeklySummaryData): Promise<void> {
  const topContactsHtml = data.topContacts.length > 0
    ? data.topContacts.map((c) => `<li style="margin:4px 0;">${c.name} <span style="color:#9ca3af;">(${c.stage})</span></li>`).join("")
    : "<li style=\"color:#9ca3af;\">Sin contactos activos esta semana</li>";

  const html = wrapTemplate(
    `Resumen semanal — ${data.weekStart} a ${data.weekEnd}`,
    `<p>Hola ${data.creatorName}, aqui tienes tu resumen semanal:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#9ca3af;">Nuevos contactos</td><td style="padding:8px 0;text-align:right;font-weight:600;color:white;">${data.newContacts}</td></tr>
      <tr><td style="padding:8px 0;color:#9ca3af;">Revenue</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#22c55e;">${data.revenueEur.toFixed(2)}€</td></tr>
      <tr><td style="padding:8px 0;color:#9ca3af;">Churn rate</td><td style="padding:8px 0;text-align:right;font-weight:600;color:${data.churnRate > 10 ? "#ef4444" : "#22c55e"};">${data.churnRate}%</td></tr>
    </table>
    <p style="color:#9ca3af;margin-bottom:4px;">Top contactos:</p>
    <ul style="margin:0;padding-left:20px;color:white;">${topContactsHtml}</ul>
    ${buttonHtml("Ir a FlowFan", process.env.NEXTAUTH_URL ?? "https://app.flowfan.app")}`
  );
  await send(to, `Resumen semanal — ${data.weekStart} a ${data.weekEnd}`, html);
}

export type ChurnAlertData = {
  creatorName: string;
  contacts: { name: string; score: number; stage: string }[];
};

export async function sendChurnAlert(to: string, data: ChurnAlertData): Promise<void> {
  const contactRows = data.contacts
    .map((c) => `<tr><td style="padding:6px 0;color:white;">${c.name}</td><td style="padding:6px 0;text-align:center;color:#ef4444;font-weight:600;">${c.score}</td><td style="padding:6px 0;text-align:right;color:#9ca3af;">${c.stage}</td></tr>`)
    .join("");

  const html = wrapTemplate(
    "Alerta de churn",
    `<p>Hola ${data.creatorName}, ${data.contacts.length} contacto${data.contacts.length > 1 ? "s" : ""} en riesgo de perderse:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="border-bottom:1px solid #374151;"><th style="padding:6px 0;text-align:left;color:#9ca3af;font-weight:500;">Contacto</th><th style="padding:6px 0;text-align:center;color:#9ca3af;font-weight:500;">Riesgo</th><th style="padding:6px 0;text-align:right;color:#9ca3af;font-weight:500;">Etapa</th></tr>
      ${contactRows}
    </table>
    <p>Te recomendamos enviarles un mensaje personalizado pronto.</p>
    ${buttonHtml("Ver contactos en riesgo", (process.env.NEXTAUTH_URL ?? "https://app.flowfan.app") + "/dashboard")}`
  );
  await send(to, `Alerta: ${data.contacts.length} contacto${data.contacts.length > 1 ? "s" : ""} en riesgo — FlowFan`, html);
}
