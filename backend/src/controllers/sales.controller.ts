import type { Request, Response } from 'express';
import { SalesQuerySchema, SellItemSchema, UpdateSaleSchema } from '../schemas/index.js';
import type { SalesService } from '../services/sales.service.js';

export class SalesController {
  constructor(private readonly sales: SalesService) {}

  sell = async (req: Request, res: Response) => {
    res.status(201).json(await this.sales.sell(String(req.params['id']), SellItemSchema.parse(req.body)));
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.sales.update(String(req.params['id']), UpdateSaleSchema.parse(req.body)));
  };

  cancel = async (req: Request, res: Response) => {
    res.json(await this.sales.cancel(String(req.params['id'])));
  };

  list = async (req: Request, res: Response) => {
    const { includeCancelled } = SalesQuerySchema.parse(req.query);
    res.json(await this.sales.list(includeCancelled));
  };
}
