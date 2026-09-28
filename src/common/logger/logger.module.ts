import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Centralised structured-logging module powered by Pino.
 *
 * Production:
 *   - JSON logs (single-line, machine-parseable for ELK / Loki / Datadog).
 *   - Request ID propagated via `x-request-id` header.
 *   - PII redaction for auth headers, cookies and password fields.
 *
 * Development:
 *   - Pretty-printed colourised output via pino-pretty.
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        genReqId: (req: IncomingMessage) => {
          const headerId = req.headers['x-request-id'];
          if (typeof headerId === 'string' && headerId.length > 0) return headerId;
          return randomUUID();
        },
        customProps: () => ({
          service: 'meditrack-api',
          env: process.env.NODE_ENV ?? 'development',
        }),
        serializers: {
          req(req) {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              remoteAddress: req.remoteAddress,
            };
          },
          res(res) {
            return { statusCode: res.statusCode };
          },
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.refreshToken',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (res.statusCode >= 300) return 'silent';
          return 'info';
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,service,env,req.remoteAddress',
                },
              },
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
