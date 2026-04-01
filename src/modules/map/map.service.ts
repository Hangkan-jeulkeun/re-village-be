import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface NearbyAsset {
  id: string;
  owner_id: string;
  title: string;
  asset_type: string;
  status: string;
  description: string | null;
  address: string;
  region_code: string;
  latitude: number | null;
  longitude: number | null;
  area_sqm: number | null;
  desired_rent: number | null;
  created_at: Date;
  updated_at: Date;
  distance_m: number;
}

@Injectable()
export class MapService {
  constructor(private readonly prisma: PrismaService) {}

  findNearby(lat: number, lng: number, radiusKm: number) {
    return this.prisma.$queryRaw<NearbyAsset[]>(Prisma.sql`
      SELECT
        a.*,
        ST_Distance(
          ST_MakePoint(a.longitude, a.latitude)::geography,
          ST_MakePoint(${lng}, ${lat})::geography
        ) AS distance_m
      FROM assets a
      WHERE
        a.latitude IS NOT NULL
        AND a.longitude IS NOT NULL
        AND ST_DWithin(
          ST_MakePoint(a.longitude, a.latitude)::geography,
          ST_MakePoint(${lng}, ${lat})::geography,
          ${radiusKm} * 1000
        )
      ORDER BY distance_m ASC;
    `);
  }
}
