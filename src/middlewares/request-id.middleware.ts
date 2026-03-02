import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const requestId = incoming ?? randomUUID();

    // gắn vào req để tầng sau dùng
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (req as any).requestId = requestId;

    // gắn vào response header để client cũng thấy
    res.setHeader('x-request-id', requestId);

    next();
  }
}
