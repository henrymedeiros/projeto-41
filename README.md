# Projeto 41

Webapp local para gestão de carteira financeira pessoal: cripto, ações da B3,
dólar, caixa, reserva de emergência e renda fixa — com dashboard, histórico
patrimonial, aportes, planejamento e alocação ideal.

Roda inteiramente na sua máquina (somente `127.0.0.1`), sem login e sem nuvem.
Os dados ficam num banco SQLite local e **nunca** são versionados.

<img src="apps/web/public/logo.png" alt="Projeto 41" width="160">

## Últimos updates

Destaques recentes — histórico completo e versões em
[`CHANGELOG.md`](CHANGELOG.md).

- Página de Alocação com gráfico de rosca da meta ao lado dos controles,
  atualizando em tempo real conforme você ajusta cada classe.
- Exportação das operações de cripto em CSV direto pela carteira, com uma coluna
  de moeda por operação.
- Cotações de cripto pela CoinGecko, com busca de moedas por símbolo ou nome no
  cadastro de operações.
- Cadastro de operação flexível: preencha dois dos três campos e o terceiro é
  calculado automaticamente.
- Carteira cripto: operação em USD ou BRL e opção de descontar a taxa Binance.
- Seletor de data e steppers numéricos no tema do app.

## Requisitos

- Node.js 22.13+ e npm 10+
- Funciona em Linux, macOS, Windows e WSL

## Instalação para desenvolvimento

```bash
git clone <url-do-seu-repositorio> projeto-41
cd projeto-41
cp .env.example .env
npm ci
npm run dev
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`.

Abra **http://127.0.0.1:5173**. A API sobe em `http://127.0.0.1:3001`.

