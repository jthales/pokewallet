import type { Request, Response } from 'express';
import { CollectionQuerySchema, CreateItemsSchema, UpdateItemSchema } from '../schemas/index.js';
import { toItemView, type CollectionService } from '../services/collection.service.js';
import type { MarketPriceService } from '../services/market-price.service.js';

export class CollectionController {
  constructor(
    private readonly collection: CollectionService,
    private readonly prices?: MarketPriceService,
  ) {}

  addItems = async (req: Request, res: Response) => {
    const { card, items } = await this.collection.addItems(CreateItemsSchema.parse(req.body));
    // Já busca a cotação da carta nova (uma consulta, independentemente da quantidade). Falhas não impedem o cadastro.
    await this.prices?.refresh({ cardIds: [card.id] }).catch((error: unknown) => console.error(error));
    res.status(201).json({ cardId: card.id, items: items.map((i) => toItemView(i)) });
  };

  listCards = async (req: Request, res: Response) => {
    res.json(await this.collection.listCards(CollectionQuerySchema.parse(req.query)));
  };

  filters = async (_req: Request, res: Response) => {
    res.json(await this.collection.getFilters());
  };

  getCard = async (req: Request, res: Response) => {
    res.json(await this.collection.getCard(String(req.params['id'])));
  };

  updateItem = async (req: Request, res: Response) => {
    res.json(await this.collection.updateItem(String(req.params['id']), UpdateItemSchema.parse(req.body)));
  };

  deleteItem = async (req: Request, res: Response) => {
    await this.collection.deleteItem(String(req.params['id']));
    res.status(204).end();
  };

  dashboard = async (_req: Request, res: Response) => {
    res.json(await this.collection.dashboard());
  };
}
