import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class RequestVerificationDto {
  @ApiProperty({ example: '+821012341234' })
  @Matches(/^\+?\d{9,15}$/)
  phone!: string;
}
