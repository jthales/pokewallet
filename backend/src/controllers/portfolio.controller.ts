import type { Request, Response } from 'express';
import { PortfolioHistoryQuerySchema, PortfolioQuerySchema, RefreshPricesSchema, UpdateSettingsSchema } from '../schemas/index.js';
import type { MarketPriceService, SyncResult } from '../services/market-price.service.js';
import type { PortfolioService } from '../services/portfolio.service.js';
import type { SettingsService } from '../services/settings.service.js';

export class PortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly prices: MarketPriceService,
    private readonly settings: SettingsService,
  ) {}

  /** Ao abrir a carteira, atualiza (em lote limitado) as cotações vencidas e devolve os indicadores. */
  summary = async (req: Request, res: Response) => {
    const { sort } = PortfolioQuerySchema.parse(req.query);
    const sync = await this.safeRefresh({ limit: 10 });
    res.json({ ...(await this.portfolio.summary(sort)), sync });
  };

  /** Atualização manual (botão) ou de uma carta específica. O cliente repete enquanto `remaining` > 0. */
  refresh = async (req: Request, res: Response) => {
    const body = RefreshPricesSchema.parse(req.body ?? {});
    res.json(await this.prices.refresh({ since: body.since, cardIds: body.cardId ? [body.cardId] : undefined }));
  };

  history = async (req: Request, res: Response) => {
    const { period } = PortfolioHistoryQuerySchema.parse(req.query);
    res.json(await this.portfolio.portfolioHistory(period));
  };

  card = async (req: Request, res: Response) => {
    const id = String(req.params['id']);
    const sync = await this.safeRefresh({ cardIds: [id] });
    res.json({ ...(await this.portfolio.cardPerformance(id)), sync });
  };

  cardValues = async (_req: Request, res: Response) => {
    res.json(await this.portfolio.cardValues());
  };

  getSettings = async (_req: Request, res: Response) => {
    res.json(await this.settings.get());
  };

  updateSettings = async (req: Request, res: Response) => {
    res.json(await this.settings.update(UpdateSettingsSchema.parse(req.body)));
  };

  /** A carteira continua abrindo com os últimos preços salvos mesmo se a atualização der errado. */
  private async safeRefresh(params: Parameters<MarketPriceService['refresh']>[0]): Promise<SyncResult | { error: string }> {
    try {
      return await this.prices.refresh(params);
    } catch (error) {
      console.error(error);
      return { error: 'Não foi possível atualizar as cotações agora. Exibindo os últimos preços salvos.' };
    }
  }
}
