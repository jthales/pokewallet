import type { Request, Response } from 'express';
import type { CardCatalogProvider } from '../integrations/catalog-provider.js';
import { notFound } from '../lib/errors.js';
import { normalizeLocalNumber } from '../lib/text.js';
import { CatalogSearchQuerySchema, IdentifySchema, LangQuerySchema } from '../schemas/index.js';
import type { IdentificationService } from '../services/identification.service.js';

export class CatalogController {
  constructor(
    private readonly catalog: CardCatalogProvider,
    private readonly identification: IdentificationService,
  ) {}

  searchCards = async (req: Request, res: Response) => {
    const q = CatalogSearchQuerySchema.parse(req.query);
    // Pedimos um item a mais para saber se existe próxima página.
    const cards = await this.catalog.searchCards({
      name: q.name,
      localNumber: q.number,
      setId: q.setId,
      page: q.page,
      pageSize: q.pageSize + 1,
      language: q.lang,
    });
    const page = cards.slice(0, q.pageSize);
    // O filtro de número da TCGdex é parcial ("4" também traz "14"); números exatos vêm primeiro.
    if (q.number) {
      const wanted = normalizeLocalNumber(q.number);
      page.sort((a, b) => Number(normalizeLocalNumber(b.localNumber) === wanted) - Number(normalizeLocalNumber(a.localNumber) === wanted));
    }
    res.json({ page: q.page, pageSize: q.pageSize, hasMore: cards.length > q.pageSize, cards: page });
  };

  getCard = async (req: Request, res: Response) => {
    const { lang } = LangQuerySchema.parse(req.query);
    const card = await this.catalog.getCardById(String(req.params['id']), lang);
    if (!card) throw notFound('Carta');
    res.json(card);
  };

  getSets = async (req: Request, res: Response) => {
    const { lang } = LangQuerySchema.parse(req.query);
    res.json(await this.catalog.getSets(lang));
  };

  getSet = async (req: Request, res: Response) => {
    const { lang } = LangQuerySchema.parse(req.query);
    const set = await this.catalog.getSetById(String(req.params['id']), lang);
    if (!set) throw notFound('Expansão');
    res.json(set);
  };

  identify = async (req: Request, res: Response) => {
    const body = IdentifySchema.parse(req.body);
    res.json(await this.identification.identify(body));
  };
}
