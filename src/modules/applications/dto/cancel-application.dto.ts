import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CancelApplicationDto {
  @ApiProperty({ example: '+821012341234' })
  @Matches(/^\+?\d{9,15}$/)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
