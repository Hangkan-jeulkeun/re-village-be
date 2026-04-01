import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsString, IsUUID, Length } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  assetId!: string;

  @ApiProperty({ example: '지역 농산물 기반 카페 운영' })
  @IsString()
  @Length(10, 2000)
  businessIdea!: string;

  @ApiProperty({ example: '카페/식음료' })
  @IsString()
  @Length(2, 100)
  businessType!: string;

  @ApiProperty({ example: '2026-05-01', type: String, format: 'date' })
  @Type(() => Date)
  @IsDate()
  desiredStartDate!: Date;
}
