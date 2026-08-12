import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { AppException } from '../auth/auth.errors';

interface ErrorEnvelope {
  success: false;
  message: string;
  data: { details: string[] } | null;
  error: string;
}

const RATE_LIMIT_MESSAGE = 'Terlalu banyak permintaan, coba lagi nanti';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      this.logger.warn(`${exception.httpStatus} ${exception.humanMessage}`);
      const body: ErrorEnvelope = {
        success: false,
        message: exception.humanMessage,
        data: null,
        error: exception.code,
      };
      response.status(exception.httpStatus).json(body);
      return;
    }

    const { status, message, details } = this.parse(exception);

    this.logger.warn(
      `${status} ${message}${details ? ` — ${details.join('; ')}` : ''}`,
    );

    const body: ErrorEnvelope = {
      success: false,
      message,
      data: details ? { details } : null,
      error: this.toErrorCode(status),
    };
    response.status(status).json(body);
  }

  private parse(exception: unknown): {
    status: number;
    message: string;
    details?: string[];
  } {
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: RATE_LIMIT_MESSAGE,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { status, message: res };
      }
      const body = res as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        return {
          status,
          message: 'Periksa kembali isian kamu',
          details: body.message,
        };
      }
      if (typeof body.message === 'string') {
        return { status, message: body.message };
      }
      return { status, message: exception.message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Terjadi kesalahan tak terduga',
    };
  }

  private toErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
      case HttpStatus.FORBIDDEN:
        return 'UNAUTHORIZED';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
