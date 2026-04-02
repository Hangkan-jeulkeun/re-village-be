import { registerAs } from '@nestjs/config';

export default registerAs('sms', () => ({
  solapiBaseUrl: process.env.SOLAPI_BASE_URL ?? 'https://api.solapi.com',
  solapiApiKey: process.env.SOLAPI_API_KEY ?? '',
  solapiApiSecret: process.env.SOLAPI_API_SECRET ?? '',
  solapiSender: process.env.SOLAPI_SENDER ?? '',
  timeoutMs: Number(process.env.SMS_API_TIMEOUT_MS ?? 5000),
}));
