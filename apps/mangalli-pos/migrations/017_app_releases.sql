-- Update aplikasi (permintaan owner 4 Okt 2026): rilis APK tablet dan catatan
-- perubahan dashboard. Tablet membaca rilis android terbaru dan menawarkan
-- update; di bawah min_version_code update wajib. Dashboard menampilkan
-- catatan rilis terbaru sekali per browser. Diisi tim 1garis Studio lewat
-- scripts/publish-release.ts.
CREATE TABLE IF NOT EXISTS app_releases (
  id bigserial PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('android', 'dashboard')),
  version_code integer NOT NULL,
  version_name text NOT NULL,
  notes text NOT NULL,
  apk_url text,
  apk_sha256 text,
  apk_size bigint,
  min_version_code integer,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, version_code)
);

-- Versi aplikasi tiap tablet, dari header X-Mangalli-App-Version saat sinkron.
ALTER TABLE android_pos_devices ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE android_pos_devices ADD COLUMN IF NOT EXISTS app_version_code integer;
