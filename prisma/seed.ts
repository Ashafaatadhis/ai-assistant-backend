import { PrismaClient, TodoPriority, TodoStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';
const BCRYPT_ROUNDS = 10;

const daysFromNow = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const emailVerifiedAt = new Date();

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@aria.local' },
    update: {
      name: 'Demo User',
      passwordHash,
      authProvider: 'email',
      tier: 'free',
      emailVerifiedAt,
    },
    create: {
      email: 'demo@aria.local',
      name: 'Demo User',
      passwordHash,
      authProvider: 'email',
      tier: 'free',
      emailVerifiedAt,
    },
  });

  const premiumUser = await prisma.user.upsert({
    where: { email: 'premium@aria.local' },
    update: {
      name: 'Premium User',
      passwordHash,
      authProvider: 'email',
      tier: 'premium',
      emailVerifiedAt,
    },
    create: {
      email: 'premium@aria.local',
      name: 'Premium User',
      passwordHash,
      authProvider: 'email',
      tier: 'premium',
      emailVerifiedAt,
    },
  });

  const todos = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      userId: demoUser.id,
      title: 'Plan the week',
      description: 'Review priorities and block time on the calendar.',
      status: TodoStatus.pending,
      priority: TodoPriority.high,
      dueAt: daysFromNow(1),
      reminderAt: daysFromNow(1),
      completedAt: null,
      isArchived: false,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      userId: demoUser.id,
      title: 'Prepare project update',
      description: 'Summarize progress, risks, and next steps.',
      status: TodoStatus.in_progress,
      priority: TodoPriority.urgent,
      dueAt: daysFromNow(2),
      reminderAt: daysFromNow(1),
      completedAt: null,
      isArchived: false,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      userId: demoUser.id,
      title: 'Set up Aria account',
      description: 'Complete the initial account setup.',
      status: TodoStatus.completed,
      priority: TodoPriority.medium,
      dueAt: daysFromNow(-1),
      reminderAt: null,
      completedAt: daysFromNow(-1),
      isArchived: false,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      userId: premiumUser.id,
      title: 'Review monthly goals',
      description: 'Check goal progress and revise milestones.',
      status: TodoStatus.pending,
      priority: TodoPriority.medium,
      dueAt: daysFromNow(7),
      reminderAt: daysFromNow(6),
      completedAt: null,
      isArchived: false,
      deletedAt: null,
    },
  ];

  await prisma.$transaction(
    todos.map(({ id, ...data }) =>
      prisma.todo.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      }),
    ),
  );

  console.log('Database seeded successfully.');
  console.log(`Demo accounts: demo@aria.local / ${DEMO_PASSWORD}`);
  console.log(`               premium@aria.local / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
