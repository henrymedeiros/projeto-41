# Operacao Local

## Iniciar

```bash
npm run serve -- --stop  # so se o autostart estiver ligado: libera a porta 3001
npm run dev
```

Acesse `http://127.0.0.1:5173`. A API aceita conexoes somente em
`127.0.0.1:3001`.

Para conferir mudancas ainda sem commit, basta a previa em
`http://127.0.0.1:4141` (veja abaixo), sem parar o supervisor.

**Importante:** o supervisor (autostart) e o `npm run dev` usam a mesma porta
da API. Encerre o supervisor antes de desenvolver e religue com `npm run serve`
ao terminar (ou espere o proximo login).

## Rodar sempre

```bash
npm run serve            # supervisor em primeiro plano
npm run autostart        # sobe junto com o sistema (Windows, WSL, Linux, macOS)
npm run serve -- --stop  # encerra o supervisor em segundo plano
```

Producao em `http://127.0.0.1:3001`. O supervisor recompila e reinicia sozinho
quando o commit atual muda e reinicia o servidor se ele cair.

Previa ao vivo em `http://127.0.0.1:4141`: o supervisor mantem o Vite rodando
sobre os arquivos da pasta, com hot reload, e uma API de testes em
`http://127.0.0.1:4142` (`tsx watch`, reinicia a cada mudanca). A API de testes
usa `data/preview.sqlite`, copiado da producao sempre que o supervisor liga
(`npm run serve -- --reset-preview` recopia), e roda sem cotacoes automaticas
nem snapshots. `PROJETO41_PREVIEW_PORT` no `.env` troca a porta da previa; a
API de testes usa a seguinte (`0` desliga as duas). Log em
`data/projeto41.log`; estado em `data/build-stamp.json` e
`data/supervisor.lock.json`.

**Mudou a pasta do projeto? Rode `npm run autostart` de novo, ja na pasta
nova.** O autostart guarda o caminho completo do projeto (e, no WSL, a
distribuicao). Depois de mover, renomear a pasta ou trocar de distribuicao, a
inicializacao automatica e o atalho apontam para o lugar antigo e param de
funcionar sem aviso. Rodar de novo substitui a instalacao anterior.

## Precos

Configure `BRAPI_TOKEN` em `.env` para atualizar ativos B3. Cripto usa o
servidor existente e USD/BRL usa a PTAX do Banco Central.

- Cripto: 15 minutos.
- B3: 30 minutos durante o pregao.
- USD/BRL: 2 horas.
- Manual: botao `Atualizar precos`.

Falhas mantem o ultimo valor valido e aparecem na interface.

## Dados

O banco fica em `data/projeto41.sqlite`. Banco, backups e `.env` sao
ignorados pelo Git. Backup diario criptografado na nuvem: veja "Backup na
nuvem" no README (`npm run backup`).

## Verificacao

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Demonstracao

```bash
npm run demo
```

A demonstracao abre em `http://127.0.0.1:5174`, usa API em
`127.0.0.1:3101` e banco `data/projeto41-demo.sqlite`. Os dados sao
completamente sinteticos e restaurados a cada inicializacao.
