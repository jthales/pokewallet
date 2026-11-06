import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'PokéWallet', loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
  { path: 'scanner', title: 'Scanner · PokéWallet', loadComponent: () => import('./features/scanner/scanner-page').then((m) => m.ScannerPage) },
  { path: 'colecao', title: 'Coleção · PokéWallet', loadComponent: () => import('./features/collection/collection-page').then((m) => m.CollectionPage) },
  { path: 'colecao/:id', title: 'Carta · PokéWallet', loadComponent: () => import('./features/card-details/card-details-page').then((m) => m.CardDetailsPage) },
  { path: 'vendas', title: 'Vendas · PokéWallet', loadComponent: () => import('./features/sales/sales-page').then((m) => m.SalesPage) },
  { path: '**', redirectTo: '' },
];
