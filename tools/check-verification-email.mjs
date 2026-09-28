import process from 'node:process';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

const envFileArg = process.argv.find((value) =>
  value.startsWith('--env-file='),
);
const sendToArg = process.argv.find((value) => value.startsWith('--send-to='));
const envFile = envFileArg?.slice('--env-file='.length) || '.env';
const sendTo = sendToArg?.slice('--send-to='.length).trim();

dotenv.config({ path: envFile, quiet: true });

const provider = process.env.EMAIL_VERIFICATION_PROVIDER?.trim().toLowerCase();
const configuredSender = process.env.EMAIL_FROM_ADDRESS?.trim().toLowerCase();

if (!configuredSender) {
  fail(`Missing EMAIL_FROM_ADDRESS in ${envFile}.`);
}

if (provider === 'brevo') {
  await checkBrevo(configuredSender);
} else if (provider === 'smtp') {
  await checkSmtp(configuredSender);
} else {
  fail(
    'EMAIL_VERIFICATION_PROVIDER must be smtp or brevo for a real delivery check.',
  );
}

async function checkSmtp(sender) {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail('SMTP_HOST and a valid SMTP_PORT are required.');
  }
  if (!['true', 'false'].includes(secureValue ?? '')) {
    fail('SMTP_SECURE must be true or false.');
  }
  if (!user || !password) {
    fail('SMTP_USER and SMTP_PASSWORD are required.');
  }

  const secure = secureValue === 'true';
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });

  try {
    await transport.verify();
    console.log('SMTP email configuration passed.');
    console.log(`Server: ${host}:${port} (${secure ? 'TLS' : 'STARTTLS'})`);
    console.log(`Account: ${maskEmail(user)}`);
    console.log(`Sender: ${maskEmail(sender)}`);

    if (sendTo) {
      assertEmail(sendTo, '--send-to');
      const result = await transport.sendMail({
        from: {
          name: process.env.EMAIL_FROM_NAME?.trim() || 'MediTrack AI',
          address: sender,
        },
        to: sendTo,
        subject: 'MediTrack email configuration test',
        text: 'Your MediTrack verification email transport is configured correctly. This message does not verify or create an account.',
      });
      console.log(
        `Test email accepted for ${maskEmail(sendTo)} (${result.messageId || 'no message id'}).`,
      );
    } else {
      console.log(
        'No message was sent. Add --send-to=you@example.com to test inbox delivery.',
      );
    }
  } catch (error) {
    fail(
      `SMTP check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    transport.close();
  }
}

async function checkBrevo(sender) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    fail(`Missing BREVO_API_KEY in ${envFile}.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      signal: controller.signal,
      headers: { accept: 'application/json', 'api-key': apiKey },
    });
    const body = await readJson(response);
    if (!response.ok) {
      fail(
        `Brevo rejected the configuration check (${response.status}): ${safeMessage(body)}`,
      );
    }
    const senders = Array.isArray(body.senders) ? body.senders : [];
    const matched = senders.find(
      (candidate) =>
        typeof candidate?.email === 'string' &&
        candidate.email.trim().toLowerCase() === sender,
    );
    if (!matched) {
      fail(
        `Brevo API key is valid, but ${maskEmail(sender)} is not registered as a sender.`,
      );
    }
    if (matched.active !== true) {
      fail(`Brevo sender ${maskEmail(sender)} is not active/verified.`);
    }
    console.log('Brevo email configuration passed.');
    console.log(`Sender: ${maskEmail(sender)} (active)`);
    console.log(
      'Use Brevo Transactional > Logs to confirm delivery, blocking, or bounce status.',
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      fail('Brevo configuration check timed out after 10 seconds.');
    }
    fail(
      `Could not reach Brevo: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = (await response.text()).slice(0, 2_000);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeMessage(body) {
  return typeof body?.message === 'string'
    ? body.message.slice(0, 300)
    : 'unknown error';
}

function assertEmail(value, name) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail(`${name} must be a valid email address.`);
  }
}

function maskEmail(email) {
  const [local = '', domain = 'unknown'] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function fail(message) {
  console.error(`Email configuration failed: ${message}`);
  process.exit(1);
}
