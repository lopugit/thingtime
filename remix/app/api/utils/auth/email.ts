// Pluggable email transport.
//
// For now this logs to the server console (dev stub) and the verification link
// is also surfaced in the API response in dev. To send real email later, wire a
// provider HERE (Resend / SMTP) behind an env check — callers never change.
type SendArgs = { to: string; subject: string; html: string; text: string };

const sendEmail = async (args: SendArgs): Promise<{ delivered: boolean; via: string }> => {
  // TODO: if (process.env.RESEND_API_KEY) { ...send via Resend, return delivered:true... }
  // TODO: else if (process.env.SMTP_HOST) { ...send via Nodemailer... }
  console.log(`[auth][email] (dev stub) → ${args.to}\n  subject: ${args.subject}\n  ${args.text}`);
  return { delivered: false, via: 'console' };
};

export const sendVerificationEmail = async ({ to, link }: { to: string; link: string }) => {
  const subject = 'Verify your Thingtime email 🌈';
  const text = `Welcome to Thingtime! 🦄 Verify your email: ${link}`;
  const html = `<p>Welcome to Thingtime! 🦄</p><p><a href="${link}">Verify your email →</a></p>`;
  return sendEmail({ to, subject, html, text });
};
