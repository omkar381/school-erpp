import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../../../common/logger/app-logger.service';

export interface SendSmsInput {
  to: string;
  message: string;
  /** Free-form tag used for delivery analytics, e.g. OTP_LOGIN, FEE_REMINDER. */
  purpose?: string;
  templateId?: string;
}

export interface SmsResult {
  success: boolean;
  providerId?: string;
  error?: string;
}

/**
 * SMS gateway abstraction.
 *
 * The `log` driver is the default and writes messages to the application log,
 * which keeps development and CI free of external dependencies. Swapping to a
 * real provider is an environment change, not a code change.
 */
@Injectable()
export class SmsService {
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('SmsService');
  }

  async send(input: SendSmsInput): Promise<SmsResult> {
    const to = this.normalize(input.to);
    if (!this.isValid(to)) {
      return { success: false, error: 'Invalid destination number' };
    }

    const driver = this.config.get<string>('sms.driver', 'log');

    switch (driver) {
      case 'msg91':
        return this.sendViaMsg91(to, input);
      case 'twilio':
        return this.sendViaTwilio(to, input);
      default:
        // Never log the message body for OTPs outside development.
        this.log.info('SMS (log driver)', {
          to: this.mask(to),
          purpose: input.purpose,
          ...(process.env.NODE_ENV === 'development' ? { message: input.message } : {}),
        });
        return { success: true, providerId: 'logged' };
    }
  }

  async sendBulk(
    recipients: string[],
    message: string,
    purpose?: string,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Sequential with a small batch window keeps within provider rate limits.
    for (let i = 0; i < recipients.length; i += 20) {
      const batch = recipients.slice(i, i + 20);
      const results = await Promise.all(
        batch.map((to) => this.send({ to, message, purpose })),
      );
      for (const result of results) {
        if (result.success) sent += 1;
        else failed += 1;
      }
    }

    return { sent, failed };
  }

  private async sendViaMsg91(to: string, input: SendSmsInput): Promise<SmsResult> {
    const authKey = this.config.get<string>('sms.msg91.authKey');
    const templateId = input.templateId ?? this.config.get<string>('sms.msg91.templateId');

    if (!authKey) {
      this.log.error('MSG91 driver selected but MSG91_AUTH_KEY is not configured');
      return { success: false, error: 'SMS provider not configured' };
    }

    try {
      const response = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: authKey },
        body: JSON.stringify({
          template_id: templateId,
          short_url: '0',
          recipients: [{ mobiles: to.replace('+', ''), MESSAGE: input.message }],
        }),
      });

      const body = (await response.json()) as { type?: string; message?: string };

      if (!response.ok || body.type === 'error') {
        this.log.error('MSG91 rejected the message', undefined, {
          to: this.mask(to),
          error: body.message,
        });
        return { success: false, error: body.message ?? 'Provider error' };
      }

      return { success: true, providerId: body.message };
    } catch (error) {
      this.log.error('MSG91 request failed', error, { to: this.mask(to) });
      return { success: false, error: (error as Error).message };
    }
  }

  private async sendViaTwilio(to: string, input: SendSmsInput): Promise<SmsResult> {
    const sid = this.config.get<string>('sms.twilio.accountSid');
    const token = this.config.get<string>('sms.twilio.authToken');
    const from = this.config.get<string>('sms.twilio.from');

    if (!sid || !token || !from) {
      this.log.error('Twilio driver selected but credentials are incomplete');
      return { success: false, error: 'SMS provider not configured' };
    }

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: from, Body: input.message }),
        },
      );

      const body = (await response.json()) as { sid?: string; message?: string };

      if (!response.ok) {
        this.log.error('Twilio rejected the message', undefined, {
          to: this.mask(to),
          error: body.message,
        });
        return { success: false, error: body.message ?? 'Provider error' };
      }

      return { success: true, providerId: body.sid };
    } catch (error) {
      this.log.error('Twilio request failed', error, { to: this.mask(to) });
      return { success: false, error: (error as Error).message };
    }
  }

  private normalize(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    // Assume the school's default country when no prefix is supplied.
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits.replace(/^0+/, '')}`;
  }

  private isValid(phone: string): boolean {
    return /^\+[1-9]\d{9,14}$/.test(phone);
  }

  private mask(phone: string): string {
    return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
  }
}
