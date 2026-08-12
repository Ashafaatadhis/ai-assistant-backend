import { HttpStatus } from '@nestjs/common';

export const AuthErrorCodes = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

/**
 * Business exception carrying a machine-readable code, an Indonesian
 * human-readable message, and an HTTP status. AllExceptionsFilter
 * serializes it into the contract envelope.
 */
export class AppException extends Error {
  constructor(
    readonly code: string,
    readonly humanMessage: string,
    readonly httpStatus: number = HttpStatus.BAD_REQUEST,
  ) {
    super(humanMessage);
    this.name = 'AppException';
  }
}
