import { Injectable, ParseUUIDPipe } from '@nestjs/common';

@Injectable()
export class ParseUuidPipe extends ParseUUIDPipe {
  constructor() {
    super({ version: '4' });
  }
}
