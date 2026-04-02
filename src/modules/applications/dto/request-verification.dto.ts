import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class RequestVerificationDto {
  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;
}
