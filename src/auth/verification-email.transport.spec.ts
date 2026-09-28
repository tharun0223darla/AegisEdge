import { ServiceUnavailableException } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { VerificationEmailTransport } from './verification-email.transport';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('VerificationEmailTransport SMTP provider', () => {
  const originalEnv = process.env;
  const sendMail = jest.fn<
    Promise<SMTPPool.SentMessageInfo>,
    [SMTPPool.Options]
  >();
  const createTransportMock = jest.mocked(createTransport);

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.com',
      EMAIL_VERIFICATION_ENABLED: 'true',
      EMAIL_VERIFICATION_PROVIDER: 'smtp',
      EMAIL_FROM_ADDRESS: 'sender@example.com',
      EMAIL_FROM_NAME: 'MediTrack AI',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'sender@example.com',
      SMTP_PASSWORD: 'app-password-value',
    };
    sendMail.mockReset();
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail } as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('sends the single-use verification link through authenticated SMTP', async () => {
    sendMail.mockResolvedValue(
      smtpResult('smtp-message-1', ['patient@example.com']),
    );
    const transport = new VerificationEmailTransport();

    const result = await transport.send({
      email: 'patient@example.com',
      token: 'single-use-token',
      careInvitationToken: 'care-token',
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        requireTLS: false,
        auth: {
          user: 'sender@example.com',
          pass: 'app-password-value',
        },
      }),
    );
    const sentMessage = sendMail.mock.calls[0]?.[0];
    expect(sentMessage).toMatchObject({
      from: { name: 'MediTrack AI', address: 'sender@example.com' },
      to: 'patient@example.com',
      subject: 'Verify your MediTrack email',
    });
    expect(sentMessage?.text).toContain(
      'https://app.example.com/verify-email#token=single-use-token',
    );
    expect(sentMessage?.html).toContain('careInvite=care-token');
    expect(result).toEqual({
      provider: 'smtp',
      messageId: 'smtp-message-1',
    });
  });

  it('fails closed when required SMTP credentials are missing', () => {
    delete process.env.SMTP_PASSWORD;
    const transport = new VerificationEmailTransport();

    expect(() => transport.assertReady()).toThrow(ServiceUnavailableException);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('treats an unaccepted SMTP recipient as a delivery failure', async () => {
    sendMail.mockResolvedValue(
      smtpResult('smtp-message-2', [], ['patient@example.com']),
    );
    const transport = new VerificationEmailTransport();

    await expect(
      transport.send({
        email: 'patient@example.com',
        token: 'single-use-token',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function smtpResult(
  messageId: string,
  accepted: string[],
  rejected: string[] = [],
): SMTPPool.SentMessageInfo {
  return {
    envelope: { from: 'sender@example.com', to: accepted },
    messageId,
    accepted,
    rejected,
    response: '250 accepted',
    envelopeTime: 1,
    messageTime: 1,
    messageSize: 1,
  };
}
