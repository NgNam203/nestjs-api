import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContext } from '../logger/request-context';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const requestId = incoming ?? randomUUID();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    requestContext.run({ requestId }, () => next());
  }
}
