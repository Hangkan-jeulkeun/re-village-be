import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class RequestVerificationDto {
  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(1, 50)
  name!: string;

  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;
}
