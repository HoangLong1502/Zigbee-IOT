import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig, AuthConfig } from './config/configuration';

/**
 * Application bootstrap.
 *
 * Starts the NestJS HTTP server, mounts Swagger and wires the Socket.IO
 * gateway (via the WebsocketModule). After this returns, the MQTT ingestion
 * pipeline begins consuming Zigbee2MQTT traffic.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  const authConfig = config.getOrThrow<AuthConfig>('auth');

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: appConfig.corsOrigin === '*' ? true : appConfig.corsOrigin.split(','),
    credentials: true,
  });

  // Reject anything that does not match the DTO - keeps bad MQTT command
  // payloads and malformed UI requests out of the service layer.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Zigbee IoT Monitoring Platform')
    .setDescription(
      [
        'REST API for the Zigbee monitoring platform.',
        '',
        'Data flow: Zigbee Devices → USB Coordinator → Zigbee2MQTT → Mosquitto',
        '→ NestJS MQTT Service → PostgreSQL + Socket.IO → React Dashboard.',
        '',
        'All sensor properties are discovered dynamically from Zigbee2MQTT',
        'exposes - nothing is hardcoded.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Dashboard')
    .addTag('Devices')
    .addTag('Telemetry')
    .addTag('History')
    .addTag('Topology')
    .addTag('Coordinator')
    .addTag('MQTT')
    .addTag('Alerts')
    .addTag('Events')
    .addTag('OTA')
    .addTag('Settings')
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(appConfig.port);

  const logger = new Logger('Bootstrap');
  logger.log(`HTTP listening on http://localhost:${appConfig.port}`);
  logger.log(`Swagger docs at http://localhost:${appConfig.port}/api/docs`);
  logger.log(
    authConfig.enabled
      ? 'JWT authentication is ENABLED'
      : 'JWT authentication is DISABLED (AUTH_ENABLED=false)',
  );
}

bootstrap().catch((error: Error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start the backend:', error);
  process.exit(1);
});
