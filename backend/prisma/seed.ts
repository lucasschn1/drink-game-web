import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;

// Single source of truth for game rules — edit here to change a rule for
// every suit of that rank, or add new ranks/suits above to expand the deck.
const RULES_BY_RANK: Record<(typeof RANKS)[number], string> = {
  A: "Todo mundo bebe!",
  "2": "Escolha alguém para dar um shot.",
  "3": "Dê um shot.",
  "4": "Só as mulheres bebem.",
  "5": "Só os homens bebem.",
  "6": "Dedinho — todos colocam o dedo na mesa; o último bebe.",
  "7": 'Jogo do Pi — conte em sequência, mas troque múltiplos de 3 e números terminados em 3 por "Pi". Quem errar, bebe.',
  "8": "Amarre-se a alguém até a próxima carta 8 sair.",
  "9": "Rima — diga uma palavra; o próximo deve rimar. Quem travar, bebe.",
  "10": "Categoria — escolha uma categoria; cada jogador diz um item até alguém travar.",
  J: "C ou S — proibido falar palavras com C ou S. Quem falar, bebe.",
  Q: 'Só perguntas — só pode falar fazendo perguntas (estilo "Eu nunca?"). Quem responder direto, bebe.',
  K: "Crie uma regra nova, válida até o fim da rodada.",
};

const cards = RANKS.flatMap((rank) =>
  SUITS.map((suit) => ({ rank, suit, text: RULES_BY_RANK[rank] })),
);

async function main() {
  await prisma.card.createMany({ data: cards });
  console.log(`Seeded ${cards.length} cards.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
