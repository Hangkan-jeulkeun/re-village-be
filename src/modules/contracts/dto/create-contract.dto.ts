import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsUUID, Min } from 'class-validator';

export class CreateContractDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  assetId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  ownerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(4)
  applicationId!: string;

  @ApiProperty({ example: '2026-06-01', type: String, format: 'date' })
  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @ApiProperty({ example: '2027-05-31', type: String, format: 'date' })
  @Type(() => Date)
  @IsDate()
  endDate!: Date;

  @ApiProperty({ example: 700000 })
  @IsInt()
  @Min(0)
  monthlyRent!: number;
}
