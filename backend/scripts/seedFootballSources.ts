import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCES = [
  { name: "Football Predictions News", feedUrl: "https://footballpredictions.com/news" },
  { name: "MightyTips Feed", feedUrl: "https://mightytips.com/feed" },
  { name: "The Sports Geek Feed", feedUrl: "https://thesportsgeek.com/feed" },
];

async function main() {
  const project = await prisma.project.findFirst({ where: { name: { contains: "football", mode: "insensitive" } } });
  if (!project) {
    throw new Error("Aucun projet dont le nom contient 'football' n'a été trouvé.");
  }

  for (const s of SOURCES) {
    const source = await prisma.contentSource.create({
      data: {
        projectId: project.id,
        name: s.name,
        feedUrl: s.feedUrl,
        mode: "AUTO",
        digestMode: true,
        checkIntervalMinutes: 60,
      },
    });
    console.log(`Créée : ${source.name} (${source.id})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
