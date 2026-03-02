// eslint-disable-next-line prettier/prettier
import { PrismaClient, ProductStatus, UserRole, UserStatus } from "@prisma/client";
import { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
// eslint-disable-next-line prettier/prettier
import * as bcrypt from "bcrypt";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const saltRounds = 12;

  // eslint-disable-next-line prettier/prettier
  const adminPasswordHash = await bcrypt.hash("Admin@123456", saltRounds);
  // eslint-disable-next-line prettier/prettier
  const userPasswordHash = await bcrypt.hash("User@123456", saltRounds);

  await prisma.user.upsert({
    // eslint-disable-next-line prettier/prettier
    where: { email: "admin@example.com" },
    update: {},
    create: {
      // eslint-disable-next-line prettier/prettier
      email: "admin@example.com",
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.user.upsert({
    // eslint-disable-next-line prettier/prettier
    where: { email: "user@example.com" },
    update: {},
    create: {
      // eslint-disable-next-line prettier/prettier
      email: "user@example.com",
      passwordHash: userPasswordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.product.upsert({
    where: { sku: 'SKU_1' },
    update: {
      name: 'Product 1',
      price: new Prisma.Decimal('10.00'),
      status: ProductStatus.ACTIVE,
    },
    create: {
      sku: 'SKU_1',
      name: 'Product 1',
      price: new Prisma.Decimal('10.00'),
      status: ProductStatus.ACTIVE,
    },
  });

  await prisma.product.upsert({
    where: { sku: 'SKU_2' },
    update: {
      name: 'Product 2',
      price: new Prisma.Decimal('25.50'),
      status: ProductStatus.ACTIVE,
    },
    create: {
      sku: 'SKU_2',
      name: 'Product 2',
      price: new Prisma.Decimal('25.50'),
      status: ProductStatus.ACTIVE,
    },
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
