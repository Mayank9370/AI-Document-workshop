import { Request, Response } from 'express';
import { User } from '../auth/user.model';
import { DocumentModel } from '../documents/document.model';
import { ChatMessage } from '../modules/../chat/chat.model';
import { sendSuccess, sendError } from '../../utils/response';
import { logger } from '../../utils/logger';

export interface AdminActivityItem {
  id: string;
  type:
    | 'user_registered'
    | 'document_uploaded'
    | 'document_ready'
    | 'document_failed'
    | 'document_indexed'
    | 'chat_message';
  description: string;
  timestamp: string;
  metadata?: {
    userId?: string;
    userName?: string;
    documentId?: string;
    documentName?: string;
    status?: string;
  };
}

/**
 * Retrieve consolidated system statistics (Admin Only).
 * GET /api/admin/stats
 */
export const getAdminStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // 1. User Metrics
    const [totalUsers, activeUsers, newUsers7d, newUsers30d] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ lastActiveAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    ]);

    // 2. Document Metrics (Single Aggregation Pipeline)
    const [docAgg] = await DocumentModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          processing: {
            $sum: { $cond: [{ $in: ['$status', ['uploaded', 'processing']] }, 1, 0] },
          },
          ready: {
            $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
          indexed: {
            $sum: { $cond: [{ $eq: ['$indexingStatus', 'indexed'] }, 1, 0] },
          },
          indexingFailed: {
            $sum: { $cond: [{ $eq: ['$indexingStatus', 'failed'] }, 1, 0] },
          },
        },
      },
    ]);

    const documents = {
      total: docAgg?.total || 0,
      processing: docAgg?.processing || 0,
      ready: docAgg?.ready || 0,
      failed: docAgg?.failed || 0,
      indexed: docAgg?.indexed || 0,
      indexingFailed: docAgg?.indexingFailed || 0,
    };

    // 3. Chat Metrics (Total Messages and Distinct User-Document Conversations)
    const [totalMessages, convAgg] = await Promise.all([
      ChatMessage.countDocuments({}),
      ChatMessage.aggregate([
        {
          $group: {
            _id: { userId: '$userId', documentId: '$documentId' },
          },
        },
        {
          $count: 'total',
        },
      ]),
    ]);

    const totalConversations = convAgg.length > 0 ? convAgg[0].total : 0;

    sendSuccess(res, 'Admin statistics retrieved successfully.', {
      users: {
        total: totalUsers,
        active: activeUsers,
        new7d: newUsers7d,
        new30d: newUsers30d,
      },
      documents,
      chat: {
        totalMessages,
        totalConversations,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error calculating admin statistics';
    logger.error(`Admin stats error: ${msg}`);
    sendError(res, 'Failed to retrieve admin statistics.', 500);
  }
};

/**
 * Retrieve recent system activity feed (Admin Only).
 * GET /api/admin/activity
 */
export const getAdminActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

    // Fetch latest user registrations, documents, and chat messages in parallel
    const [recentUsers, recentDocs, recentChats] = await Promise.all([
      User.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name email createdAt'),
      DocumentModel.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select('originalName status indexingStatus createdAt updatedAt userId'),
      ChatMessage.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select('userId documentId role createdAt'),
    ]);

    // Lookup document names for chat messages
    const docIds = Array.from(new Set(recentChats.map((c) => c.documentId.toString())));
    const docMap = new Map<string, string>();
    if (docIds.length > 0) {
      const docs = await DocumentModel.find({ _id: { $in: docIds } }).select('originalName');
      docs.forEach((d) => docMap.set(d._id.toString(), d.originalName));
    }

    const activities: AdminActivityItem[] = [];

    // Map User Registrations
    recentUsers.forEach((u) => {
      activities.push({
        id: `user-${u._id}`,
        type: 'user_registered',
        description: `New user registered: ${u.name}`,
        timestamp: u.createdAt.toISOString(),
        metadata: {
          userId: u._id.toString(),
          userName: u.name,
        },
      });
    });

    // Map Document Events
    recentDocs.forEach((d) => {
      const eventType: AdminActivityItem['type'] =
        d.status === 'failed'
          ? 'document_failed'
          : d.indexingStatus === 'indexed'
          ? 'document_indexed'
          : 'document_uploaded';

      const description =
        d.status === 'failed'
          ? `Document processing failed: "${d.originalName}"`
          : d.indexingStatus === 'indexed'
          ? `Document vector indexing ready: "${d.originalName}"`
          : `Document uploaded: "${d.originalName}"`;

      activities.push({
        id: `doc-${d._id}`,
        type: eventType,
        description,
        timestamp: (d.updatedAt || d.createdAt).toISOString(),
        metadata: {
          documentId: d._id.toString(),
          documentName: d.originalName,
          status: d.status,
        },
      });
    });

    // Map Chat Events
    recentChats.forEach((c) => {
      const docName = docMap.get(c.documentId.toString()) || 'Document';
      activities.push({
        id: `chat-${c._id}`,
        type: 'chat_message',
        description: `New ${c.role} chat message in "${docName}"`,
        timestamp: c.createdAt.toISOString(),
        metadata: {
          userId: c.userId.toString(),
          documentId: c.documentId.toString(),
          documentName: docName,
        },
      });
    });

    // Sort descending by timestamp and clamp to requested limit
    activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const boundedActivities = activities.slice(0, limit);

    sendSuccess(res, 'Recent activity retrieved successfully.', {
      activities: boundedActivities,
      total: boundedActivities.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error fetching recent activity';
    logger.error(`Admin activity error: ${msg}`);
    sendError(res, 'Failed to retrieve recent activity.', 500);
  }
};
