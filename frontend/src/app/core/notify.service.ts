import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { errorMessage } from './api.service';

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snack = inject(MatSnackBar);

  success(message: string, action?: string) {
    return this.snack.open(message, action ?? 'OK', { duration: 3500, panelClass: 'snack-success' });
  }

  error(error: unknown, fallback?: string) {
    return this.snack.open(errorMessage(error, fallback), 'Fechar', { duration: 6000, panelClass: 'snack-error' });
  }
}
