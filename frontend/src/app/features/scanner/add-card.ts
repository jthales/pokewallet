import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { NotifyService } from '../../core/notify.service';
import { ItemFormData, ItemFormDialog, ItemFormResult } from '../../shared/item-form-dialog';

/** Abre o formulário de cadastro para uma carta do catálogo (após confirmação do usuário). */
@Injectable({ providedIn: 'root' })
export class AddCardFlow {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  open(externalId: string, fallback: { name: string; localNumber: string; imageUrl: string | null; setName: string | null; rarity?: string | null }) {
    // Busca os detalhes completos (raridade, variantes conhecidas). Se falhar, segue com os dados do resultado.
    this.api.getCatalogCard(externalId).subscribe({
      next: (card) =>
        this.show({
          mode: 'create',
          card: {
            provider: card.provider,
            externalId: card.externalId,
            name: card.name,
            localNumber: card.localNumber,
            imageUrl: card.image?.small ?? fallback.imageUrl,
            setName: card.set.name,
            rarity: card.rarity,
          },
          variants: card.variants,
        }),
      error: (e) => this.notify.error(e, 'Não foi possível carregar os detalhes da carta.'),
    });
  }

  private show(data: ItemFormData) {
    this.dialog
      .open<ItemFormDialog, ItemFormData, ItemFormResult>(ItemFormDialog, { data, width: '560px', maxWidth: '95vw', autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((result) => {
        if (result?.cardId) {
          this.notify.success('Carta salva na coleção.', 'Ver carta').onAction().subscribe(() => void this.router.navigate(['/colecao', result.cardId]));
        }
      });
  }
}
