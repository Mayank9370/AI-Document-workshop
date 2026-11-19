import { Schema, model, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'user' | 'admin';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  toSafeObject(): SafeUser;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
      select: true, // We will explicitly remove it via toJSON and toSafeObject
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      required: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const record = ret as Record<string, unknown>;
        record.id = record._id?.toString();
        delete record._id;
        delete record.__v;
        delete record.password;
        return record;
      },
    },
  }
);

// Hash password before saving if modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err: unknown) {
    next(err as Error);
  }
});

// Instance method to compare password
userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Instance method to get safe user representation
userSchema.methods.toSafeObject = function (): SafeUser {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    lastActiveAt: this.lastActiveAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User: Model<IUser> = model<IUser>('User', userSchema);
