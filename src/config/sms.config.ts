import { registerAs } from '@nestjs/config';

export default registerAs('sms', () => ({
  infobipBaseUrl: process.env.INFOBIP_BASE_URL ?? '',
  infobipApiKey: process.env.INFOBIP_API_KEY ?? '',
  infobipSender: process.env.INFOBIP_SENDER ?? 'ServiceSMS',
  timeoutMs: Number(process.env.SMS_API_TIMEOUT_MS ?? 5000),
}));
