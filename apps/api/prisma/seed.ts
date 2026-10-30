import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const usuario = process.env.ADMIN_USUARIO;
  const password = process.env.ADMIN_PASSWORD;
  const nombre = process.env.ADMIN_NOMBRE ?? 'Administrador';
  if (!usuario || !password) {
    throw new Error('Define ADMIN_USUARIO y ADMIN_PASSWORD en .env');
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 8 caracteres');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.usuario.upsert({
    where: { usuario },
    update: { passwordHash, rol: 'ADMIN', activo: true, nombre },
    create: { usuario, nombre, passwordHash, rol: 'ADMIN' },
  });
  console.log(`Admin listo: ${admin.usuario} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
