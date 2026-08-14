import { HttpStatus } from '@nestjs/common';

export const AuthErrorCodes = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_CODE: 'INVALID_CODE',
  RESEND_TOO_SOON: 'RESEND_TOO_SOON',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  SELF_MANAGEMENT_FORBIDDEN: 'SELF_MANAGEMENT_FORBIDDEN',
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

/**
 * Business exception carrying a machine-readable code, an Indonesian
 * human-readable message, an HTTP status, and optional structured data.
 * AllExceptionsFilter serializes it into the contract envelope.
 */
export class AppException extends Error {
  constructor(
    readonly code: string,
    readonly humanMessage: string,
    readonly httpStatus: number = HttpStatus.BAD_REQUEST,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(humanMessage);
    this.name = 'AppException';
  }
}
