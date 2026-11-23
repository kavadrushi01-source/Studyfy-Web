import { PrismaClient } from "@prisma/client";
import { seedSchoolOfScienceOnlinePaymentFee } from "@studyfy/demo-seed";

const db = new PrismaClient();

try {
  const result = await seedSchoolOfScienceOnlinePaymentFee(db);
  console.log(
    `School of Science: ${result.invoicesCreated} new ₹100 demo payment invoice(s) for ${result.studentCount} student(s).`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
