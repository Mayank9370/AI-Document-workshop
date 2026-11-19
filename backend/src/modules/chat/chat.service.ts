/**
 * Conversational RAG & AI Chat Service (Phase 7)
 *
 * Orchestrates:
 * 1. Semantic retrieval from Qdrant via Phase 6 vector store with strict tenant filtering
 * 2. Grounded prompt construction preventing hallucinations
 * 3. LangChain Google Generative AI chat model integration with streaming
 * 4. Deterministic citation generation derived strictly from retrieved chunks
 * 5. Abort signal handling for client cancellation
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { config } from '../../config/env';
import { searchSimilarChunks, SearchResultItem } from '../../services/vectorStore';
import { ICitation } from './chat.model';
import { logger } from '../../utils/logger';

export interface StreamCallbacks {
  onStart?: () => void;
  onToken: (token: string) => void;
  onCitations?: (citations: ICitation[]) => void;
}

export interface GenerateChatResponseParams {
  userId: string;
  documentId: string;
  documentName: string;
  userMessage: string;
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  callbacks: StreamCallbacks;
  signal?: AbortSignal;
}

export interface ChatServiceResult {
  fullContent: string;
  citations: ICitation[];
  retrievedChunkCount: number;
}

export type ChatModelStreamer = {
  stream: (messages: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AsyncIterable<{ content: string }>>;
};

let customChatModelFactory: (() => ChatModelStreamer) | null = null;

/**
 * Configure a custom or mock chat model factory for testing without external API calls.
 */
export function setCustomChatModelFactory(factory: (() => ChatModelStreamer) | null): void {
  customChatModelFactory = factory;
}

/**
 * Construct grounded system prompt enforcing strict document fidelity.
 */
function buildSystemPrompt(documentName: string, chunks: SearchResultItem[]): string {
  if (chunks.length === 0) {
    return `You are an AI document assistant for "${documentName}".
No relevant excerpts were found in the uploaded document for this question.
You MUST state clearly and concisely that the uploaded document does not contain sufficient information to answer the question.
Do NOT attempt to make up or hallucinate answers.`;
  }

  const formattedContext = chunks
    .map(
      (chunk, idx) =>
        `--- EXCERPT ${idx + 1} [Source: Page ${chunk.pageNumber}] ---\n${chunk.text.trim()}`
    )
    .join('\n\n');

  return `You are a professional, helpful, and highly accurate AI Document Assistant analyzing the document "${documentName}".

YOUR MISSION:
Answer the user's question using ONLY the provided excerpts from the document.

STRICT CONSTRAINTS:
1. Grounding: Answer strictly using facts directly mentioned in the document excerpts below. Do NOT invent, assume, extrapolate, or hallucinate facts.
2. Missing Information: If the provided excerpts do not contain the answer, explicitly state: "The uploaded document does not contain sufficient information to answer this question."
3. Distinguish Sources: If explaining concepts for clarity, clearly distinguish what is stated directly in the document from general background explanations.
4. Formatting: Provide clear, readable, and well-structured answers using GitHub Flavored Markdown (bullet points, bold text, numbered lists).
5. Citations: The system will automatically display source citations to the user. You do not need to invent citation syntax.

DOCUMENT EXCERPTS:
${formattedContext}
`;
}

/**
 * Deduplicate citations derived strictly from actual retrieved chunks.
 * Keeps at most one citation per page or distinct chunk to avoid cluttering.
 */
export function buildCitations(chunks: SearchResultItem[]): ICitation[] {
  const seenPages = new Set<number>();
  const citations: ICitation[] = [];

  for (const chunk of chunks) {
    // Collect one citation per page with high relevance
    if (!seenPages.has(chunk.pageNumber)) {
      seenPages.add(chunk.pageNumber);
      citations.push({
        chunkId: chunk.chunkId,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.length > 200 ? `${chunk.text.slice(0, 197)}...` : chunk.text,
      });
    }
  }

  // Sort citations by page number ascending
  return citations.sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Execute Conversational RAG pipeline with LangChain and Google Gemini streaming.
 */
export async function streamChatResponse(
  params: GenerateChatResponseParams
): Promise<ChatServiceResult> {
  const {
    userId,
    documentId,
    documentName,
    userMessage,
    recentHistory = [],
    callbacks,
    signal,
  } = params;

  if (!config.GEMINI_API_KEY) {
    throw new Error('Google Gemini API key is not configured on the backend.');
  }

  // 1. Retrieve relevant chunks using Phase 6 Qdrant semantic retrieval
  logger.info(
    `[RAG] Retrieving context for doc ${documentId}, user ${userId}, query: "${userMessage.slice(0, 50)}..."`
  );

  let retrievedChunks: SearchResultItem[] = [];
  try {
    retrievedChunks = await searchSimilarChunks({
      userId,
      documentId,
      query: userMessage,
      topK: 5,
    });
  } catch (err) {
    logger.warn(
      `[RAG] Vector retrieval failed or returned zero chunks for doc ${documentId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    retrievedChunks = [];
  }

  // 2. Build citations strictly from retrieved chunks
  const citations = buildCitations(retrievedChunks);

  // Notify frontend of citations early
  if (callbacks.onCitations && citations.length > 0) {
    callbacks.onCitations(citations);
  }

  // 3. Handle case where no chunks exist or document is empty
  if (retrievedChunks.length === 0) {
    const fallbackMessage =
      'The uploaded document does not contain sufficient information to answer this question.';
    if (callbacks.onStart) callbacks.onStart();
    callbacks.onToken(fallbackMessage);
    return {
      fullContent: fallbackMessage,
      citations: [],
      retrievedChunkCount: 0,
    };
  }

  // 4. Construct LangChain messages
  const systemPrompt = buildSystemPrompt(documentName, retrievedChunks);
  const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

  // Append bounded previous conversation history if available (max 6 messages)
  const boundedHistory = recentHistory.slice(-6);
  for (const hist of boundedHistory) {
    if (hist.role === 'user') {
      messages.push(new HumanMessage(hist.content));
    } else {
      messages.push(new AIMessage(hist.content));
    }
  }

  // Append current user message
  messages.push(new HumanMessage(userMessage));

  // 5. Initialize LangChain ChatGoogleGenerativeAI (or custom test factory if configured)
  const chatModel = customChatModelFactory
    ? customChatModelFactory()
    : new ChatGoogleGenerativeAI({
        model: config.GEMINI_CHAT_MODEL || 'gemini-flash-lite-latest',
        apiKey: config.GEMINI_API_KEY,
        temperature: 0.2,
        maxOutputTokens: 2048,
      });

  // 6. Stream tokens
  if (callbacks.onStart) {
    callbacks.onStart();
  }

  let fullContent = '';

  try {
    const stream = await chatModel.stream(messages, { signal });

    for await (const chunk of stream) {
      if (signal?.aborted) {
        logger.info(`[RAG] Stream generation cancelled by client for doc ${documentId}`);
        throw new Error('Generation cancelled by client.');
      }

      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) {
        fullContent += text;
        callbacks.onToken(text);
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled by client.');
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[RAG] Gemini streaming error for doc ${documentId}: ${errMsg}`);
    throw err;
  }

  return {
    fullContent: fullContent.trim(),
    citations,
    retrievedChunkCount: retrievedChunks.length,
  };
}