> Se o autostart estiver ligado, rode `npm run serve -- --stop` antes de
> `npm run dev` (os dois usam a porta 3001). Veja
> [Dia a dia com o autostart ligado](#dia-a-dia-com-o-autostart-ligado).

Na primeira execução o banco (`data/projeto41.sqlite`) é criado sem dados
financeiros e com metas de alocação genéricas, que podem ser ajustadas pela
interface. Não é preciso ter ou importar uma planilha.

## Execução de produção

Depois de configurar o `.env`:

```bash
npm ci
npm run build
npm start
```

Abra **http://127.0.0.1:3001**. Nesse modo a própria API entrega o frontend
compilado, então não é necessário manter o Vite em execução.

Este projeto não possui autenticação e foi feito para uso local. Não exponha a
porta diretamente na internet.

## Rodar sempre (supervisor)

```bash
npm run serve            # sobe e mantém no ar (Ctrl+C encerra)
npm run serve -- --open  # idem, abrindo o navegador quando estiver pronto
npm run serve -- --stop  # encerra o que estiver rodando em segundo plano
npm run serve -- --reset-preview  # recopia os dados de produção para a prévia
```

O supervisor (`scripts/supervisor.mjs`) cuida do modo de produção sozinho:

- instala dependências (`npm ci`) e compila (`npm run build`) quando faltam;
- reinicia o servidor se ele cair (espera 2s, 4s, 8s… até 60s entre tentativas);
- a cada minuto confere o código: depois de um `git pull`, checkout ou commit,
  recompila e reinicia. Se o `package-lock.json` mudou, roda `npm ci` antes. Se o
  build falhar, o servidor segue com a versão anterior até o código mudar de novo;
- roda uma instância só: chamar de novo apenas abre o navegador (com `--open`).

Mudanças locais ainda sem commit não disparam o rebuild. Para vê-las, o
supervisor mantém também uma **prévia ao vivo em http://127.0.0.1:4141**, que
roda o código da pasta, frontend e API:

| | Produção | Prévia (testes) |
| --- | --- | --- |
| Frontend | `3001` (build) | `4141` (Vite, hot reload) |
| API | `3001`, código do commit | `4142`, código da pasta, reinicia a cada mudança |
| Banco | `data/projeto41.sqlite` | `data/preview.sqlite`, cópia da produção |
| Cotações automáticas e snapshots | sim | não (o botão "Atualizar preços" funciona) |

O banco da prévia é recopiado da produção sempre que o supervisor liga (e com
`npm run serve -- --reset-preview`), então dá para testar à vontade sem risco
para os dados reais. Para trocar a porta, defina `PROJETO41_PREVIEW_PORT` no
`.env`; a API de testes usa a porta seguinte (`0` desliga a prévia). Log em
`data/projeto41.log`.

## Iniciar junto com o sistema

Execute uma vez:

```bash
npm run autostart              # instala e já inicia
npm run autostart -- --remove  # desinstala e encerra
```

| Sistema | O que é instalado |
| --- | --- |
| Windows (nativo) | Atalho na pasta Inicializar (sobe oculto ao entrar no Windows) e atalho **Projeto 41** na Área de Trabalho, que abre o navegador |
| WSL | O mesmo no Windows, rodando o projeto dentro da distribuição atual |
| Linux | Serviço systemd do usuário `projeto41` |
| macOS | LaunchAgent `com.projeto41.supervisor` |

### Dia a dia com o autostart ligado

**Para conferir mudanças, use a prévia em http://127.0.0.1:4141**: frontend e
API da pasta, sem parar nada.

**Só para usar o `npm run dev`, encerre o supervisor antes.** O supervisor e o `npm run dev`
usam a mesma porta da API (`3001`); com os dois ligados, a API do modo dev não
sobe ou o Vite acaba falando com a versão de produção.

```bash
npm run serve -- --stop   # 1. encerra o supervisor
npm run dev               # 2. desenvolve normalmente
npm run serve             # 3. ao terminar, religa (ou espere o próximo login)
```

**Mudou o projeto de pasta? Rode `npm run autostart` de novo.** O autostart
guarda o caminho completo do projeto (e, no WSL, o nome da distribuição). Depois
de mover, renomear a pasta ou trocar de distribuição WSL, a inicialização
automática e o atalho da Área de Trabalho apontam para o lugar antigo e deixam
de funcionar sem aviso. Rodar o comando de novo, já na pasta nova, substitui a
instalação anterior:

```bash
cd caminho/novo/projeto-41
npm run autostart
```

## Como usar

Tudo é cadastrado e editado direto no app:

- **Cripto / Bolsa B3** — registre compras e vendas; quantidade, preço médio,
  saldo, PnL, peso e alocação são calculados automaticamente. O preço médio
  considera apenas as compras.
- **Caixa e renda fixa** — posições manuais de dólar, caixa, reserva de
  emergência e renda fixa, atualizadas por você.
- **Aportes** — acompanhamento mensal dos aportes do ano.
- **Planejamento** — simulador de patrimônio com aporte, rendimento e inflação.
- **Alocação** — defina a meta de cada classe arrastando o slider e compare com
  a carteira atual (a reserva fica fora da meta).
- **Histórico** — evolução patrimonial com snapshots diários.

Recursos extras na barra superior:

- **Atualizar preços** — força um novo ciclo de cotações.
- **Olho (privacidade)** — oculta valores e quantidades para gravar tela /
  mostrar para outras pessoas; porcentagens e cotações públicas continuam
  visíveis.
- **Tema** — alterna entre escuro e claro.

Os ícones de criptos e ações são baixados automaticamente de CDNs públicos na
primeira vez que aparecem e ficam em cache local (`data/icons/`), funcionando
offline depois.

## Cotações

| Fonte | Usada para | Configuração |
| --- | --- | --- |
| [brapi](https://brapi.dev) | Ações da B3 | `BRAPI_TOKEN` no `.env` (token gratuito) |
| Banco Central (PTAX) | USD/BRL | automático, sem chave |
| [CoinGecko](https://www.coingecko.com/en/api) | Criptomoedas | `COINGECKO_API_KEY` opcional (plano Demo) |
| `TZ` | Horários das atualizações e snapshots | fuso IANA, como `America/Sao_Paulo` |

Sem `BRAPI_TOKEN` as ações ficam sem cotação. As criptos usam o CoinGecko via
API pública mesmo sem chave; `COINGECKO_API_KEY` (plano Demo) eleva o limite de
requisições. O restante do app continua funcionando normalmente, e você pode
cadastrar operações de qualquer forma.

## Dados e privacidade

- Tudo fica em `data/` (banco SQLite + ícones). Essa pasta é ignorada pelo git.
- O servidor escuta apenas em `127.0.0.1`; nada é exposto para a rede.
- `Projeto 41.xlsx`, `.env`, banco e backups nunca são versionados.
- Exportação manual dos dados: `GET http://127.0.0.1:3001/api/export`.
- Exportação das operações de cripto em CSV pelo botão "Exportar CSV" na carteira
  (`GET http://127.0.0.1:3001/api/export/operations.csv`).

## Modo demonstração

Para gravar vídeos/prints sem expor dados reais:

```bash
npm run demo
```

Abre em **http://127.0.0.1:5174** com um banco isolado e patrimônio sintético,
sem consultar provedores externos.

## Desenvolvimento

```bash
npm run serve -- --stop  # se o autostart estiver ligado: libera a porta 3001
npm run dev        # API + frontend com hot reload
npm test           # testes (Vitest)
npm run typecheck  # checagem de tipos
npm run lint       # ESLint
npm run build      # build de produção
```

## Stack

Monorepo TypeScript: React + Vite no frontend, Fastify + better-sqlite3 no
backend, Zod nos contratos, Recharts nos gráficos e Vitest nos testes.

> O repositório inclui um importador legado (`npm run import`) que migra uma
> planilha específica do autor original. Ele é opcional e não é necessário para
> usar o app — comece do zero pela interface.
