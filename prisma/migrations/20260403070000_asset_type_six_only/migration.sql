BEGIN;

-- 1) Legacy 값을 6종 표준 타입으로 먼저 정규화
UPDATE "assets"
SET "asset_type" = CASE
  WHEN "asset_type"::text = 'EMPTY_HOUSE' THEN 'NO_STONE_WALL_HOUSE'
  WHEN "asset_type"::text = 'WAREHOUSE' THEN 'URBAN_HOUSE_VILLA'
  WHEN "asset_type"::text = 'FIELD' THEN 'STONE_WALL_FIELD_HOUSE'
  WHEN "asset_type"::text = 'OTHER' THEN 'NO_STONE_WALL_HOUSE'
  ELSE "asset_type"::text
END::"AssetType"
WHERE "asset_type"::text IN ('EMPTY_HOUSE', 'WAREHOUSE', 'FIELD', 'OTHER');

-- 2) Enum 타입을 6종만 남기도록 재생성
ALTER TYPE "AssetType" RENAME TO "AssetType_old";

CREATE TYPE "AssetType" AS ENUM (
  'STONE_WALL_FIELD_HOUSE',
  'STONE_WALL_HOUSE',
  'DEMOLITION_HOUSE',
  'NO_STONE_WALL_HOUSE',
  'D_SHAPED_HOUSE',
  'URBAN_HOUSE_VILLA'
);

ALTER TABLE "assets"
ALTER COLUMN "asset_type" TYPE "AssetType"
USING (
  CASE
    WHEN "asset_type"::text = 'EMPTY_HOUSE' THEN 'NO_STONE_WALL_HOUSE'
    WHEN "asset_type"::text = 'WAREHOUSE' THEN 'URBAN_HOUSE_VILLA'
    WHEN "asset_type"::text = 'FIELD' THEN 'STONE_WALL_FIELD_HOUSE'
    WHEN "asset_type"::text = 'OTHER' THEN 'NO_STONE_WALL_HOUSE'
    ELSE "asset_type"::text
  END
)::"AssetType";

DROP TYPE "AssetType_old";

COMMIT;
