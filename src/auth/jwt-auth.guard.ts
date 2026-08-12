import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = { userId: string }>(
    err: unknown,
    user: TUser,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Silakan masuk terlebih dahulu');
    }
    return user;
  }
}
