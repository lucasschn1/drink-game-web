import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const cards = [
  { text: "Conte uma história vergonhosa de uma festa.", category: "question", target: "current", intensity: "light" },
  { text: "Escolha alguém para beber junto com você.", category: "drink", target: "chosen", intensity: "light" },
  { text: "Todos bebem!", category: "group", target: "all", intensity: "light" },
  { text: "Imite outro jogador até alguém adivinhar quem é.", category: "challenge", target: "current", intensity: "light" },
  { text: "A pessoa à sua direita bebe.", category: "drink", target: "right", intensity: "light" },
  { text: "A pessoa à sua esquerda bebe.", category: "drink", target: "left", intensity: "light" },
  { text: "Fale um segredo (ou beba 2 goles).", category: "question", target: "current", intensity: "medium" },
  { text: "Desafie alguém para uma queda de braço — quem perder bebe.", category: "challenge", target: "chosen", intensity: "medium" },
  { text: "Cante o refrão de uma música, sem parar até todos reconhecerem.", category: "challenge", target: "current", intensity: "light" },
  { text: "Escolha duas pessoas para trocarem de lugar.", category: "group", target: "all", intensity: "light" },
  { text: "Beba sem usar as mãos.", category: "drink", target: "current", intensity: "medium" },
  { text: "Todos que já trairam alguém bebem (ou dizem que não).", category: "question", target: "all", intensity: "medium" },
  { text: "Faça uma careta engraçada por 10 segundos.", category: "challenge", target: "current", intensity: "light" },
  { text: "Crie uma regra nova que vale até o fim da rodada.", category: "group", target: "all", intensity: "medium" },
  { text: "Beba olhando nos olhos de alguém sem rir.", category: "challenge", target: "current", intensity: "medium" },
  { text: "Todos os solteiros bebem.", category: "question", target: "all", intensity: "light" },
  { text: "Escolha alguém para fazer uma pergunta que só pode responder com a verdade.", category: "question", target: "chosen", intensity: "medium" },
  { text: "Fale o alfabeto de trás pra frente — se errar, bebe.", category: "challenge", target: "current", intensity: "medium" },
  { text: "A pessoa mais nova na mesa bebe.", category: "drink", target: "chosen", intensity: "light" },
  { text: "A pessoa mais velha na mesa bebe.", category: "drink", target: "chosen", intensity: "light" },
  { text: "Todos levantam a mão que já mentiu hoje — quem não levantar, bebe.", category: "group", target: "all", intensity: "light" },
  { text: "Dance por 15 segundos sem música.", category: "challenge", target: "current", intensity: "medium" },
  { text: "Escolha alguém para dividir a bebida com você.", category: "drink", target: "chosen", intensity: "medium" },
  { text: "Conte até 3 rodadas sem falar nenhuma palavra com a letra 'A'.", category: "challenge", target: "current", intensity: "heavy" },
  { text: "Todos bebem em homenagem à pior ressaca que já tiveram.", category: "group", target: "all", intensity: "medium" },
  { text: "Beba 3 goles seguidos.", category: "drink", target: "current", intensity: "heavy" },
  { text: "Escolha alguém para tomar seu lugar na próxima rodada.", category: "group", target: "chosen", intensity: "medium" },
  { text: "Se você já dormiu numa festa, beba.", category: "question", target: "current", intensity: "light" },
  { text: "Todos brindam e bebem juntos.", category: "group", target: "all", intensity: "light" },
  { text: "Fale uma qualidade sua e um defeito — se hesitar, bebe.", category: "question", target: "current", intensity: "light" },
];

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
