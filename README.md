# PokéWallet

Aplicação web para gerenciar uma coleção de cartas **Pokémon TCG**: fotografe a carta, o app lê o texto com OCR no próprio aparelho, sugere as correspondências do catálogo público da **TCGdex**, você confirma e ela entra na sua coleção. Também dá para controlar exemplares físicos (condição, variante, idioma, preço pago) e registrar vendas.

Tudo é gratuito: sem API key, sem serviços pagos, sem nuvem. Os dados ficam num arquivo SQLite local.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Frontend | Angular 21 (standalone components, signals, zoneless), Angular Material 3, TypeScript strict, SCSS, mobile-first |
| OCR | Tesseract.js 7 rodando no navegador (worker, core WebAssembly e modelos `eng` + `por` servidos pelo próprio app) |
| Câmera | MediaDevices API (`getUserMedia`) |
| Backend | Node.js, Express 5, TypeScript, Zod 4 |
| Banco | Prisma 6 + SQLite |
| Catálogo | TCGdex REST API v2 (`https://api.tcgdex.net/v2`) |
| Testes | Vitest (backend e frontend), Supertest |

## Como rodar

Pré-requisito: **Node.js 20.19+ ou 22+** e npm.

```bash
npm install        # instala só o "concurrently" da raiz
npm run setup      # instala backend e frontend, cria backend/.env e aplica as migrations
npm run dev        # sobe API (porta 3000) e Angular (porta 4200)
```

Abra **http://localhost:4200**. O Angular encaminha `/api` para o backend (`frontend/proxy.conf.json`).

### Scripts da raiz

| Script | O que faz |
| --- | --- |
| `npm run setup` | Instala dependências, cria `backend/.env` e aplica as migrations |
| `npm run dev` | Backend com reload + Angular dev server |
| `npm run dev:mobile` | Igual ao `dev`, mas o Angular escuta na rede com HTTPS (para testar a câmera no celular) |
| `npm run build` | Compila backend e frontend |
| `npm start` | Aplica migrations e sobe o backend em `http://localhost:3000`, servindo também o frontend compilado |
| `npm test` | Testes do backend e do frontend |
| `npm run lint` | ESLint + checagem de tipos dos dois projetos |

Os dados ficam em `backend/prisma/dev.db`. Reiniciar a aplicação não apaga nada. Para inspecionar o banco: `npm run db:studio --prefix backend`.

### Variáveis de ambiente (`backend/.env`)

Veja `backend/.env.example`. Nenhuma é obrigatória; os padrões funcionam localmente.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta da API |
| `DATABASE_URL` | `file:./dev.db` | Banco SQLite (relativo a `backend/prisma/`) |
| `TCGDEX_BASE_URL` | `https://api.tcgdex.net/v2` | API da TCGdex |
| `CATALOG_CACHE_TTL_SECONDS` | `21600` | Cache em memória das consultas ao catálogo |
| `CATALOG_TIMEOUT_MS` | `8000` | Timeout de cada chamada à TCGdex |
| `CORS_ORIGIN` | `http://localhost:4200` | Origens liberadas no CORS |

## Testando a câmera num celular de verdade

Navegadores só liberam a câmera em **HTTPS** ou em **localhost**. No celular o endereço é o IP do computador, então é preciso HTTPS:

1. Deixe o celular e o computador na **mesma rede Wi-Fi**.
2. Rode `npm run dev:mobile`. O Angular sobe em `https://0.0.0.0:4200` com um certificado autoassinado.
3. Descubra o IP do computador (`ipconfig` no Windows, `ipconfig getifaddr en0` no macOS, `hostname -I` no Linux).
4. No celular, abra `https://SEU-IP:4200`. O navegador vai avisar que o certificado não é confiável: toque em **Avançado → Continuar** (é o seu próprio computador).
5. Vá em **Escanear → Abrir câmera** e permita o acesso. Enquadre a carta inteira dentro da moldura amarela e toque no botão vermelho.
6. Se o firewall bloquear, libere a porta 4200 para a rede local.

