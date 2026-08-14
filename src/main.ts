import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1"
  })

  const config = new DocumentBuilder()
    .setTitle('Aria Backend API')
    .setDescription(
      'API untuk aplikasi Aria AI assistant. Semua response memakai envelope { success, message, data, error? } — lihat docs/2026-08-12-backend-auth-api-contract.md.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Aria backend listening on http://localhost:${port}/api/v1`);
  console.log(`Swagger UI: http://localhost:${port}/api/v1/docs`);
}

void bootstrap();
