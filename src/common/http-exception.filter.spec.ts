import {
  ArgumentsHost,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';
import { AppException } from '../auth/auth.errors';

describe('AllExceptionsFilter', () => {
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost;
  });

  it('maps validation errors (message array) to VALIDATION_ERROR with details', () => {
    new AllExceptionsFilter().catch(
      new BadRequestException(['email harus alamat email yang valid']),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Periksa kembali isian kamu',
      data: { details: ['email harus alamat email yang valid'] },
      error: 'VALIDATION_ERROR',
    });
  });

  it('maps plain HttpException message string through, with code by status', () => {
    new AllExceptionsFilter().catch(
      new UnauthorizedException('Silakan masuk terlebih dahulu'),
      host,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Silakan masuk terlebih dahulu',
      data: null,
      error: 'UNAUTHORIZED',
    });
  });

  it('keeps AppException code and human message intact', () => {
    new AllExceptionsFilter().catch(
      new AppException('EMAIL_TAKEN', 'Email sudah terdaftar', 409),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Email sudah terdaftar',
      data: null,
      error: 'EMAIL_TAKEN',
    });
  });

  it('maps unknown exceptions to 500 INTERNAL_ERROR', () => {
    new AllExceptionsFilter().catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Terjadi kesalahan tak terduga',
      data: null,
      error: 'INTERNAL_ERROR',
    });
  });
});
