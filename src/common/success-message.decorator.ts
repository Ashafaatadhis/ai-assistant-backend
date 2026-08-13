import { SetMetadata } from '@nestjs/common';

export const SUCCESS_MESSAGE_KEY = 'success_message';

/**
 * Overrides the envelope's default "OK" success message for one route.
 * The ResponseInterceptor reads this metadata.
 */
export const SuccessMessage = (message: string) =>
  SetMetadata(SUCCESS_MESSAGE_KEY, message);
