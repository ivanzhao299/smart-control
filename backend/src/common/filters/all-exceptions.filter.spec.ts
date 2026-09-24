import { ArgumentsHost, BadRequestException, ConflictException } from '@nestjs/common';
import { Logger } from 'winston';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter stable error contract', () => {
  function fixture() {
    const response = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const logger = { error: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'PUT', url: '/api/video-binding/layout' }),
      }),
    };
    return {
      filter: new AllExceptionsFilter(logger as unknown as Logger),
      response,
      logger,
      host: host as unknown as ArgumentsHost,
    };
  }

  it('preserves stable codes and reviewed revision fields', () => {
    const { filter, response, host } = fixture();

    filter.catch(
      new ConflictException({
        code: 'VIDEO_BINDING_REVISION_CONFLICT',
        message: '配置已被更新',
        expectedRevision: 3,
        currentRevision: 4,
        secret: 'must-not-leak',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: '配置已被更新',
      code: 'VIDEO_BINDING_REVISION_CONFLICT',
      expectedRevision: 3,
      currentRevision: 4,
    });
  });

  it('keeps validation messages while rejecting arbitrary metadata', () => {
    const { filter, response, host } = fixture();

    filter.catch(
      new BadRequestException({
        message: ['name must be a string', 'name should not be empty'],
        code: 'lowercase-is-not-a-stable-code',
        token: 'must-not-leak',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'name must be a string; name should not be empty',
    });
  });
});
