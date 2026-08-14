import {
  AlarmRecurrence,
  AuthProvider,
  CreationSource,
  Gender,
  PrismaClient,
  TodoPriority,
  TodoStatus,
  UserRole,
  UserTier,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';
const BCRYPT_ROUNDS = 10;

const IDS = {
  demoCategory: '20000000-0000-4000-8000-000000000001',
  premiumCategory: '20000000-0000-4000-8000-000000000002',
  standaloneAlarm: '30000000-0000-4000-8000-000000000001',
  todoAlarm: '30000000-0000-4000-8000-000000000002',
  firstTodo: '10000000-0000-4000-8000-000000000001',
} as const;

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
      authProvider: AuthProvider.email,
      tier: UserTier.free,
      role: UserRole.member,
      emailVerifiedAt,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: 'demo@aria.local',
      name: 'Demo User',
      passwordHash,
      authProvider: AuthProvider.email,
      tier: UserTier.free,
      role: UserRole.member,
      emailVerifiedAt,
    },
  });

  const premiumUser = await prisma.user.upsert({
    where: { email: 'premium@aria.local' },
    update: {
      name: 'Premium User',
      passwordHash,
      authProvider: AuthProvider.email,
      tier: UserTier.premium,
      role: UserRole.member,
      emailVerifiedAt,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: 'premium@aria.local',
      name: 'Premium User',
      passwordHash,
      authProvider: AuthProvider.email,
      tier: UserTier.premium,
      role: UserRole.member,
      emailVerifiedAt,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@aria.local' },
    update: {
      name: 'Development Admin',
      passwordHash,
      authProvider: AuthProvider.email,
      tier: UserTier.premium,
      role: UserRole.admin,
      emailVerifiedAt,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email: 'admin@aria.local',
      name: 'Development Admin',
      passwordHash,
      authProvider: AuthProvider.email,
      tier: UserTier.premium,
      role: UserRole.admin,
      emailVerifiedAt,
    },
  });

  const todos = [
    {
      id: IDS.firstTodo,
      userId: demoUser.id,
      categoryId: IDS.demoCategory,
      title: 'Plan the week',
      description: 'Review priorities and block time on the calendar.',
      status: TodoStatus.pending,
      priority: TodoPriority.high,
      dueAt: daysFromNow(1),
      reminderAt: daysFromNow(1),
      completedAt: null,
      isArchived: false,
      source: CreationSource.manual,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      userId: demoUser.id,
      categoryId: IDS.demoCategory,
      title: 'Prepare project update',
      description: 'Summarize progress, risks, and next steps.',
      status: TodoStatus.in_progress,
      priority: TodoPriority.urgent,
      dueAt: daysFromNow(2),
      reminderAt: daysFromNow(1),
      completedAt: null,
      isArchived: false,
      source: CreationSource.ai_chat,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      userId: demoUser.id,
      categoryId: null,
      title: 'Set up Aria account',
      description: 'Complete the initial account setup.',
      status: TodoStatus.completed,
      priority: TodoPriority.medium,
      dueAt: daysFromNow(-1),
      reminderAt: null,
      completedAt: daysFromNow(-1),
      isArchived: false,
      source: CreationSource.manual,
      deletedAt: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      userId: premiumUser.id,
      categoryId: IDS.premiumCategory,
      title: 'Review monthly goals',
      description: 'Check goal progress and revise milestones.',
      status: TodoStatus.pending,
      priority: TodoPriority.medium,
      dueAt: daysFromNow(7),
      reminderAt: daysFromNow(6),
      completedAt: null,
      isArchived: false,
      source: CreationSource.manual,
      deletedAt: null,
    },
  ];

  const profiles = [
    {
      userId: demoUser.id,
      bio: 'Demo account for exploring Aria.',
      phoneNumber: '+6281234567890',
      gender: Gender.undisclosed,
      timezone: 'Asia/Jakarta',
      locale: 'id-ID',
    },
    {
      userId: premiumUser.id,
      bio: 'Premium demo account.',
      phoneNumber: null,
      gender: null,
      timezone: 'Asia/Jakarta',
      locale: 'en-ID',
    },
    {
      userId: adminUser.id,
      bio: 'Development administrator account.',
      phoneNumber: null,
      gender: null,
      timezone: 'Asia/Jakarta',
      locale: 'id-ID',
    },
  ];

  const categories = [
    {
      id: IDS.demoCategory,
      userId: demoUser.id,
      name: 'Work',
      color: '#3B82F6',
    },
    {
      id: IDS.premiumCategory,
      userId: premiumUser.id,
      name: 'Personal',
      color: '#8B5CF6',
    },
  ];

  const alarms = [
    {
      id: IDS.todoAlarm,
      userId: demoUser.id,
      todoId: IDS.firstTodo,
      title: 'Plan the week reminder',
      triggerAt: daysFromNow(1),
      recurrence: AlarmRecurrence.none,
      recurrenceRule: null,
      isEnabled: true,
      soundName: 'default',
      snoozeMinutes: 10,
      source: CreationSource.manual,
      deletedAt: null,
    },
    {
      id: IDS.standaloneAlarm,
      userId: premiumUser.id,
      todoId: null,
      title: 'Morning review',
      triggerAt: daysFromNow(1),
      recurrence: AlarmRecurrence.daily,
      recurrenceRule: null,
      isEnabled: true,
      soundName: 'default',
      snoozeMinutes: 5,
      source: CreationSource.ai_chat,
      deletedAt: null,
    },
  ];

  await prisma.$transaction([
    ...profiles.map(({ userId, ...data }) =>
      prisma.profile.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      }),
    ),
    ...categories.map(({ id, ...data }) =>
      prisma.category.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      }),
    ),
    ...todos.map(({ id, ...data }) =>
      prisma.todo.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      }),
    ),
    ...alarms.map(({ id, ...data }) =>
      prisma.alarm.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      }),
    ),
  ]);

  console.log('Database seeded successfully.');
  console.log(`Demo accounts: demo@aria.local / ${DEMO_PASSWORD}`);
  console.log(`               premium@aria.local / ${DEMO_PASSWORD}`);
  console.log(`               admin@aria.local / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
