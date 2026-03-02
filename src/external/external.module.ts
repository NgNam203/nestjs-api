import { Module } from '@nestjs/common';
import { ExternalMockClient } from './external-mock.client';
@Module({
  providers: [ExternalMockClient],
  exports: [ExternalMockClient],
})
export class ExternalModule {}
