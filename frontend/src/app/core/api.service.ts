import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ApiErrorBody,
  CatalogCard,
  CatalogLanguage,
  CatalogSearchResult,
  CatalogSetSummary,
  CollectionCard,
  CollectionCardDetail,
  CollectionFilters,
  CollectionItem,
  CollectionQuery,
  Dashboard,
  IdentificationResult,
  IdentifyRequest,
  NewItemsRequest,
  Sale,
  SalesHistory,
  SellRequest,
  UpdateItemRequest,
} from './models';

function params(obj: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

/** Converte qualquer erro HTTP em uma mensagem clara para o usuário. */
export function errorMessage(error: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Não foi possível falar com o servidor do PokéWallet. Verifique se o backend está rodando.';
    const body = error.error as ApiErrorBody | null;
    const detail = body?.error?.details?.[0];
    if (body?.error?.message) return detail ? `${body.error.message} (${detail.path}: ${detail.message})` : body.error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  // Catálogo
  searchCatalog(q: { name?: string; number?: string; setId?: string; page?: number; pageSize?: number; lang?: CatalogLanguage }) {
    return this.http.get<CatalogSearchResult>(`${this.base}/catalog/cards`, { params: params(q) });
  }
  getCatalogCard(id: string, lang: CatalogLanguage = 'en') {
    return this.http.get<CatalogCard>(`${this.base}/catalog/cards/${encodeURIComponent(id)}`, { params: params({ lang }) });
  }
  getSets(lang: CatalogLanguage = 'en') {
    return this.http.get<CatalogSetSummary[]>(`${this.base}/catalog/sets`, { params: params({ lang }) });
  }
  identify(body: IdentifyRequest) {
    return this.http.post<IdentificationResult>(`${this.base}/identify`, body);
  }

  // Coleção
  dashboard() {
    return this.http.get<Dashboard>(`${this.base}/dashboard`);
  }
  listCollection(q: CollectionQuery) {
    return this.http.get<CollectionCard[]>(`${this.base}/collection/cards`, { params: params(q) });
  }
  collectionFilters() {
    return this.http.get<CollectionFilters>(`${this.base}/collection/filters`);
  }
  getCollectionCard(id: string) {
    return this.http.get<CollectionCardDetail>(`${this.base}/collection/cards/${id}`);
  }
  addItems(body: NewItemsRequest): Observable<{ cardId: string; items: CollectionItem[] }> {
    return this.http.post<{ cardId: string; items: CollectionItem[] }>(`${this.base}/collection/items`, body);
  }
  updateItem(id: string, body: UpdateItemRequest) {
    return this.http.patch<CollectionItem>(`${this.base}/collection/items/${id}`, body);
  }
  deleteItem(id: string) {
    return this.http.delete<void>(`${this.base}/collection/items/${id}`);
  }

  // Vendas
  sell(itemId: string, body: SellRequest) {
    return this.http.post<Sale>(`${this.base}/collection/items/${itemId}/sale`, body);
  }
  updateSale(id: string, body: Partial<SellRequest>) {
    return this.http.patch<Sale>(`${this.base}/sales/${id}`, body);
  }
  cancelSale(id: string) {
    return this.http.post<Sale>(`${this.base}/sales/${id}/cancel`, {});
  }
  sales(includeCancelled = false) {
    return this.http.get<SalesHistory>(`${this.base}/sales`, { params: params({ includeCancelled }) });
  }
}
