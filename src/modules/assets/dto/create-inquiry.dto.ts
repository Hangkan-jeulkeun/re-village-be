import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CreateInquiryDto {
  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(1, 50)
  name!: string;

  @ApiProperty({ example: '010-1234-5678' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;

  @ApiPropertyOptional({ example: 'owner@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '게스트하우스 운영' })
  @IsString()
  @Length(1, 120)
  purpose!: string;

  @ApiPropertyOptional({ example: '가족' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  householdType?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  headCount?: number;

  @ApiPropertyOptional({ example: '현장 확인 가능한 날짜를 안내 부탁드립니다.' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  message?: string;
}
