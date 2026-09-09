import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

describe('RedisService connection logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps credentials out of logs while preserving lifecycle events and the client URL', () => {
    const url = 'rediss://test-user:test-password@redis.example:6380/2';
    const client = new EventEmitter();
    const redisMock = jest.mocked(Redis);
    redisMock.mockImplementation(() => client as unknown as Redis);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new RedisService(new ConfigService({ REDIS_URL: url }));

    expect(redisMock).toHaveBeenCalledWith(url, expect.any(Object));
    expect(service.getClient()).toBe(client);
    client.emit('connect');
    client.emit('ready');
    client.emit('end');
    client.emit(
      'error',
      Object.assign(new Error('connection failed'), {
        code: 'ECONNREFUSED',
      }),
    );

    expect(log).toHaveBeenCalledWith('redis_connect');
    expect(log).toHaveBeenCalledWith('redis_ready');
    expect(warn).toHaveBeenCalledWith('redis_end');
    expect(warn).toHaveBeenCalledWith('redis_error ECONNREFUSED');
    const output = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    for (const sensitive of [url, 'test-user', 'test-password']) {
      expect(output).not.toContain(sensitive);
    }
  });
});
