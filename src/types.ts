/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RecruitmentDocument {
  id: string;
  filename: string;
  title: string;
  content: string;
  fileType: 'docx' | 'pdf' | 'xlsx' | 'txt';
  category: 'ug' | 'pg' | 'general'; // ug = undergraduate (Đại học), pg = postgraduate (Sau Đại học)
  uploadDate: string;
  version: string;
  isLatest: boolean;
  isActive: boolean;
  chunksCount: number;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: 'ug' | 'pg' | 'general';
  tags: string[];
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  question: string;
  answer: string;
  categoryMatched: 'ug' | 'pg' | 'general' | 'unknown';
  feedback: 'up' | 'down' | null;
  tags: string[];
  documentReferenced?: string[]; // list of titles or filenames referenced
}

export interface RecruitmentStats {
  totalQuestions: number;
  totalDocs: number;
  totalFaqs: number;
  tagStats: { tag: string; count: number }[];
  categoryStats: { category: string; count: number }[];
  recentQuestions: HistoryItem[];
}

export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  category?: 'ug' | 'pg' | 'general';
  sourceDocs?: string[];
  suggestedQuestions?: string[];
}

export interface SchoolConfig {
  name: string;
  shortName: string;
  logoUrl?: string;
  logoIcon?: string;
  address: string;
  hotline: string;
  email: string;
  website: string;
  // Phân hệ Quản lý định tuyến AI & Tối ưu chi phí
  aiRoutingMode?: 'hybrid' | 'ai_only' | 'faq_only';
  faqConfidenceThreshold?: number; // range 0 to 100
  defaultModel?: string; // 'gemini-3.5-flash', 'gemini-1.5-flash', etc.
  aiMaxTokens?: number; // max output tokens
  enableCache?: boolean; // toggle response memory caching
}
