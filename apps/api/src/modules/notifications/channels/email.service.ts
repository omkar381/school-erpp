import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { renderEmailTemplate, type EmailTemplateName } from '../templates/email-templates';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  template?: EmailTemplateName;
  data?: Record<string, unknown>;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter: Transporter | null = null;
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('EmailService');
  }

  onModuleInit(): void {
    if (!this.config.get<boolean>('mail.enabled')) {
      this.log.warn('Email delivery is disabled; messages will be logged instead of sent');
      return;
    }

    const host = this.config.get<string>('mail.host');
    const port = this.config.get<number>('mail.port', 587);
    const user = this.config.get<string>('mail.user');
    const password = this.config.get<string>('mail.password');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: this.config.get<boolean>('mail.secure', false),
      ...(user ? { auth: { user, pass: password } } : {}),
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    this.log.info('SMTP transport configured', { host, port });
  }

  async send(input: SendEmailInput): Promise<EmailResult> {
    const recipients = Array.isArray(input.to) ? input.to : [input.to];
    const valid = recipients.filter((address) => this.isValidAddress(address));

    if (valid.length === 0) {
      this.log.warn('Email skipped: no valid recipient address');
      return { success: false, error: 'No valid recipient' };
    }

    const html =
      input.html ??
      (input.template
        ? renderEmailTemplate(input.template, {
            ...input.data,
            appName: this.config.get<string>('app.appName'),
            webUrl: this.config.get<string>('app.webUrl'),
            year: new Date().getFullYear(),
          })
        : undefined);

    const from = `"${this.config.get<string>('mail.fromName')}" <${this.config.get<string>('mail.fromAddress')}>`;

    if (!this.transporter) {
      this.log.info('Email (delivery disabled)', {
        to: valid,
        subject: input.subject,
        template: input.template,
      });
      return { success: true, messageId: 'logged' };
    }

    try {
      const result = await this.transporter.sendMail({
        from,
        to: valid.join(', '),
        cc: input.cc?.join(', '),
        bcc: input.bcc?.join(', '),
        replyTo: input.replyTo,
        subject: input.subject,
        html,
        text: input.text ?? (html ? this.htmlToText(html) : undefined),
        attachments: input.attachments,
      });

      this.log.debug('Email sent', { to: valid, subject: input.subject, messageId: result.messageId });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      this.log.error('Email delivery failed', error, { to: valid, subject: input.subject });
      return { success: false, error: (error as Error).message };
    }
  }

  /** Sends the same message to many recipients in bounded-size batches. */
  async sendBulk(
    recipients: string[],
    subject: string,
    template: EmailTemplateName,
    data: Record<string, unknown>,
    batchSize = 50,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      // Individual recipients go in bcc so addresses are not disclosed.
      const result = await this.send({
        to: this.config.get<string>('mail.fromAddress')!,
        bcc: batch,
        subject,
        template,
        data,
      });
      if (result.success) sent += batch.length;
      else failed += batch.length;
    }

    return { sent, failed };
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.log.error('SMTP verification failed', error);
      return false;
    }
  }

  private isValidAddress(address: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address.trim());
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
