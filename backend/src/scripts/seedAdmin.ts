import { config } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../modules/auth/user.model';
import { logger } from '../utils/logger';
import { z } from 'zod';

const adminSeedSchema = z.object({
  name: z.string().min(2).default('System Administrator'),
  email: z.string().email('Valid ADMIN_EMAIL is required'),
  password: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters long'),
});

/**
 * Parses CLI arguments in the format --email=foo@bar.com --password=secret --name="Admin"
 */
const parseArgs = (): Record<string, string> => {
  const args: Record<string, string> = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, ...values] = arg.slice(2).split('=');
      args[key] = values.join('=');
    }
  });
  return args;
};

export const seedAdmin = async (): Promise<void> => {
  const cliArgs = parseArgs();

  const rawName = cliArgs.name || config.ADMIN_NAME || process.env.ADMIN_NAME || 'System Administrator';
  const rawEmail = cliArgs.email || config.ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const rawPassword = cliArgs.password || config.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

  if (!rawEmail || !rawPassword) {
    logger.error('Admin initialization failed: Missing required credentials.');
    logger.info('Please provide credentials via .env:');
    logger.info('  ADMIN_EMAIL=admin@example.com');
    logger.info('  ADMIN_PASSWORD=YourSecurePassword123!');
    logger.info('Or pass CLI arguments:');
    logger.info('  npm run seed:admin -- --email=admin@example.com --password=YourPassword123!');
    process.exit(1);
  }

  const validation = adminSeedSchema.safeParse({
    name: rawName,
    email: rawEmail,
    password: rawPassword,
  });

  if (!validation.success) {
    logger.error(
      'Admin credentials validation error:\n' +
        validation.error.errors.map((e) => ` - ${e.message}`).join('\n')
    );
    process.exit(1);
  }

  const { name, email, password } = validation.data;

  try {
    logger.info('Connecting to database for admin seeding...');
    await connectDatabase();

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      if (existingUser.role === 'admin') {
        logger.info(`Admin account (${email}) already exists. Updating credentials...`);
        existingUser.name = name;
        existingUser.password = password; // Will be hashed by pre-save hook
        existingUser.lastActiveAt = new Date();
        await existingUser.save();
        logger.info(`Admin account (${email}) credentials updated successfully.`);
      } else {
        logger.info(`Promoting existing user (${email}) to admin role...`);
        existingUser.role = 'admin';
        existingUser.password = password;
        existingUser.lastActiveAt = new Date();
        await existingUser.save();
        logger.info(`User (${email}) promoted to admin role successfully.`);
      }
    } else {
      logger.info(`Creating new initial admin account for ${email}...`);
      const admin = new User({
        name,
        email,
        password,
        role: 'admin',
        lastActiveAt: new Date(),
      });
      await admin.save();
      logger.info(`Admin account initialized successfully!`);
      logger.info(`Admin ID: ${admin._id.toString()}`);
      logger.info(`Admin Email: ${admin.email}`);
      logger.info(`Role: ${admin.role}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error during admin seeding';
    logger.error(`Failed to initialize admin account: ${msg}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
    logger.info('Database connection closed.');
  }
};

if (require.main === module) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
