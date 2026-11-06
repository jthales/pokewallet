import { Router } from 'express';
import type { CatalogController } from '../controllers/catalog.controller.js';
import type { CollectionController } from '../controllers/collection.controller.js';
import type { SalesController } from '../controllers/sales.controller.js';

export function buildRouter(c: { catalog: CatalogController; collection: CollectionController; sales: SalesController }) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Catálogo externo (TCGdex) e identificação
  router.get('/catalog/cards', c.catalog.searchCards);
  router.get('/catalog/cards/:id', c.catalog.getCard);
  router.get('/catalog/sets', c.catalog.getSets);
  router.get('/catalog/sets/:id', c.catalog.getSet);
  router.post('/identify', c.catalog.identify);

  // Coleção local
  router.get('/dashboard', c.collection.dashboard);
  router.get('/collection/cards', c.collection.listCards);
  router.get('/collection/filters', c.collection.filters);
  router.get('/collection/cards/:id', c.collection.getCard);
  router.post('/collection/items', c.collection.addItems);
  router.patch('/collection/items/:id', c.collection.updateItem);
  router.delete('/collection/items/:id', c.collection.deleteItem);

  // Vendas
  router.post('/collection/items/:id/sale', c.sales.sell);
  router.get('/sales', c.sales.list);
  router.patch('/sales/:id', c.sales.update);
  router.post('/sales/:id/cancel', c.sales.cancel);

  return router;
}
