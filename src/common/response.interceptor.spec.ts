import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const ctx = {} as ExecutionContext;
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
});
