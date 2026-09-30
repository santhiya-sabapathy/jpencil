import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface MysqlDriverError extends Error {
  code?: string;
  errno?: number;
}

/**
 * Translates database errors that can legitimately be caused by a client
 * (e.g. a unique-key race between two concurrent registrations) into proper
 * HTTP responses instead of a generic 500. Anything else is logged and
 * reported as an internal error without leaking SQL details.
 */
@Catch(QueryFailedError)
export class QueryFailedFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedFilter.name);

  catch(exception: QueryFailedError<MysqlDriverError>, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code = exception.driverError?.code;

    switch (code) {
      case 'ER_DUP_ENTRY':
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource already exists',
          error: 'Conflict',
        });
      case 'ER_ROW_IS_REFERENCED_2':
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource is referenced by other records',
          error: 'Conflict',
        });
      case 'ER_LOCK_DEADLOCK':
      case 'ER_LOCK_WAIT_TIMEOUT':
        return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'The resource is busy, please retry',
          error: 'Service Unavailable',
        });
      default:
        this.logger.error(exception.message, exception.stack);
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        });
    }
  }
}
