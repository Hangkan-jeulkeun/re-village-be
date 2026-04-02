import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsBoolean,
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
  private static toBoolean(value: unknown): boolean | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', '있음', '가능'].includes(lower)) return true;
      if (['false', '0', 'no', 'n', '없음', '불가'].includes(lower)) return false;
    }
    return undefined;
  }

  private static toStringArray(value: unknown): string[] | undefined {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    }
    return undefined;
  }

  private static toDocumentArray(
    value: unknown,
  ): ApplicationDocumentInputDto[] | undefined {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) return value as ApplicationDocumentInputDto[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed as ApplicationDocumentInputDto[];
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

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

  @ApiPropertyOptional({
    example: '010-1234-5678',
    description: '더 이상 필수 아님 (액세스 토큰 기반 신청)',
  })
  @IsOptional()
  @Matches(/^[+0-9][0-9-]{7,19}$/)
  phone?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: '더 이상 필수 아님 (액세스 토큰 기반 신청)',
  })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  verificationCode?: string;

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

  @ApiPropertyOptional({ example: 1, description: '층수(단층=1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  floorCount?: number;

  @ApiPropertyOptional({ example: true, description: '마당 유무' })
  @IsOptional()
  @Transform(({ value }) => QuickApplicationDto.toBoolean(value))
  @IsBoolean()
  hasYard?: boolean;

  @ApiPropertyOptional({ example: true, description: '주차 가능 여부' })
  @IsOptional()
  @Transform(({ value }) => QuickApplicationDto.toBoolean(value))
  @IsBoolean()
  hasParking?: boolean;

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
  @Transform(({ value }) => QuickApplicationDto.toStringArray(value))
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
  @Transform(({ value }) => QuickApplicationDto.toStringArray(value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  documentUrls?: string[];

  @ApiPropertyOptional({
    type: [ApplicationDocumentInputDto],
    description: '문서 유형 포함 문서 리스트',
  })
  @IsOptional()
  @Transform(({ value }) => QuickApplicationDto.toDocumentArray(value))
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
