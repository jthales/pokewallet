import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
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
  template: `
    <div class="viewport" [class.on]="active()">
      <video #video playsinline muted autoplay aria-label="Pré-visualização da câmera"></video>
      @if (active()) {
        <div class="guide" #guide aria-hidden="true"><span>Enquadre a carta inteira</span></div>
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
        <button mat-button (click)="stop()"><mat-icon>close</mat-icon>Fechar</button>
        <button class="shutter" (click)="capture()" aria-label="Tirar foto"><span></span></button>
        <span class="spacer"></span>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .viewport { position: relative; border-radius: 16px; overflow: hidden; background: #111; aspect-ratio: 3 / 4; max-height: 70dvh; margin: 0 auto; }
    video { width: 100%; height: 100%; object-fit: cover; display: none; }
    .on video { display: block; }
    .guide {
      position: absolute; top: 50%; left: 50%; height: 86%; aspect-ratio: 63 / 88; transform: translate(-50%, -50%);
      border: 3px solid var(--pw-yellow); border-radius: 14px; box-shadow: 0 0 0 100vmax rgb(0 0 0 / .45);
      display: flex; align-items: flex-end; justify-content: center;
      span { background: rgb(0 0 0 / .6); color: #fff; font-size: 12px; padding: 4px 10px; border-radius: 999px; margin-bottom: -34px; }
    }
    .idle { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #eee; text-align: center; padding: 24px; }
    .idle mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--pw-yellow); }
    .idle p { margin: 0; max-width: 300px; }
    .controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-top: 12px; }
    .shutter { width: 68px; height: 68px; border-radius: 50%; border: 4px solid var(--pw-red); background: #fff; padding: 5px; cursor: pointer; }
    .shutter span { display: block; width: 100%; height: 100%; border-radius: 50%; background: var(--pw-red); }
    .shutter:active span { transform: scale(.92); }
    .shutter:focus-visible { outline: 3px solid var(--pw-blue); outline-offset: 3px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraCapture implements OnDestroy {
  readonly captured = output<Blob>();
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly guide = viewChild<ElementRef<HTMLElement>>('guide');
  readonly active = signal(false);
  readonly starting = signal(false);
  readonly error = signal<string | null>(null);
  private stream: MediaStream | null = null;

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
  }

  ngOnDestroy() {
    this.stop();
  }
}
