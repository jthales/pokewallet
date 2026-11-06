import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { CatalogController } from './controllers/catalog.controller.js';
import { CollectionController } from './controllers/collection.controller.js';
import { SalesController } from './controllers/sales.controller.js';
import { CatalogUnavailableError, type CardCatalogProvider } from './integrations/catalog-provider.js';
import { AppError } from './lib/errors.js';
import { buildRouter } from './routes/index.js';
import { CollectionService } from './services/collection.service.js';
import { IdentificationService } from './services/identification.service.js';
import { SalesService } from './services/sales.service.js';

export interface AppDeps {
  prisma: PrismaClient;
  catalog: CardCatalogProvider;
  corsOrigin?: string;
  /** Pasta com o build do frontend, servida pelo próprio backend em produção. */
  staticDir?: string;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  if (deps.corsOrigin) app.use(cors({ origin: deps.corsOrigin.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '100kb' }));

  const identification = new IdentificationService(deps.catalog);
  const router = buildRouter({
    catalog: new CatalogController(deps.catalog, identification),
    collection: new CollectionController(new CollectionService(deps.prisma, deps.catalog)),
    sales: new SalesController(new SalesService(deps.prisma)),
  });
  app.use('/api', router);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
  });

  if (deps.staticDir) {
    const dir = deps.staticDir;
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    // Fallback do SPA: qualquer rota não-API devolve o index.html do Angular.
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: dir }));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof CatalogUnavailableError) {
      return res.status(503).json({ error: { code: 'CATALOG_UNAVAILABLE', message: 'O catálogo de cartas (TCGdex) está indisponível no momento. Sua coleção continua acessível.' } });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
    }
    console.error(error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro inesperado no servidor.' } });
  });

  return app;
}