Alternativas: usar um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:4200`) ou, sem câmera, tocar em **Enviar uma foto** e escolher uma imagem da galeria (funciona em HTTP também).

Dicas para um bom reconhecimento: boa luz, sem reflexo na carta, carta preenchendo a moldura e foto nítida. Na primeira identificação o app baixa os modelos de OCR (~4,3 MB, servidos pelo próprio app) e guarda no navegador; as próximas são mais rápidas.

## Como funciona o reconhecimento

1. **Captura**: a câmera mostra uma moldura no formato da carta (63×88 mm) e a foto é recortada nela. Upload aceita JPG, PNG ou WebP de até 10 MB.
2. **Pré-processamento** (no navegador): redimensiona para no máximo 1600 px, converte para tons de cinza e estica o contraste. Opcionalmente recorta e amplia a faixa do nome (topo) e a do número (rodapé).
3. **OCR local** com Tesseract.js (inglês + português, modelos LSTM compactos). A imagem **não sai do aparelho**; só o texto lido é enviado ao backend. O worker é encerrado ao sair do scanner ou após 60 s sem uso.
4. **Extração de pistas** (`backend/src/services/ocr-parser.ts`): normaliza o texto, remove ruído (HP/PS, "Basic/Básico", "Evolves from", raridade), corrige confusões comuns (`l36` → `136`, `O25` → `025`) e reconhece padrões como `136/189`, `025/165`, `TG01/TG30` e promos (`SWSH050`). `136/189` vira número local `136` e total impresso `189`; o total só serve de pista para restringir expansões.
5. **Busca e ranking** (`backend/src/services/identification.service.ts`): consulta a TCGdex por número dentro das expansões cujo total oficial bate com o impresso, por nome + número e por nome. Cada carta recebe pontos por similaridade de nome (Levenshtein), número local exato (comparando sem zeros à esquerda) e expansão compatível; a combinação nome + número + expansão ganha bônus e fica acima de qualquer correspondência só por nome.
6. **Confirmação**: até 5 candidatos com imagem oficial, nome, expansão, número, raridade e um indicador de confiança (alta, média ou baixa, mostrado só quando há base). Dá para buscar mais. **Nada é cadastrado sem o usuário confirmar.**
7. **Fallback manual**: a aba *Busca manual* permite buscar por nome, número e expansão (EN ou PT) e cadastrar qualquer carta do catálogo, mesmo sem usar o scanner. Se o OCR falhar, o app oferece a busca já preenchida com o que conseguiu ler.

## Integração com a TCGdex

Validada com chamadas reais antes da implementação. Pontos que influenciaram o código:

- `GET /v2/{lang}/cards?name=…&localId=…&set.id=…` faz busca **parcial** (`localId=25` também traz `125`, `250`, `SWSH025`), então o backend filtra o número exato localmente. O operador `eq:` não funciona para `localId`.
- Números locais podem ter **zeros à esquerda** (`025` na coleção *151*) ou **letras** (`TG01`, `SV049`).
- `GET /v2/en/sets?cardCount.official=189` filtra expansões pelo total impresso.
- Algumas cartas não têm imagem (o campo `image` vem ausente); o app mostra um placeholder.
- A busca inclui cartas do **Pokémon TCG Pocket** (série `tcgp`, digital). Elas são filtradas, porque não existem fisicamente.
- `pt` tem menos cartas que `en` (ex.: `pt/cards/basep-1` → 404). Detalhes de carta e expansão fazem **fallback para inglês**. O idioma do exemplar físico é um campo separado.
- A TCGdex usa a string `"None"` como raridade de algumas cartas; o app trata como "não informada".
- **Imagens**: a API devolve uma URL-base; o app só acrescenta `/low.webp` (grids) e `/high.webp` (detalhes) quando a base tem o formato esperado de `assets.tcgdex.net`. Logos de expansão usam `.webp` direto na URL-base. Os símbolos de expansão (`/univ/.../symbol`) responderam 404 em `.webp` e `.png` nos testes, por isso não são exibidos.

Arquitetura da integração:

- `CardCatalogProvider` (`backend/src/integrations/catalog-provider.ts`): interface do domínio. O resto do sistema não conhece a TCGdex.
- `TcgdexCatalogService` implementa `searchCards`, `getCardById`, `getSets`, `getSetById`, `searchCardsByNumber` e `findSetsByOfficialCount`, valida todas as respostas com Zod, usa timeout e cache em memória por URL, e converte falhas em `CatalogUnavailableError`.
- O catálogo **não** é baixado inteiro. Uma carta só é gravada localmente (`CardCatalog`) quando entra na coleção.
- Com a TCGdex fora do ar, coleção, detalhes, edição, vendas e dashboard continuam funcionando. Novos exemplares de cartas já salvas também. Só a busca e o cadastro de cartas novas respondem com uma mensagem clara (HTTP 503).

## Modelo de dados

- **CardCatalog**: cópia local dos metadados da carta. Identificada por `(provider, externalId)`, então outros fornecedores podem ser adicionados sem mudar a coleção. Preços de mercado, quando existirem, serão outra responsabilidade.
- **CollectionItem**: um exemplar físico (condição, variante, idioma físico, data de aquisição, preço pago, observações, status `AVAILABLE`/`SOLD`).
- **Sale**: venda de um exemplar (data, valor, observações). Desfazer uma venda preenche `cancelledAt`, mantém o histórico e devolve o exemplar para *disponível*.

Valores monetários são **inteiros em centavos** (`purchasePriceCents`, `salePriceCents`) com `currency = "BRL"`, evitando erros de ponto flutuante.

Regras garantidas no backend:

- Vender um exemplar não afeta os outros da mesma carta.
- Vender não apaga o exemplar nem seus dados.
- Um exemplar não pode ser vendido duas vezes: atualização condicional na transação **e** índice único parcial no SQLite (`Sale_one_active_per_item`, uma venda ativa por exemplar). Testado com requisições simultâneas.
- Vendas podem ser corrigidas (`PATCH /api/sales/:id`) ou desfeitas (`POST /api/sales/:id/cancel`).
- Excluir é para cadastros feitos por engano. Ao excluir o último exemplar, a carta sai da coleção.

## API local

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/health` | Status |
| GET | `/api/catalog/cards?name&number&setId&page&pageSize&lang` | Busca no catálogo |
| GET | `/api/catalog/cards/:id?lang` | Detalhes de uma carta (fallback para `en`) |
| GET | `/api/catalog/sets?lang` / `/api/catalog/sets/:id` | Expansões |
| POST | `/api/identify` | Recebe `fullText`, `nameText`, `numberText` do OCR e devolve pistas + candidatos |
| GET | `/api/dashboard` | Totais e últimas cartas |
| GET | `/api/collection/cards?search&setId&rarity&status&sort&order` | Coleção agrupada por carta |
| GET | `/api/collection/filters` | Expansões e raridades presentes na coleção |
| GET | `/api/collection/cards/:id` | Carta + exemplares |
| POST | `/api/collection/items` | Cadastra 1 a 50 exemplares de uma carta |
| PATCH / DELETE | `/api/collection/items/:id` | Edita / exclui exemplar |
| POST | `/api/collection/items/:id/sale` | Registra venda |
| GET | `/api/sales?includeCancelled` | Histórico e total recebido |
| PATCH | `/api/sales/:id` | Corrige venda |
| POST | `/api/sales/:id/cancel` | Desfaz venda |

