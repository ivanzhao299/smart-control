import { SetMetadata } from '@nestjs/common';
export const READ_ONLY_REQUEST = 'read-only-request';
/** Explicit exception for authenticated POSTs that only grant already-authorized reads. */
export const ReadOnlyRequest = () => SetMetadata(READ_ONLY_REQUEST, true);
