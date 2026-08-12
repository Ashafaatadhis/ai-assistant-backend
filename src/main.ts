import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, stopAtFirstError: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Aria Backend API')
    .setDescription(
      'API untuk aplikasi Aria AI assistant. Semua response memakai envelope { success, message, data, error? } — lihat docs/2026-08-12-backend-auth-api-contract.md.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Aria backend listening on http://localhost:${port}/api`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

void bootstrap();