Todas as entradas são validadas com Zod (campos extras são rejeitados). Erros seguem o formato `{ "error": { "code", "message", "details?" } }`.

## Estrutura

```
backend/
  prisma/                 schema.prisma + migrations
  src/
    controllers/          camada HTTP
    services/             regras (coleção, vendas, identificação, parser do OCR)
    repositories/         acesso ao banco (Prisma)
    integrations/         CardCatalogProvider + cliente TCGdex (schemas Zod, assets)
    schemas/              validação das requisições (Zod)
    routes/               rotas Express
    lib/                  cache, textos, erros
  tests/                  Vitest + Supertest (banco SQLite de teste isolado)
frontend/src/app/
  core/                   API, modelos, rótulos, dinheiro
  shared/                 imagem de carta, empty state, skeleton, diálogos
  features/
    dashboard/  scanner/  collection/  card-details/  sales/
```

## Testes

`npm test` roda **41 testes no backend** e **10 no frontend**, cobrindo:

- identificação por nome, por número + expansão e por nome + número com zeros à esquerda;
- parser de OCR (`136/189`, `TG01/TG30`, `l36/l89`, promos, ruído, idioma);
- falha de OCR (texto vazio não consulta a API e orienta a busca manual; falha do Tesseract no frontend);
- falha da API externa (rede, 5xx, resposta fora do formato, 404, coleção funcionando offline);
- cache e fallback de idioma do cliente TCGdex;
- cadastro de duplicatas e de vários exemplares;
- venda de um único exemplar, venda duplicada (inclusive concorrente), correção e desfazer venda;
- edição de exemplar, validação de entrada e de imagem (formato e tamanho);
- persistência após reiniciar o cliente do banco.

Além disso, o fluxo completo foi testado num navegador (Chromium headless) com imagens reais da TCGdex: o OCR leu "Furret · 136/189" e "Pikachu · 025/165" e identificou as cartas corretas com confiança alta em cerca de 2 segundos.

## Fora do escopo deste MVP

Não implementado de propósito: preços de mercado, integração com Cardmarket/TCGplayer, gráficos, histórico de preços, dashboard financeiro, autenticação, sincronização em nuvem, marketplace e IA paga.
