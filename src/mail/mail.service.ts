import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: Number(this.config.get('SMTP_PORT')),
        secure: Number(this.config.get('SMTP_PORT')) === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
    return this.transporter;
  }

  async sendVerificationCode(
    to: string,
    name: string,
    code: string,
  ): Promise<void> {
    const ttlMinutes = this.config.get('CODE_TTL_MINUTES') ?? '10';
    await this.getTransporter().sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to,
      subject: 'Kode verifikasi Aria',
      text: `Halo ${name},

Kode verifikasi kamu: ${code}

Kode berlaku ${ttlMinutes} menit. Jika kamu tidak merasa mendaftar di Aria, abaikan email ini.`,
    });
    this.logger.log(`Kode verifikasi dikirim ke ${to}`);
  }
}
