import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUrl } from 'class-validator';

export class ExtractDocumentsDto {
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

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/docs/registry.pdf'],
    description: 'PDF 문서 URL 목록',
  })
  @IsOptional()
  @Transform(({ value }) => ExtractDocumentsDto.toStringArray(value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  documentUrls?: string[];
}
