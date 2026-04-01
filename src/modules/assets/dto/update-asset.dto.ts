import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateAssetDto } from './create-asset.dto';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @ApiPropertyOptional({ enum: AssetStatus, example: AssetStatus.AVAILABLE })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
