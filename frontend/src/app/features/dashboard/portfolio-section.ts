import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable, concatMap, defer, of } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { BrlPipe, VariantPipe } from '../../core/format.pipes';
import { MARKETPLACE_OPTIONS, PERIOD_OPTIONS, marketplaceLabel } from '../../core/labels';
import { Marketplace, Period, Portfolio, PortfolioHistory, RankingSort, SyncResult } from '../../core/models';
import { formatCents } from '../../core/money';
import { NotifyService } from '../../core/notify.service';
import { CardImage } from '../../shared/card-image';
import { Delta } from '../../shared/delta';
import { ChartSeries, LineChart } from '../../shared/line-chart';

/** Seção "Minha carteira" do dashboard: indicadores, gráfico de patrimônio e rankings. */
@Component({
  selector: 'app-portfolio-section',
  imports: [DatePipe, RouterLink, MatButtonModule, MatButtonToggleModule, MatIconModule, MatProgressSpinnerModule, MatSelectModule, BrlPipe, VariantPipe, CardImage, Delta, LineChart],
  templateUrl: './portfolio-section.html',
  styleUrl: './portfolio-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioSection {
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);

  readonly marketplaces = MARKETPLACE_OPTIONS;
  readonly periods = PERIOD_OPTIONS;
  readonly marketplaceLabel = marketplaceLabel;
  readonly rate = (r: string) => r.replace('.', ',');
  readonly formatBrl = (v: number) => formatCents(Math.round(v));

  readonly data = signal<Portfolio | null>(null);
  readonly history = signal<PortfolioHistory | null>(null);
  readonly loading = signal(true);
  readonly historyLoading = signal(true);
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly period = signal<Period>('30d');
  readonly sort = signal<RankingSort>('absolute');

  readonly series = computed<ChartSeries[]>(() => {
    const points = this.history()?.points ?? [];
    return [
      { label: 'Patrimônio estimado', color: 'var(--pw-blue)', points: points.map((p) => ({ x: p.date, y: p.valueCents })) },
      { label: 'Capital aplicado', color: 'var(--pw-muted)', dashed: true, points: points.map((p) => ({ x: p.date, y: p.investedCents })) },
    ];
  });

  readonly notices = computed(() => {
    const d = this.data();
    if (!d) return [];
    const list: { icon: string; text: string; info?: boolean }[] = [];
    const s = d.summary;
    if (d.meta.unpricedItems) list.push({ icon: 'help_outline', text: `${d.meta.unpricedItems} exemplar(es) sem cotação de mercado compatível com a variante — ${s.holdings.unvalued ? `${s.holdings.unvalued} fora do patrimônio` : 'avaliados manualmente'}.` });
    if (d.meta.staleItems) list.push({ icon: 'schedule', text: `${d.meta.staleItems} exemplar(es) com cotação desatualizada (a última consulta falhou ou tem mais de 2 dias).` });
    if (d.meta.fx.EUR?.stale || d.meta.fx.USD?.stale) list.push({ icon: 'currency_exchange', text: 'A cotação do câmbio está desatualizada: a Frankfurter não respondeu e usamos o último valor salvo.' });
    if (d.sync.error) list.push({ icon: 'cloud_off', text: d.sync.error });
    if (s.holdings.withoutCost) list.push({ icon: 'info', info: true, text: `${s.holdings.withoutCost} exemplar(es) sem preço pago: aparecem no patrimônio, mas não na rentabilidade.` });
    return list;
  });

  constructor() {
    this.load();
    this.loadHistory();
  }

  load(after?: () => void) {
    this.loading.set(!this.data());
    this.error.set(null);
    this.api.portfolio(this.sort()).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        after?.();
        // Ainda há cartas a atualizar: continua em segundo plano, em lotes.
        if (d.sync.remaining > 0 && !this.refreshing()) this.runRefresh(undefined, false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  loadHistory() {
    this.historyLoading.set(true);
    this.api.portfolioHistory(this.period()).subscribe({
      next: (h) => {
        this.history.set(h);
        this.historyLoading.set(false);
      },
      error: () => this.historyLoading.set(false),
    });
  }

  setPeriod(p: Period) {
    this.period.set(p);
    this.loadHistory();
  }

  setSort(s: RankingSort) {
    this.sort.set(s);
    this.load();
  }

  setMarketplace(m: Marketplace) {
    this.api.updateSettings(m).subscribe({
      next: () => {
        this.notify.success(`Fonte de preços: ${marketplaceLabel(m)}.`);
        this.load();
        this.loadHistory();
      },
      error: (e) => this.notify.error(e),
    });
  }

  /** Botão "Atualizar": reconsulta todas as cartas, em lotes, até não sobrar nenhuma. */
  refresh() {
    this.runRefresh(new Date().toISOString(), true);
  }

  private runRefresh(since: string | undefined, manual: boolean) {
    this.refreshing.set(true);
    let failed = 0;
    let rounds = 0;
    const step = (): Observable<SyncResult> =>
      defer(() => this.api.refreshPrices(since ? { since } : {})).pipe(
        concatMap((r) => {
          failed += r.failed;
          rounds++;
          return r.remaining > 0 && rounds < 30 ? step() : of(r);
        }),
      );
    step().subscribe({
      next: () => {
        this.refreshing.set(false);
        this.load(() => {
          if (!manual) return;
          if (failed) this.notify.error(new Error(`${failed} carta(s) não puderam ser atualizadas; mantivemos o último preço válido.`));
          else this.notify.success('Cotações atualizadas.');
        });
        this.loadHistory();
      },
      error: (e) => {
        this.refreshing.set(false);
        if (manual) this.notify.error(e);
      },
    });
  }
}
