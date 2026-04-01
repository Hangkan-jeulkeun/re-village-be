import { UserRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'youth@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', description: '8~64자 영문/숫자/특수문자 조합' })
  @IsString()
  @Length(8, 64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자를 포함해야 합니다.',
  })
  password!: string;

  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(1, 50)
  name!: string;

  @ApiPropertyOptional({ example: '010-1234-5678' })
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.YOUTH })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
