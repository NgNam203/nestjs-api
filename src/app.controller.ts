import { Controller, Get, HttpCode } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
  @Get('/boom')
  boom() {
    throw new Error('boom');
  }

  @Get('favicon.ico')
  @HttpCode(204)
  favicon() {
    return;
  }
}
