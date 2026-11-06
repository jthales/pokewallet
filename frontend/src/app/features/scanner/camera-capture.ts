import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** Proporção de uma carta Pokémon (63 × 88 mm). */
const CARD_RATIO = 63 / 88;

/**
 * Câmera do dispositivo via MediaDevices API. Mostra uma moldura no formato da carta e, ao capturar,
 * recorta só a área da moldura — assim as regiões de nome e número ficam em posições previsíveis.
 */
@Component({
  selector: 'app-camera-capture',
  imports: [MatButtonModule, MatIconModule],
  host: { '[class.fullscreen]': 'fullscreen()' },
  template: `
    <div class="viewport" [class.on]="active()">
      <video #video playsinline muted autoplay aria-label="Pré-visualização da câmera"></video>
      @if (active()) {
        <div class="guide" #guide aria-hidden="true"></div>
        <p class="tip" aria-hidden="true">Enquadre a carta inteira na moldura</p>
      } @else {
        <div class="idle">
          @if (error()) {
            <p role="alert">{{ error() }}</p>
          } @else {
            <mat-icon aria-hidden="true">photo_camera</mat-icon>
            <p>Use a câmera traseira para fotografar a frente da carta.</p>
          }
          <button mat-flat-button (click)="start()" [disabled]="starting()">
            {{ starting() ? 'Abrindo câmera…' : error() ? 'Tentar novamente' : 'Abrir câmera' }}
          </button>
        </div>
      }
    </div>
    @if (active()) {
      <div class="controls">
        <button class="side" type="button" (click)="stop()"><mat-icon>close</mat-icon><span>Fechar</span></button>
        <button class="shutter" type="button" (click)="capture()" aria-label="Tirar foto"><span></span></button>
        <button class="side" type="button" (click)="openGallery()"><mat-icon>photo_library</mat-icon><span>Galeria</span></button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .viewport { position: relative; border-radius: 16px; overflow: hidden; background: linear-gradient(135deg, #1b2a3f, #111); }
    .viewport.on { container-type: size; }
    video { width: 100%; height: 100%; object-fit: cover; display: none; }
    .on video { display: block; }
    .guide {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(86cqw, calc(84cqh * 63 / 88)); aspect-ratio: 63 / 88;
      border: 3px solid var(--pw-yellow); border-radius: 14px; box-shadow: 0 0 0 100vmax rgb(0 0 0 / .45);
    }
    .tip {
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%); margin: 0; white-space: nowrap;
      background: rgb(0 0 0 / .6); color: #fff; font-size: 13px; padding: 6px 12px; border-radius: 999px;
    }
    .idle { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #eee; text-align: center; padding: 24px 20px; }
    .idle mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--pw-yellow); }
    .idle button { height: 48px; padding: 0 28px; font-weight: 800; }
    .idle p { margin: 0; max-width: 300px; }

    /* Com a câmera aberta, ocupa a tela inteira: prévia em cima e botão de foto sempre visível embaixo. */
    :host(.fullscreen) {
      position: fixed; inset: 0; z-index: 1000; background: #000;
      display: flex; flex-direction: column;
      padding-top: env(safe-area-inset-top);
    }
    :host(.fullscreen) .viewport { flex: 1; min-height: 0; aspect-ratio: auto; max-height: none; border-radius: 0; width: 100%; }
    .controls {
      flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; justify-items: center;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); background: #000;
    }
    .side {
      display: flex; flex-direction: column; align-items: center; gap: 2px; background: none; border: 0; color: #fff;
      font: inherit; font-size: 12px; padding: 8px 12px; border-radius: 12px; cursor: pointer; min-width: 64px;
    }
    .side:focus-visible { outline: 2px solid var(--pw-yellow); }
    .shutter { width: 76px; height: 76px; border-radius: 50%; border: 4px solid #fff; background: transparent; padding: 5px; cursor: pointer; }
    .shutter span { display: block; width: 100%; height: 100%; border-radius: 50%; background: var(--pw-red); transition: transform .1s; }
    .shutter:active span { transform: scale(.9); }
    .shutter:focus-visible { outline: 3px solid var(--pw-yellow); outline-offset: 3px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraCapture implements OnDestroy {
  readonly captured = output<Blob>();
  /** Pede ao componente pai para abrir a seleção de foto da galeria. */
  readonly gallery = output<void>();
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly guide = viewChild<ElementRef<HTMLElement>>('guide');
  readonly active = signal(false);
  readonly fullscreen = signal(false);
  readonly starting = signal(false);
  readonly error = signal<string | null>(null);
  private stream: MediaStream | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Marca a posição original do componente enquanto ele está em tela cheia no <body>. */
  private placeholder: Comment | null = null;

  /**
   * Em tela cheia o componente é movido para o <body>: assim nenhum ancestral com transform
   * (como as abas do Material) ou a navegação fixa do app fica por cima da câmera.
   */
  private enterFullscreen() {
    if (this.placeholder || !this.host.parentNode) return;
    this.placeholder = document.createComment('camera');
    this.host.parentNode.insertBefore(this.placeholder, this.host);
    document.body.appendChild(this.host);
    document.body.style.overflow = 'hidden';
    this.fullscreen.set(true);
  }

  private exitFullscreen() {
    if (this.placeholder?.parentNode) this.placeholder.parentNode.insertBefore(this.host, this.placeholder);
    this.placeholder?.remove();
    this.placeholder = null;
    document.body.style.overflow = '';
    this.fullscreen.set(false);
  }

  async start() {
    this.error.set(null);
    if (!window.isSecureContext) {
      this.error.set('A câmera só funciona em HTTPS ou em localhost. Abra o app por um endereço seguro ou envie uma foto.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Este navegador não oferece acesso à câmera. Envie uma foto da carta.');
      return;
    }
    this.starting.set(true);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      // Entra em tela cheia antes de tocar o vídeo: mover um <video> tocando no DOM o pausaria.
      this.enterFullscreen();
      const video = this.video().nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.active.set(true);
    } catch (e) {
      this.stop();
      const name = (e as DOMException)?.name;
      this.error.set(
        name === 'NotAllowedError'
          ? 'Permissão da câmera negada. Libere o acesso nas configurações do navegador ou envie uma foto.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Nenhuma câmera foi encontrada neste dispositivo. Envie uma foto da carta.'
            : name === 'NotReadableError'
              ? 'A câmera está sendo usada por outro aplicativo.'
              : 'Não foi possível abrir a câmera. Envie uma foto da carta.',
      );
    } finally {
      this.starting.set(false);
    }
  }

  capture() {
    const video = this.video().nativeElement;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    // Converte a moldura exibida (object-fit: cover) para coordenadas do vídeo.
    const box = video.getBoundingClientRect();
    const guide = this.guide()?.nativeElement.getBoundingClientRect();
    const scale = Math.max(box.width / vw, box.height / vh);
    const offX = (box.width - vw * scale) / 2;
    const offY = (box.height - vh * scale) / 2;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (guide) {
      sx = (guide.left - box.left - offX) / scale;
      sy = (guide.top - box.top - offY) / scale;
      sw = guide.width / scale;
      sh = sw / CARD_RATIO;
      sx = Math.max(0, sx);
      sy = Math.max(0, sy);
      sw = Math.min(sw, vw - sx);
      sh = Math.min(sh, vh - sy);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          this.stop();
          this.captured.emit(blob);
        }
      },
      'image/jpeg',
      0.92,
    );
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const video = this.video().nativeElement;
    video.srcObject = null;
    this.active.set(false);
    this.exitFullscreen();
  }

  openGallery() {
    this.stop();
    this.gallery.emit();
  }

  ngOnDestroy() {
    this.stop();
  }
}
