import { Schema, model, Document, Types, Model } from 'mongoose';

export type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type IndexingStatus = 'pending' | 'indexing' | 'indexed' | 'failed';

export interface IDocument extends Document {
  userId: Types.ObjectId;
  originalName: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: DocumentStatus;
  processingError?: string;
  totalPages?: number;
  totalChunks?: number;
  indexingStatus: IndexingStatus;
  indexedChunkCount?: number;
  indexingError?: string;
  indexedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    originalName: {
      type: String,
      required: [true, 'Original file name is required'],
      trim: true,
      maxlength: [255, 'Filename is too long'],
    },
    fileName: {
      type: String,
      required: [true, 'Stored file name is required'],
      unique: true,
      trim: true,
    },
    filePath: {
      type: String,
      required: [true, 'File path is required'],
    },
    fileSize: {
      type: Number,
      required: [true, 'File size is required'],
      min: [1, 'File cannot be empty'],
    },
    mimeType: {
      type: String,
      required: [true, 'MIME type is required'],
      default: 'application/pdf',
    },
    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'failed'],
      default: 'uploaded',
      required: true,
      index: true,
    },
    processingError: {
      type: String,
      default: undefined,
    },
    totalPages: {
      type: Number,
      default: undefined,
    },
    totalChunks: {
      type: Number,
      default: undefined,
    },
    indexingStatus: {
      type: String,
      enum: ['pending', 'indexing', 'indexed', 'failed'],
      default: 'pending',
      required: true,
      index: true,
    },
    indexedChunkCount: {
      type: Number,
      default: undefined,
    },
    indexingError: {
      type: String,
      default: undefined,
    },
    indexedAt: {
      type: Date,
      default: undefined,
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
        return record;
      },
    },
  }
);

// Compound indexes optimized for user-specific document queries and cursor-based pagination
documentSchema.index({ userId: 1, createdAt: -1 });
documentSchema.index({ userId: 1, createdAt: -1, _id: -1 });

export const DocumentModel: Model<IDocument> = model<IDocument>('Document', documentSchema);
