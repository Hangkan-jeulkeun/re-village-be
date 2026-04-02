import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  geminiBaseUrl: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com',
  gpsApiKey: process.env.GPS_API_KEY ?? '',
  gpsGeocodeUrl:
    process.env.GPS_GEOCODE_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json',
  gpsReverseGeocodeUrl:
    process.env.GPS_REVERSE_GEOCODE_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json',
}));
