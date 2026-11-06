import type { PrismaClient } from '@prisma/client';
import { MARKETPLACES, type Marketplace } from '../integrations/market-price-provider.js';

export interface UserSettings {
  /** Marketplace de referência para o valor da carteira. */
  priceSource: Marketplace;
}

const DEFAULTS: UserSettings = { priceSource: 'cardmarket' };
const KEY = 'user';

/** Preferências do usuário, guardadas em AppSetting (o app é de um único usuário). */
export class SettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<UserSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    const value = (row?.value ?? {}) as Partial<UserSettings>;
    return {
      priceSource: MARKETPLACES.includes(value.priceSource as Marketplace) ? (value.priceSource as Marketplace) : DEFAULTS.priceSource,
    };
  }

  async update(patch: Partial<UserSettings>): Promise<UserSettings> {
    const next = { ...(await this.get()), ...patch };
    await this.prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: { ...next } }, update: { value: { ...next } } });
    return next;
  }
}
