import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class PushTokenDto {
  @ApiProperty({ example: 'fcm-token-value' })
  @IsString()
  @Length(10, 500)
  token!: string;

  @ApiProperty({ example: 'ios' })
  @IsString()
  @Length(2, 30)
  platform!: string;
}
