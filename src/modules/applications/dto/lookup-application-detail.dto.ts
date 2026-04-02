import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class LookupApplicationDetailDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  applicationId!: string;

  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
