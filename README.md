# Drink Game

Jogo de cartas para festas com um baralho de 52 cartas de verdade — cada carta
tem um desafio ligado ao valor (perguntas, rimas, categorias, regras da casa
no Rei, e assim por diante). Dá pra jogar de duas formas:

- **Local** — um celular só, passando de mão em mão.
- **Em grupo** — cada jogador entra pelo próprio celular usando um link, com
  as telas sincronizadas em tempo real.

## Como funciona

- **Baralho sem repetição** — as 52 cartas são embaralhadas uma vez por
  partida e não repetem até acabarem.
- **Regra da casa** — quando sai um Rei, o jogador da vez cria uma regra nova,
  válida até o fim da rodada.
- **Combo de naipe** — duas cartas seguidas do mesmo naipe dobram a regra
  automaticamente.
- **Shot roulette** — a cada 3 minutos alguém é sorteado pra dar um shot;
  todos os celulares mostram o aviso ao mesmo tempo.
- **Controles do host** — quem cria a partida pode remover um jogador ou
  encerrar a partida pra todo mundo.
- **Sala de espera** — cada jogador digita o próprio nome ao entrar; o host
  compartilha o link (ou usa o compartilhamento nativo do celular) e inicia
  quando pelo menos dois já estiverem na sala.

## Arquitetura

O estado da partida (jogador da vez, carta revelada, baralho já sorteado,
regra da casa, timer do shot) vive inteiramente no backend — o navegador
nunca é a fonte da verdade. Isso é o que permite várias pessoas jogarem a
mesma partida de celulares diferentes: cada dispositivo faz *polling* da
mesma partida a cada ~2s e aplica o estado que o servidor devolve.

- `frontend/` — React + TypeScript + Vite (SPA)
- `backend/` — Node + TypeScript + Express + Prisma (MySQL)

Autenticação de jogador é deliberadamente leve: um token aleatório por
jogador (guardado no `localStorage` do próprio dispositivo), só o suficiente
pra impedir que um celular mexa na vez de outro sem querer — o código da
partida em si já é o controle de acesso real.

## Rodando localmente

### 1. Banco de dados

Suba um MySQL local (ou Docker) e crie o banco:

```bash
mysql -u root -p -e "CREATE DATABASE drink_game; CREATE USER 'drinkgame'@'localhost' IDENTIFIED BY 'changeme'; GRANT ALL ON drink_game.* TO 'drinkgame'@'localhost';"
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # ajuste DATABASE_URL se necessário
npm install
npx prisma db push     # cria as tabelas a partir do schema (sem histórico de migração)
npm run prisma:seed
npm run dev
```

API sobe em `http://localhost:3000`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

SPA sobe em `http://localhost:5173`.

## Deploy

- **Backend** — GitHub Actions builda e publica no push pra `main`, conectando
  na rede privada do servidor via Tailscale e rodando `prisma db push` +
  restart do serviço.
- **Frontend** — Cloudflare Workers builda automaticamente a partir do mesmo
  push, servindo o build estático do Vite.

Nenhum segredo fica no repositório — as credenciais de deploy (chave SSH,
host, tokens do Tailscale) ficam em GitHub Actions secrets.

## Licença

[MIT](LICENSE)
