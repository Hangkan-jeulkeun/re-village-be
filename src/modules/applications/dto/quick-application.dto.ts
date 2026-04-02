import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ApplicationDocumentType {
  PROPERTY_REGISTER = 'PROPERTY_REGISTER',
  BUILDING_REGISTER = 'BUILDING_REGISTER',
  LAND_REGISTER = 'LAND_REGISTER',
  FAMILY_RELATION_CERTIFICATE = 'FAMILY_RELATION_CERTIFICATE',
  OTHER = 'OTHER',
}

export class ApplicationDocumentInputDto {
  @ApiProperty({ example: 'https://cdn.example.com/docs/registry.pdf' })
  @IsUrl()
  fileUrl!: string;

  @ApiPropertyOptional({
    enum: ApplicationDocumentType,
    example: ApplicationDocumentType.PROPERTY_REGISTER,
  })
  @IsOptional()
  @IsEnum(ApplicationDocumentType)
  type?: ApplicationDocumentType;
}

export class QuickApplicationDto {
  @ApiPropertyOptional({ example: '홍길동', description: '신규 필드 (권장)' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @ApiPropertyOptional({ example: '홍길동', description: '하위 호환 필드' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  applicantName?: string;

  @ApiProperty({ example: '010-1234-5678', description: '하이픈 포함 입력 허용' })
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone!: string;

  @ApiPropertyOptional({ example: 'owner@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: AssetType, example: AssetType.EMPTY_HOUSE })
  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @ApiPropertyOptional({ enum: AssetType, example: AssetType.EMPTY_HOUSE })
  @IsOptional()
  @IsEnum(AssetType)
  detectedAssetType?: AssetType;

  @ApiPropertyOptional({ example: '제주특별자치도 제주시 한림읍 ...' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @ApiPropertyOptional({ example: '제주특별자치도 제주시 한림읍 ...' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  detectedAddress?: string;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  areaSqm?: number;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  detectedAreaSqm?: number;

  @ApiPropertyOptional({ example: 33.4996 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 126.5312 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/building-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/registry.pdf'],
    description: '레거시 문서 URL 리스트',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  documentUrls?: string[];

  @ApiPropertyOptional({
    type: [ApplicationDocumentInputDto],
    description: '문서 유형 포함 문서 리스트',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApplicationDocumentInputDto)
  documentFiles?: ApplicationDocumentInputDto[];

  @ApiPropertyOptional({ example: '건물 관련 추가 설명' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    deprecated: true,
    description:
      '더 이상 사용하지 않습니다. 신청 시 빈집 자산은 항상 신규 생성됩니다.',
  })
  @IsOptional()
  @IsUUID(4)
  assetId?: string;

  @ApiPropertyOptional({ example: '2026-05-01', type: String, format: 'date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desiredStartDate?: Date;
}
