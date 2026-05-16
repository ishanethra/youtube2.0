import nodemailer from "nodemailer";

const getTransporter = ({ host, port, secure, user, pass }) => {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
  });
};

const getTransportCandidates = () => {
  const user = (process.env.SMTP_EMAIL || "").trim();
  const pass = (process.env.SMTP_PASSWORD || "").replace(/\s/g, "");
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim() || "smtp.gmail.com";
  const envPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null;
  const envSecure = process.env.SMTP_SECURE
    ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
    : null;

  const candidates = [];
  if (envPort !== null && envSecure !== null) {
    candidates.push({ host, port: envPort, secure: envSecure, user, pass, label: "env-config" });
  }
  // Gmail STARTTLS (most reliable on cloud providers)
  candidates.push({ host, port: 587, secure: false, user, pass, label: "gmail-587-starttls" });
  // Gmail SSL fallback
  candidates.push({ host, port: 465, secure: true, user, pass, label: "gmail-465-ssl" });

  // Deduplicate if env config matches fallback candidate
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.host}:${c.port}:${c.secure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const smtpEmail = (process.env.SMTP_EMAIL || "").trim();
  const smtpPass = (process.env.SMTP_PASSWORD || "").replace(/\s/g, "");

  if (!smtpEmail || !smtpPass) {
    console.error("CRITICAL: SMTP credentials missing in server environment variables.");
    throw new Error("SMTP credentials missing");
  }
  
  const candidates = getTransportCandidates();
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const mailer = getTransporter(candidate);
      await mailer.verify();
      await mailer.sendMail({
        from: `"YourTube" <${smtpEmail}>`,
        to,
        subject,
        text,
        html,
      });
      console.log(`SUCCESS: OTP Email sent to ${to} via ${candidate.label}`);
      return;
    } catch (err) {
      lastError = err;
      console.error(`SMTP attempt failed via ${candidate.label}`);
    }
  }

  console.error("FATAL: NodeMailer failed for all SMTP transport candidates.", lastError);
  throw lastError || new Error("Unable to send email");
};
