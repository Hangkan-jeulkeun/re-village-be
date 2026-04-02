import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UploadPublicFileDto {
  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(1, 50)
  name!: string;

  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;

  @ApiPropertyOptional({ example: 'APPLICATION_PHOTO' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  refType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  refId?: string;
}
