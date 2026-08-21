# Drink Game

Jogo de cartas para festas, jogado num único dispositivo compartilhado entre os
jogadores (v1). A arquitetura já é server-authoritative (estado da partida vive
no MySQL, não no navegador) para permitir evoluir depois para multiplayer,
cada jogador no próprio celular.

## Estrutura

- `frontend/` — React + TypeScript + Vite (SPA)
- `backend/` — Node + TypeScript + Express + Prisma (MySQL)

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
npx prisma migrate dev --name init
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

## Fluxo do jogo (v1)

1. Alguém abre o app e clica "Começar partida" — cria a partida e gera um
   link com o código (`?m=CODE`).
2. Cadastra os nomes dos jogadores e clica "Iniciar jogo".
3. Cada turno: clica "Revelar carta" para ver o desafio do jogador da vez,
   depois "Próximo jogador" para passar a vez.

O estado (jogador da vez, carta revelada, baralho sem repetição) fica no
backend, então dá para atualizar a página sem perder o progresso.
