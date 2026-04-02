import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const path = request.originalUrl ?? request.url;

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

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `${request.method} ${path} -> ${status} ${message}`,
          exception instanceof Error ? exception.stack : undefined,
        );
      }

      response.status(status).json({
        success: false,
        error: {
          statusCode: status,
          code,
          message,
          path,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.logger.error(
      `${request.method} ${path} -> 500 INTERNAL_SERVER_ERROR`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    const schemaMismatchMessage = this.resolveSchemaMismatchMessage(exception);
    if (schemaMismatchMessage) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        error: {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'SCHEMA_MISMATCH',
          message: schemaMismatchMessage,
          path,
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
        path,
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

  private resolveSchemaMismatchMessage(exception: unknown): string | null {
    if (!(exception instanceof Error)) {
      return null;
    }

    const message = exception.message.toLowerCase();

    if (
      message.includes("value 'empty_house' not found in enum 'assettype'") ||
      (message.includes('not found in enum') && message.includes('assettype'))
    ) {
      return 'DB AssetType enum과 서버 코드가 불일치합니다. 마이그레이션 적용 후 재배포가 필요합니다.';
    }

    if (message.includes('invalid input value for enum') && message.includes('assettype')) {
      return 'DB AssetType enum과 서버 코드가 불일치합니다. 마이그레이션 적용 후 재배포가 필요합니다.';
    }

    return null;
  }
}
