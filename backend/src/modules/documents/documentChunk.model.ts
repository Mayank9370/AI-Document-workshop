import { Schema, model, Document, Types, Model } from 'mongoose';

export interface IDocumentChunk extends Document {
  documentId: Types.ObjectId;
  userId: Types.ObjectId;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  charCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const documentChunkSchema = new Schema<IDocumentChunk>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'Document ID is required'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    pageNumber: {
      type: Number,
      required: [true, 'Page number is required'],
      min: [1, 'Page number must be at least 1'],
    },
    chunkIndex: {
      type: Number,
      required: [true, 'Chunk index is required'],
      min: [0, 'Chunk index must be non-negative'],
    },
    text: {
      type: String,
      required: [true, 'Chunk text is required'],
      minlength: [1, 'Chunk text cannot be empty'],
    },
    charCount: {
      type: Number,
      required: [true, 'Character count is required'],
      min: [1, 'Character count must be positive'],
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

// Unique constraint: prevent duplicate chunk records when a document is reprocessed
documentChunkSchema.index(
  { documentId: 1, pageNumber: 1, chunkIndex: 1 },
  { unique: true, name: 'unique_document_chunk' }
);

// Index for user+document queries (ownership-scoped lookups)
documentChunkSchema.index({ userId: 1, documentId: 1 }, { name: 'user_document_chunks' });

// Index for fast document-scoped chunk queries (Phase 6 vector ingestion)
documentChunkSchema.index({ documentId: 1 }, { name: 'document_all_chunks' });

export const DocumentChunkModel: Model<IDocumentChunk> = model<IDocumentChunk>(
  'DocumentChunk',
  documentChunkSchema
);
