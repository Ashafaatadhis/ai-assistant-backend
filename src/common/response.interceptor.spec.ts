import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { SuccessMessage } from './success-message.decorator';

describe('ResponseInterceptor', () => {
  const stubHandler = () => undefined;
  class StubController {}
  const ctx = {
    getHandler: () => stubHandler,
    getClass: () => StubController,
  } as unknown as ExecutionContext;
  const handler = (payload: unknown): CallHandler =>
    ({ handle: () => of(payload) }) as unknown as CallHandler;

  it('wraps a payload in the success envelope', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler({ id: 'x' })).subscribe((result) => {
      expect(result).toEqual({
        success: true,
        message: 'OK',
        data: { id: 'x' },
      });
      done();
    });
  });

  it('maps undefined handler output to data: null', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler(undefined)).subscribe((result) => {
      expect(result).toEqual({ success: true, message: 'OK', data: null });
      done();
    });
  });

  it('passes through an explicit null payload', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler(null)).subscribe((result) => {
      expect(result).toEqual({ success: true, message: 'OK', data: null });
      done();
    });
  });

  it('uses the @SuccessMessage override when set on the handler', (done) => {
    const decorated = SuccessMessage('Pesan khusus')(
      stubHandler as never,
    ) as unknown as () => undefined;
    const decoratedCtx = {
      getHandler: () => decorated,
      getClass: () => StubController,
    } as unknown as ExecutionContext;

    const interceptor = new ResponseInterceptor();
    interceptor
      .intercept(decoratedCtx, handler(null))
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          message: 'Pesan khusus',
          data: null,
        });
        done();
      });
  });
});
