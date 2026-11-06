import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly nav: NavItem[] = [
    { path: '/', label: 'Início', icon: 'home', exact: true },
    { path: '/colecao', label: 'Coleção', icon: 'collections_bookmark' },
    { path: '/scanner', label: 'Escanear', icon: 'photo_camera' },
    { path: '/vendas', label: 'Vendas', icon: 'sell' },
  ];
}
