import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import type { Request, Response } from 'express';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/Httpexception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { getCorsConfig } from './common/config/cors.config';
import { OriginGuard } from './common/guards/origin.guard';

function privateUploadResponder(message: string) {
  return (_req: Request, res: Response) => {
    res.status(404).json({ message });
  };
}
class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}


async function bootstrap() {
  // ─────────────────────────────────────────────────────────
  // Startup Validation: FRONTEND_URL
  // ─────────────────────────────────────────────────────────
  if (!process.env.FRONTEND_URL) {
    throw new ConfigError('FRONTEND_URL environment variable is required but missing.');
  }

  // Buffer logs until the Pino logger is wired so nothing is lost.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // ─────────────────────────────────────────────────────────
  // Structured logging (Pino) — replaces the default Nest logger
  // ─────────────────────────────────────────────────────────
  app.useLogger(app.get(PinoLogger));

  const logger = new Logger('Bootstrap');


  // ─────────────────────────────────────────────────────────
  // Reverse-proxy awareness (required for correct client IPs
  // behind Nginx / Cloudflare / load balancers)
  // ─────────────────────────────────────────────────────────
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (trustProxy > 0) {
    app.set('trust proxy', trustProxy);
  }

  // ─────────────────────────────────────────────────────────
  // Security headers (Helmet) + gzip
  // ─────────────────────────────────────────────────────────
  app.use(
    helmet({
      // Swagger UI ships inline scripts/styles, so relax CSP only there
      // by disabling it globally. If you serve a web app from this origin,
      // configure a stricter policy here.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());

  // ─────────────────────────────────────────────────────────
  // Global API Prefix (health endpoints excluded so k8s probes
  // can hit /health directly without the /api prefix).
  // ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: 0 as any },
      { path: 'health/(.*)', method: 0 as any },
    ],
  });

  // ─────────────────────────────────────────────────────────
  // CORS Configuration
  // ─────────────────────────────────────────────────────────
  app.enableCors(getCorsConfig());
  const allowedOrigins = process.env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean);
  allowedOrigins.forEach((origin) => {
    logger.log(`✓ CORS enabled: ${origin}`);
  });

  // Global Origin Protection Guard
  app.useGlobalGuards(new OriginGuard());


  // ─────────────────────────────────────────────────────────
  // Global Validation
  // ─────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ─────────────────────────────────────────────────────────
  // Global Exception Filter + Response Interceptor
  // ─────────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // ─────────────────────────────────────────────────────────
  // Static uploads
  // Example: http://localhost:3000/uploads/prescriptions/abc.jpg
  // ─────────────────────────────────────────────────────────
  app.use(
    '/uploads/prescriptions',
    privateUploadResponder(
      'Prescription files are private. Use the authenticated prescription file endpoint.',
    ),
  );
  app.use(
    '/uploads/bills',
    privateUploadResponder(
      'Bill files are private. Use the authenticated bill file endpoint.',
    ),
  );
  app.use(
    '/uploads/package-images',
    privateUploadResponder(
      'Package images are private. Use the authenticated package image endpoint.',
    ),
  );

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    maxAge: '1h',
    setHeaders: (res) => {
      // Files are private medical artefacts — don't let intermediaries cache.
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // ─────────────────────────────────────────────────────────
  // Swagger (disabled in production unless explicitly enabled)
  // ─────────────────────────────────────────────────────────
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MediTrack AI API')
      .setDescription(
        'Medication reminder, OCR prescription scanning, refill tracking, and adherence monitoring backend',
      )
      .setVersion('2.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT access token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ─────────────────────────────────────────────────────────
  // Graceful shutdown — flush in-flight requests + close DB
  // ─────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ─────────────────────────────────────────────────────────
  // Start Server
  // ─────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const url = await app.getUrl();
  logger.log(`🚀  Server         : ${url}`);
  if (swaggerEnabled) logger.log(`📚  Swagger        : ${url}/docs`);
  logger.log(`📂  Uploads        : ${url}/uploads`);
  logger.log(`❤️   Health         : ${url}/health`);
  logger.log(`🌍  Environment    : ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('💥 Fatal bootstrap error:', err);
  process.exit(1);
});
