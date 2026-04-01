import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as
        | string
        | { message?: string | string[]; code?: string };

      const message = this.resolveMessage(exceptionResponse, exception.message);
      const code =
        (typeof exceptionResponse === 'object' && exceptionResponse.code) ||
        HttpStatus[status] ||
        'ERROR';

      response.status(status).json({
        success: false,
        error: {
          statusCode: status,
          code,
          message,
          path: request.url,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: '서버 내부 오류가 발생했습니다.',
        path: request.url,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private resolveMessage(
    exceptionResponse: string | { message?: string | string[]; code?: string },
    fallback: string,
  ): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    const maybeMessage = exceptionResponse.message;
    if (Array.isArray(maybeMessage)) {
      return maybeMessage.join(', ');
    }

    return maybeMessage ?? fallback;
  }
}
