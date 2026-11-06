import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, afterNextRender, DestroyRef } from '@angular/core';

export interface ChartSeries {
  label: string;
  /** Cor da linha (token CSS ou hex). */
  color: string;
  dashed?: boolean;
  points: { x: string; y: number }[];
}

const PAD = { top: 12, right: 12, bottom: 26, left: 64 };
const HEIGHT = 220;

/**
 * Gráfico de linhas em SVG puro (sem dependência): eixo de datas, uma única escala Y, crosshair + tooltip,
 * legenda quando há mais de uma série e tabela alternativa para leitores de tela.
 * As séries só são ligadas entre pontos da própria série (nunca entre fornecedores/variantes diferentes).
 */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="wrap" (pointerleave)="hover.set(null)">
      @if (series().length > 1) {
        <ul class="legend">
          @for (s of series(); track s.label) {
            <li><span class="swatch" [class.dashed]="s.dashed" [style.border-color]="s.color"></span>{{ s.label }}</li>
          }
        </ul>
      }
      <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="ariaLabel()" (pointermove)="onMove($event)" (pointerdown)="onMove($event)">
        @for (t of yTicks(); track t.v) {
          <line class="grid" [attr.x1]="pad.left" [attr.x2]="width() - pad.right" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text class="axis" [attr.x]="pad.left - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (t of xTicks(); track t.x) {
          <text class="axis" [attr.x]="t.x" [attr.y]="height - 6" [attr.text-anchor]="t.anchor">{{ t.label }}</text>
        }
        @for (s of paths(); track s.label) {
          <path [attr.d]="s.d" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" [attr.stroke-dasharray]="s.dashed ? '6 4' : null" />
          @if (s.single) {
            <circle [attr.cx]="s.single.x" [attr.cy]="s.single.y" r="4" [attr.fill]="s.color" class="ring" />
          }
        }
        @if (hoverInfo(); as h) {
          <line class="cross" [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="pad.top" [attr.y2]="height - pad.bottom" />
          @for (p of h.points; track p.label) {
            <circle [attr.cx]="h.x" [attr.cy]="p.y" r="4" [attr.fill]="p.color" class="ring" />
          }
        }
      </svg>
      @if (hoverInfo(); as h) {
        <div class="tip" [style.left.px]="h.tipLeft" role="status">
          <strong>{{ h.dateLabel }}</strong>
          @for (p of h.points; track p.label) {
            <div><span class="dot" [style.background]="p.color"></span>{{ p.label }}: <b>{{ p.value }}</b></div>
          }
        </div>
      }
    </div>
    <details class="table">
      <summary>Ver dados em tabela</summary>
      <table>
        <thead><tr><th scope="col">Data</th>@for (s of series(); track s.label) {<th scope="col">{{ s.label }}</th>}</tr></thead>
        <tbody>
          @for (x of xs(); track x) {
            <tr><td>{{ dateLabel(x) }}</td>@for (s of series(); track s.label) {<td>{{ valueAt(s, x) }}</td>}</tr>
          }
        </tbody>
      </table>
    </details>
  `,
  styles: `
    :host { display: block; }
    .wrap { position: relative; width: 100%; touch-action: pan-y; }
    svg { display: block; overflow: visible; }
    .grid { stroke: var(--pw-border); stroke-width: 1; }
    .axis { fill: var(--pw-muted); font-size: 11px; }
    .cross { stroke: var(--pw-muted); stroke-width: 1; stroke-dasharray: 2 3; }
    .ring { stroke: var(--pw-surface); stroke-width: 2; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; padding: 0; margin: 0 0 8px; font-size: 12px; color: var(--pw-muted); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 18px; border-top: 2px solid; }
    .swatch.dashed { border-top-style: dashed; }
    .tip { position: absolute; top: 28px; transform: translateX(-50%); background: var(--pw-surface); border: 1px solid var(--pw-border); border-radius: 10px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 18px rgb(0 0 0 / .12); pointer-events: none; white-space: nowrap; z-index: 2; }
    .tip .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .table { margin-top: 8px; font-size: 12px; color: var(--pw-muted); }
    .table summary { cursor: pointer; }
    .table table { border-collapse: collapse; margin-top: 6px; width: 100%; }
    .table th, .table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--pw-border); color: var(--mat-sys-on-surface); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChart {
  readonly series = input.required<ChartSeries[]>();
  readonly format = input<(v: number) => string>((v) => String(v));
  readonly ariaLabel = input('Gráfico');
  /** Inclui o zero no eixo Y (bom para totais); desligue para ver a variação de um preço. */
  readonly zeroBased = input(true);

  readonly pad = PAD;
  readonly height = HEIGHT;
  readonly width = signal(320);
  readonly hover = signal<number | null>(null);
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      const update = () => this.width.set(Math.max(240, Math.floor(el.clientWidth)));
      update();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(update);
        ro.observe(el);
        destroyRef.onDestroy(() => ro.disconnect());
      }
    });
  }

  readonly xs = computed(() => [...new Set(this.series().flatMap((s) => s.points.map((p) => p.x)))].sort());

  private readonly scale = computed(() => {
    const xs = this.xs();
    const values = this.series().flatMap((s) => s.points.map((p) => p.y));
    let min = this.zeroBased() ? Math.min(0, ...values) : Math.min(...values);
    let max = this.zeroBased() ? Math.max(...values, 1) : Math.max(...values);
    if (!values.length) [min, max] = [0, 1];
    if (min === max) max = min + 1;
    const span = max - min;
    max += span * 0.08;
    if (min < 0 || !this.zeroBased()) min -= span * 0.08;
    const t0 = xs.length ? Date.parse(xs[0]!) : 0;
    const t1 = xs.length ? Date.parse(xs[xs.length - 1]!) : 1;
    const innerW = this.width() - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const x = (d: string) => (t1 === t0 ? PAD.left + innerW / 2 : PAD.left + ((Date.parse(d) - t0) / (t1 - t0)) * innerW);
    const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
    return { x, y, min, max };
  });

  readonly yTicks = computed(() => {
    const { y, min, max } = this.scale();
    const step = niceStep((max - min) / 4);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push({ v, y: y(v), label: this.format()(v) });
    return ticks;
  });

  readonly xTicks = computed(() => {
    const xs = this.xs();
    if (!xs.length) return [];
    const { x } = this.scale();
    const picks = xs.length <= 2 ? xs : [xs[0]!, xs[Math.floor(xs.length / 2)]!, xs[xs.length - 1]!];
    return [...new Set(picks)].map((d, i, arr) => ({
      x: x(d),
      label: this.dateLabel(d),
      anchor: arr.length === 1 ? 'middle' : i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle',
    }));
  });

  readonly paths = computed(() => {
    const { x, y } = this.scale();
    return this.series().map((s) => {
      const pts = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
      return {
        ...s,
        d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' '),
        single: pts.length === 1 ? { x: x(pts[0]!.x), y: y(pts[0]!.y) } : null,
      };
    });
  });

  readonly hoverInfo = computed(() => {
    const i = this.hover();
    const xs = this.xs();
    if (i === null || !xs[i]) return null;
    const d = xs[i]!;
    const { x, y } = this.scale();
    const cx = x(d);
    const points = this.series()
      .map((s) => ({ s, p: s.points.find((p) => p.x === d) }))
      .filter((e) => e.p)
      .map(({ s, p }) => ({ label: s.label, color: s.color, y: y(p!.y), value: this.format()(p!.y) }));
    const tipLeft = Math.min(Math.max(cx, 90), this.width() - 90);
    return { x: cx, points, dateLabel: this.dateLabel(d), tipLeft };
  });

  onMove(event: PointerEvent) {
    const xs = this.xs();
    if (!xs.length) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const px = event.clientX - rect.left;
    const { x } = this.scale();
    let best = 0;
    xs.forEach((d, i) => {
      if (Math.abs(x(d) - px) < Math.abs(x(xs[best]!) - px)) best = i;
    });
    this.hover.set(best);
  }

  dateLabel(d: string) {
    const [yy, mm, dd] = d.split('-');
    return `${dd}/${mm}/${yy!.slice(2)}`;
  }

  valueAt(s: ChartSeries, x: string) {
    const p = s.points.find((q) => q.x === x);
    return p ? this.format()(p.y) : '—';
  }
}

function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
