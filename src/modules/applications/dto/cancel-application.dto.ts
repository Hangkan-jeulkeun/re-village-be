import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CancelApplicationDto {
  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
