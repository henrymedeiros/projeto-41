# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Mudanças ainda não lançadas ficam em **[Unreleased]**. Ao publicar, renomeie
essa seção para a nova versão com a data (ex.: `## [0.3.0] - 2026-07-01`) e abra
um novo `[Unreleased]` vazio no topo.

## [Unreleased]

### Added

- Histórico: botão "Exportar CSV" baixa os snapshots diários
  (`GET /api/export/history.csv`) com data, patrimônio em BRL, variação diária
  e uma coluna por categoria.
- `npm run serve`: supervisor que mantém o modo de produção no ar, instala e
  compila quando falta, reinicia o servidor se ele cair e recompila sozinho
  quando o código muda (`git pull`, checkout ou commit).
- Prévia ao vivo em `http://127.0.0.1:4141`, mantida pelo supervisor, para
  conferir mudanças ainda sem commit: Vite com hot reload e uma API de testes
  em `4142` (`tsx watch`) sobre os arquivos da pasta. A API de testes usa
  `data/preview.sqlite`, copiado da produção ao ligar o supervisor
  (`npm run serve -- --reset-preview` recopia), e não roda cotações automáticas
  nem snapshots (`PROJETO41_SCHEDULER=off`). Porta configurável com
  `PROJETO41_PREVIEW_PORT` (`0` desliga).
- `npm run autostart`: inicia o Projeto 41 junto com o sistema no Windows
  (nativo ou WSL), Linux (systemd do usuário) e macOS (LaunchAgent).
- Alocação: a meta de cada classe pode ser digitada em % (além do slider), e
  dá para criar categorias customizadas (ex.: Imóveis). Elas aparecem em
  Posições para receber posições, cujo valor entra no patrimônio, no
  histórico e na distribuição. Só são excluídas quando não têm posições.
- Cripto: o "auto" do preço na operação preenche com a cotação de hoje, e
  salvar uma operação atualiza as cotações de cripto.
- B3: salvar uma operação atualiza a cotação do ticker dela (uma chamada à
  brapi, só para esse ticker).
- Posições com rendimento (% do CDI, prefixado ao ano ou nenhum; 100% do CDI
  por padrão em Real e Reserva) e o card **Renda mensal** (bruta) na Visão
  geral. A taxa usada para o CDI é a meta Selic vigente publicada pelo Banco
  Central (sem ajuste), atualizada com o dólar.
- Posições: botão **+** em cada seção, que abre uma posição já na categoria, e
  campo **Instituição** (com sugestões), usado também para o ícone da posição.
  Basta o nome ou a instituição para cadastrar; sem nome, a instituição vira o
  título.
- Painel de posição reorganizado: categoria; instituição e nome; valor com a
  moeda ao lado; rendimento em botões, com a prévia de quanto rende por mês.
- Tela de Posições: resumo no topo (total, renda mensal, quantidade), total de
  cada seção sempre em reais (com o valor em dólar abaixo quando houver) e seção
  vazia com o botão "Adicionar posição".
- O modo privacidade (olho) também oculta as instituições das posições, inclusive
  o logo.
- Falha ao obter o CDI aparece explicitamente (Visão geral e Posições); a renda
  mensal segue com o último valor obtido, e a data dele é informada.
- Backup diário criptografado (AES-256-GCM, senha via scrypt) numa pasta
  sincronizada com a nuvem, feito pelo supervisor (`PROJETO41_BACKUP_DIR`,
  `PROJETO41_BACKUP_PASSWORD`). `npm run backup` gera, `--status` mostra o
  último e `--restore` restaura.

### Fixed

- Total da seção de Posições ignorava as posições em USD quando havia BRL e USD
  juntos.

### Changed

- "Caixa e renda fixa" passa a se chamar **Posições**, com as seções Dólar
  (USD), Real (BRL), Reserva de Emergência e Renda Fixa.
- Alocação: classes padrão renomeadas para Bitcoin, Altcoins, Ações Globais,
  Ações Brasileiras, Caixa (BRL), Caixa (USD) e Renda Fixa (as metas existentes
  são mantidas).
- O snapshot diário do histórico agora é gravado ao ligar o servidor e de hora
  em hora, além das 23:59 (a última gravação do dia vira o fechamento). Assim um
  dia em que o computador ficou ligado em algum momento não se perde. Carteira
  vazia não gera registro, para não zerar a base da rentabilidade do ano.

### Removed

- `npm run windows:shortcut` (só funcionava com o projeto dentro do WSL),
  substituído por `npm run autostart`. O log agora fica em `data/projeto41.log`.
- Importador legado da planilha do autor original (`npm run import`), com o
  leitor de XLSX e as dependências `adm-zip` e `fast-xml-parser`. O app começa
  do zero pela interface; a tabela `imports` deixa de ser criada em bancos novos.

## [0.5.0] - 2026-06-17

### Added

- Página de Alocação: gráfico de rosca da meta ao lado dos controles, redesenhado
  em tempo real conforme você ajusta a meta de cada classe.

### Changed

- Rótulos do gráfico de rosca deixam de se sobrepor: os que ficariam grudados são
  reposicionados verticalmente e mantidos dentro da área do gráfico.

## [0.4.0] - 2026-06-17

### Added

- Exportação das operações de cripto em CSV pela carteira (botão "Exportar CSV"
  e endpoint `GET /api/export/operations.csv`), com uma coluna de moeda por
  operação.

### Changed

- Botão "Exportar CSV" com tratamento discreto: plano por padrão, ganhando fundo
  e borda apenas no hover, com microinteração no ícone de download.

## [0.3.0] - 2026-06-16

### Added

- Busca de criptomoedas por símbolo ou nome (CoinGecko) ao cadastrar operações,
  associando a moeda ao identificador correto usado na cotação.

### Changed

- Cotações de cripto passam a vir da CoinGecko, substituindo o provedor anterior
  configurado por `CRYPTO_PRICE_URL`. Use `COINGECKO_API_KEY` (plano Demo,
  opcional) para elevar o limite de requisições.

## [0.2.0] - 2026-06-16

### Added

- Cadastro de operação flexível: preencha dois dos três campos
  (Quantidade × Preço = Total) e o terceiro é calculado automaticamente, com o
  campo "auto" destacado.
- Carteira cripto: alterne a moeda da operação entre USD e BRL (converte para
  USD ao salvar) e opção de descontar a taxa Binance de 0,1%.
- Seletor de data próprio (calendário no tema) no drawer de operação.

### Changed

- Steppers numéricos customizados no tema, com passo em centavos para preço e
  total.

### Fixed

- Drawer de operação fixado à borda direita da tela.

## [0.1.0] - 2026-06-09

### Added

- Versão inicial: dashboard, carteiras cripto e B3, posições manuais, aportes,
  planejamento, alocação ideal e histórico patrimonial com snapshots diários.
