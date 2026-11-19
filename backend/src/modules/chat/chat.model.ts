import { Schema, model, Document, Types, Model } from 'mongoose';

export type MessageRole = 'user' | 'assistant';

export interface ICitation {
  chunkId: string;
  pageNumber: number;
  chunkIndex: number;
  text?: string;
}

export interface IChatMessage extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  role: MessageRole;
  content: string;
  citations: ICitation[];
  createdAt: Date;
  updatedAt: Date;
}

const citationSchema = new Schema<ICitation>(
  {
    chunkId: {
      type: String,
      required: true,
      trim: true,
    },
    pageNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    text: {
      type: String,
      default: undefined,
    },
  },
  { _id: false }
);

const chatMessageSchema = new Schema<IChatMessage>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'Document ID is required'],
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: [true, 'Message role is required'],
    },
    content: {
      type: String,
      required: [true, 'Message content cannot be empty'],
      trim: true,
    },
    citations: {
      type: [citationSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient document chat history queries and cursor-based pagination
chatMessageSchema.index({ documentId: 1, userId: 1, createdAt: 1 });
chatMessageSchema.index({ userId: 1, createdAt: -1 });
chatMessageSchema.index({ userId: 1, documentId: 1, createdAt: -1, _id: -1 });

export const ChatMessage: Model<IChatMessage> = model<IChatMessage>(
  'ChatMessage',
  chatMessageSchema
);
