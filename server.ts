/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import multer from 'multer';
import mammoth from 'mammoth';
import { RecruitmentDocument, FAQ, HistoryItem, RecruitmentStats } from './src/types.ts';

const app = express();
const PORT = 3000;

// Setup database files
const DB_FILE = path.join(process.cwd(), 'db.json');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Lazy load Gemini API
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not configured. Falling back to rule-based answers.");
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Helper to call gemini generateContent with robust exponential backoff retry for transient 503/429 errors
async function generateContentWithRetry(
  gemini: GoogleGenAI,
  options: {
    model: string;
    contents: any;
    config?: any;
  },
  maxRetries = 3,
  baseDelayMs = 1200
): Promise<any> {
  let attempt = 0;
  let currentModel = options.model;
  
  while (true) {
    try {
      console.log(`[Gemini Request] Querying ${currentModel}...`);
      return await gemini.models.generateContent({
        ...options,
        model: currentModel
      });
    } catch (err: any) {
      attempt++;
      const errString = String(err);
      
      const isQuotaExceeded = 
        errString.includes('429') || 
        errString.includes('RESOURCE_EXHAUSTED') || 
        errString.includes('quota') || 
        errString.includes('Quota exceeded') ||
        errString.includes('exceeded your current quota') ||
        (err.status === 429);

      // If we hit a quota limit and we are using gemini-3.5-flash, automatically fallback to gemini-3.1-flash-lite!
      if (isQuotaExceeded && currentModel === 'gemini-3.5-flash') {
        console.warn(`[Gemini Fallback] Quota exceeded on gemini-3.5-flash (20 reqs/day free limit). Switching model to gemini-3.1-flash-lite...`);
        currentModel = 'gemini-3.1-flash-lite';
        attempt = 0; // reset attempt to give fallback model a full retry set
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      const isRetryable = 
        errString.includes('503') || 
        errString.includes('500') ||
        errString.includes('429') || 
        errString.includes('UNAVAILABLE') || 
        errString.includes('RESOURCE_EXHAUSTED') ||
        errString.includes('rate limit') ||
        errString.includes('high demand') ||
        errString.includes('temporary') ||
        errString.includes('timeout') ||
        (err.status && [503, 500, 429].includes(err.status));

      if (!isRetryable || attempt >= maxRetries) {
        console.error(`[Gemini Error] Exhausted all ${attempt} retries on ${currentModel}. Final error:`, err);
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2.0, attempt) + Math.random() * 500;
      console.warn(`[Gemini Retry] Attempt ${attempt}/${maxRetries} failed with ${currentModel}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Interfaces for our DB structure
interface DB {
  documents: RecruitmentDocument[];
  faqs: FAQ[];
  history: HistoryItem[];
  admins: string[];
}

// Initial Database Setup if empty
const INITIAL_DOCS: RecruitmentDocument[] = [];

const INITIAL_FAQS: FAQ[] = [];

// Helper to read database
function readDB(): DB {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const data: DB = {
        documents: INITIAL_DOCS,
        faqs: INITIAL_FAQS,
        history: [],
        admins: ['tructn@vwa.edu.vn'],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }
    const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent) as any;
    
    // Safety check with default initialization
    if (!parsed.admins || !Array.isArray(parsed.admins)) {
      parsed.admins = ['tructn@vwa.edu.vn'];
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('Không ghi được tệp DB ban đầu:', writeErr);
      }
    } else if (!parsed.admins.includes('tructn@vwa.edu.vn')) {
      parsed.admins.unshift('tructn@vwa.edu.vn');
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('Không cập nhật được email tructn vào danh sách admins:', writeErr);
      }
    }
    return parsed as DB;
  } catch (err) {
    console.error('Lỗi khi đọc file db.json:', err);
    return { documents: [], faqs: [], history: [], admins: ['tructn@vwa.edu.vn'] };
  }
}

// Helper to write database
function writeDB(data: DB) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Lỗi khi ghi file db.json:', err);
  }
}

// Clean up markdown block wrapping backticks from Gemini responses
function cleanMarkdownText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('```')) {
      lines.shift();
    }
    if (lines[lines.length - 1].startsWith('```')) {
      lines.pop();
    }
    cleaned = lines.join('\n');
  }
  return cleaned.trim();
}

// Match related document chunks with high-performance Vietnamese token phrase matching, window context, and full text fallback
function searchDocsContext(query: string, category: 'ug' | 'pg' | 'general' | 'all'): { context: string, sources: string[] } {
  const db = readDB();
  const activeDocs = db.documents.filter(doc => doc.isActive);
  
  if (activeDocs.length === 0) {
    return { context: '', sources: [] };
  }

  const msgLower = query.toLowerCase();
  const targetCategory = category || 'all';

  // Helper to remove accents / Vietnamese diacritics
  const removeAccents = (str: string) => {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9\s]/g, ' ');
  };

  const cleanStr = (s: string) => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ").replace(/\s+/g, " ").trim();
  
  const cleanedQuery = cleanStr(query);
  const unaccentedQuery = removeAccents(cleanedQuery);
  
  const queryWords = cleanedQuery.split(" ").filter(w => w.length > 0);
  const unaccentedQueryWords = unaccentedQuery.split(" ").filter(w => w.length > 0);

  // Generate multi-word phrases (n-grams) from the query to capture exact concept matches
  const queryPhrasesAccented: string[] = [];
  const queryPhrasesUnaccented: string[] = [];
  
  // 4-grams
  for (let i = 0; i < queryWords.length - 3; i++) {
    queryPhrasesAccented.push(queryWords.slice(i, i + 4).join(" "));
    queryPhrasesUnaccented.push(unaccentedQueryWords.slice(i, i + 4).join(" "));
  }
  // 3-grams
  for (let i = 0; i < queryWords.length - 2; i++) {
    queryPhrasesAccented.push(queryWords.slice(i, i + 3).join(" "));
    queryPhrasesUnaccented.push(unaccentedQueryWords.slice(i, i + 3).join(" "));
  }
  // 2-grams
  for (let i = 0; i < queryWords.length - 1; i++) {
    queryPhrasesAccented.push(queryWords.slice(i, i + 2).join(" "));
    queryPhrasesUnaccented.push(unaccentedQueryWords.slice(i, i + 2).join(" "));
  }

  // Common Vietnamese stop words for single word penalization
  const stopWords = new Set(['và', 'của', 'các', 'một', 'những', 'thì', 'là', 'ở', 'bị', 'được', 'cho', 'với', 'trong', 'ngoại', 'về', 'ra', 'lại', 'có', 'này', 'đó', 'để', 'ư', 'ạ', 'nhé', 'em', 'anh', 'chị', 'bạn', 'thầy', 'cô', 'trường', 'học']);
  const singleKeywordsAccented = queryWords.filter(w => w.length > 1 && !stopWords.has(w));
  const singleKeywordsUnaccented = unaccentedQueryWords.filter(w => w.length > 1 && !stopWords.has(removeAccents(w)));

  const scoredParagraphs: { 
    text: string; 
    docTitle: string; 
    score: number; 
    index: number; 
    docId: string;
  }[] = [];

  // Grouped by document to easily get surrounding window paragraphs (headings/neighboring rows)
  const docParagraphsMap = new Map<string, string[]>();
  
  for (const doc of activeDocs) {
    // Split by double newline or single newline to keep table row structures
    const paragraphs = doc.content
      .split(/\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 5); // keep short headings/rows too for complete context
    
    docParagraphsMap.set(doc.id, paragraphs);

    paragraphs.forEach((p, index) => {
      let score = 0;
      const lowerP = p.toLowerCase();
      const cleanedP = cleanStr(p);
      const unaccentedP = removeAccents(cleanedP);

      // 1. Exact full query match
      if (cleanedP.includes(cleanedQuery)) {
        score += 100;
      } else if (unaccentedP.includes(unaccentedQuery)) {
        score += 60; // Unaccented full query match
      }

      // 2. Match 4-grams (compound phrases like 'truyền thông đa phương tiện')
      queryPhrasesAccented.filter(ph => ph.split(" ").length === 4).forEach(ph => {
        if (cleanedP.includes(ph)) score += 40;
      });
      queryPhrasesUnaccented.filter(ph => ph.split(" ").length === 4).forEach(ph => {
        if (unaccentedP.includes(ph)) score += 20;
      });

      // Match 3-grams (compound phrases like 'công nghệ thông tin')
      queryPhrasesAccented.filter(ph => ph.split(" ").length === 3).forEach(ph => {
        if (cleanedP.includes(ph)) score += 25;
      });
      queryPhrasesUnaccented.filter(ph => ph.split(" ").length === 3).forEach(ph => {
        if (unaccentedP.includes(ph)) score += 12;
      });

      // Match 2-grams (terms like 'học bạ', 'học phí')
      queryPhrasesAccented.filter(ph => ph.split(" ").length === 2).forEach(ph => {
        if (cleanedP.includes(ph)) score += 10;
      });
      queryPhrasesUnaccented.filter(ph => ph.split(" ").length === 2).forEach(ph => {
        if (unaccentedP.includes(ph)) score += 5;
      });

      // Match single words
      singleKeywordsAccented.forEach(kw => {
        if (cleanedP.includes(kw)) {
          score += 2.0;
          const count = cleanedP.split(kw).length - 1;
          score += count * 0.4;
        }
      });
      singleKeywordsUnaccented.forEach(kw => {
        if (unaccentedP.includes(kw)) {
          score += 1.0;
          const count = unaccentedP.split(kw).length - 1;
          score += count * 0.2;
        }
      });

      // Category match boosting
      if (targetCategory !== 'all' && doc.category === targetCategory) {
        score += 8; // Extra boost if it matches tab selection
      }

      // Semantic keyword matching for high-priority topics
      const topics = [
        { keys: ['học phí', 'hoc phi', 'tiền học', 'kinh phí', 'học bổng', 'tín chỉ'], weight: 15, trigger: ['học phí', 'học phí', 'tiền', 'học bổng', 'đóng', 'kinh phí', 'tín chỉ'] },
        { keys: ['chỉ tiêu', 'chi tieu', 'lấy bao nhiêu', 'số lượng'], weight: 15, trigger: ['chỉ tiêu', 'lấy bao nhiêu', 'chọn', 'tập trung'] },
        { keys: ['học bạ', 'hoc ba', 'xét tuyển học bạ', 'điểm học bạ'], weight: 15, trigger: ['học bạ', 'điểm', 'trung bình', 'xét học'] },
        { keys: ['tổ hợp', 'to hop', 'khối xét', 'môn xét', 'khối thi'], weight: 15, trigger: ['tổ hợp', 'khối', 'môn', 'thi'] },
        { keys: ['thời gian', 'kế hoạch', 'thoi gian', 'đăng ký', 'nộp hồ sơ'], weight: 15, trigger: ['thời gian', 'lịch', 'hạn', 'nộp', 'hồ sơ'] },
        { keys: ['thạc sĩ', 'cao học', 'sau đại học', 'pg'], weight: 20, trigger: ['thạc sĩ', 'cao học', 'sau đại học', 'sau đại'] },
      ];

      topics.forEach(topic => {
        const hasQueryTrigger = topic.trigger.some(trig => msgLower.includes(trig) || removeAccents(msgLower).includes(removeAccents(trig)));
        if (hasQueryTrigger) {
          const hasDocKey = topic.keys.some(k => lowerP.includes(k) || unaccentedP.includes(removeAccents(k)));
          if (hasDocKey) {
            score += topic.weight;
          }
        }
      });

      if (score > 0) {
        scoredParagraphs.push({
          text: p,
          docTitle: doc.title,
          score,
          index,
          docId: doc.id
        });
      }
    });
  }

  // Sort matched paragraphs by score descending
  scoredParagraphs.sort((a, b) => b.score - a.score);

  // Take the top matched paragraphs (top 20 for rich coverage)
  const topMatches = scoredParagraphs.slice(0, 20);
  const contextSegments: string[] = [];
  const sourceSet = new Set<string>();

  // To avoid duplicate adjacent paragraphs in the output, track keys: "docId-index"
  const addedParagraphKeys = new Set<string>();

  topMatches.forEach(match => {
    sourceSet.add(match.docTitle);
    const docParagraphs = docParagraphsMap.get(match.docId) || [];
    
    // Get adjacent block (parent window window: index - 2, index - 1, index, index + 1, index + 2)
    // This maintains table headers/rows/surrounding notes perfectly!
    const startIdx = Math.max(0, match.index - 2);
    const endIdx = Math.min(docParagraphs.length - 1, match.index + 2);

    const segmentParts: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const pKey = `${match.docId}-${i}`;
      if (!addedParagraphKeys.has(pKey)) {
        addedParagraphKeys.add(pKey);
        segmentParts.push(docParagraphs[i]);
      }
    }

    if (segmentParts.length > 0) {
      contextSegments.push(`[Trích đoạn từ tài liệu: ${match.docTitle}]\n${segmentParts.join('\n')}`);
    }
  });

  // Calculate total letters of all doc content loaded to see if full-document injection is possible
  const totalContentLength = activeDocs.reduce((acc, d) => acc + d.content.length, 0);
  
  let finalContext = contextSegments.join('\n\n---\n\n');

  // If the total characters of all active documents combined is reasonable (< 150,000 characters which is approx 25,000 words),
  // we append the FULL original text of each active document as well. This makes certain that the model CANNOT lose any details!
  if (totalContentLength < 150000) {
    const fullDocsText = activeDocs.map(d => `=== TOÀN VĂN TÀI LIỆU TUYỂN SINH HOẠT ĐỘNG: "${d.title}" ===\n${d.content}\n=== KẾT THÚC TOÀN VĂN: "${d.title}" ===`).join('\n\n');
    finalContext = `[KẾT QUẢ TÌM BIỂU ĐOẠN TRÍCH CHI TIẾT TỪ CHUNK RAG]:\n${finalContext}\n\n======================================================\n\n[DỮ LIỆU TOÀN VĂN TRÍCH XUẤT ĐẦY ĐỦ CỦA CÁC FILE ĐÃ TẢI LÊN (Bắt buộc dùng dữ liệu chính thức này để rà soát chi tiết chính xác 100%)]:\n${fullDocsText}`;
  }

  return {
    context: finalContext,
    sources: Array.from(sourceSet),
  };
}

// Apply API body limits
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Serve static uploaded files if any
app.use('/api/uploads', express.static(UPLOAD_DIR));

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 2. Documents operations
app.get('/api/documents', (req, res) => {
  const db = readDB();
  res.json(db.documents);
});

// Delete document
app.delete('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  db.documents = db.documents.filter(doc => doc.id !== id);
  writeDB(db);
  res.json({ success: true, message: 'Đã xóa tài liệu khỏi hệ thống.' });
});

// Toggle document properties
app.post('/api/documents/:id/toggle', (req, res) => {
  const { id } = req.params;
  const { prop } = req.body; // 'isActive' or 'isLatest'
  
  const db = readDB();
  const docIdx = db.documents.findIndex(d => d.id === id);
  
  if (docIdx !== -1) {
    const doc = db.documents[docIdx];
    if (prop === 'isActive') {
      doc.isActive = !doc.isActive;
    } else if (prop === 'isLatest') {
      doc.isLatest = !doc.isLatest;
      if (doc.isLatest) {
        // Unmark others in the same category as latest
        db.documents.forEach(d => {
          if (d.category === doc.category && d.id !== doc.id) {
            d.isLatest = false;
          }
        });
      }
    }
    writeDB(db);
    res.json({ success: true, doc });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu.' });
  }
});

// Upload endpoint
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file tải lên.' });
    }

    const { title, category, version } = req.body;
    const filename = req.file.originalname;
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    if (!['docx', 'pdf', 'xlsx', 'xls', 'txt'].includes(ext)) {
      return res.status(400).json({ success: false, message: 'Chỉ hỗ trợ file Word (.docx), PDF (.pdf), Excel (.xlsx) và Text (.txt).' });
    }

    let extractedText = '';

    // Upgraded DOCX RAG-optimized extraction
    if (ext === 'docx') {
      const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
      const htmlContent = htmlResult.value;

      const gemini = getGeminiClient();
      if (gemini) {
        try {
          const parsePrompt = `Bạn là một Chuyên gia phân tích dữ liệu tuyển sinh Học viện Phụ nữ Việt Nam và lập trình hệ thống RAG (Retrieval-Augmented Generation) cao cấp.
Hệ thống đã nhận được một tài liệu tuyển sinh Word (.docx) và chuyển đổi thành dạng mã nguồn HTML để giữ cấu trúc bảng biểu hoàn hảo dưới đây:

HTML:
${htmlContent}

Nhiệm vụ của bạn:
Hãy chuyển đổi tài liệu này thành định dạng Markdown (hoặc văn bản có cấu trúc) tối ưu hóa tối đa cho công cụ tìm kiếm và truy xuất thông tin (RAG).

HƯỚNG DẪN XỬ LÝ KHỦNG HOẢNG GỘP Ô (ROWSPAN/COLSPAN):
Khi gặp các bảng biểu có ô gộp dòng (rowspan) hoặc gộp cột (colspan):
1. Bạn KHÔNG được để trống hay viết thiếu các ô con bị gộp khi chuyển thành Markdown. Bạn bắt buộc phải **SAO CHÉP (NHÂN BẢN)** giá trị của ô gộp đó sang tất cả các dòng/cột con tương ứng. Tất cả các dòng đều phải chứa đầy đủ thông tin độc lập.
Ví dụ: Nếu ô 'Ngành Công nghệ thông tin' gộp 5 dòng thuộc các phương thức tuyển sinh khác nhau, thì cả 5 dòng Markdown tương ứng trong bảng của bạn đều phải được điền lặp lại chữ 'Ngành Công nghệ thông tin | ...' ở cột tương đương.

HƯỚNG DẪN PHÂN RÃ HÀNG THÀNH VĂN XUÔI RAG (PROSE/LIST-ITEMS MULTI-LINE):
Để RAG phân đoạn (chunking/splitting) chính xác và không lẹo dữ liệu, bên dưới/ngay sau bảng biểu đó, bạn hãy viết thêm một danh sách liệt kê chi tiết (mỗi mục cách nhau bằng một dòng trống - DOUBLE NEWLINE). Mỗi mục hãy phân rã chi tiết một dòng của bảng thành các câu văn đầy đủ ngữ pháp và chủ ngữ.
Ví dụ cấu trúc danh sách:
* Đối với Ngành Công nghệ thông tin (mã ngành: 7480201), chương trình đại học chính quy sẽ tuyển sinh với chỉ tiêu là 100 sinh viên. Tổ hợp xét tuyển gồm có A00, A01, D01, D07.

* Đối với Ngành Công nghệ thông tin (mã ngành: 7480201), thời gian nộp hồ sơ xét học bạ đợt 1 từ ngày 15/04/2025 đến ngày 15/06/2025. Thí sinh cần có tổng điểm học bạ lớp 11 và 12 đạt từ 19.5 trở lên.

CHÚ Ý QUAN TRỌNG:
- Đảm bảo tách biệt các dòng trống giữa các mục liệt kê để bộ chia văn bản (split by double newline) có thể cắt chúng thành các file tìm kiếm độc lập và chất lượng.
- Bảo đảm giữ nguyên 100% các con số chuẩn xác như điểm chuẩn, học phí, chỉ tiêu tuyển sinh, mã ngành, mã tổ hợp, số hotline.
- Trả về nội dung Markdown trích xuất hoàn chỉnh, không kèm lời dẫn, lời chào, hay code block dư thừa.`;

          const aiRes = await generateContentWithRetry(gemini, {
            model: 'gemini-3.5-flash',
            contents: [parsePrompt]
          });
          extractedText = cleanMarkdownText(aiRes.text || 'Trống');
        } catch (err: any) {
          console.error("Lỗi khi dùng Gemini phân tích DOCX HTML, chuyển sang trích xuất raw text thô", err);
          const result = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedText = result.value;
        }
      } else {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value;
      }
    } else if (ext === 'txt') {
      extractedText = req.file.buffer.toString('utf-8');
    } else {
      // PDF or Excel - utilize Gemini to read accurately with RAG-optimized prompts
      const gemini = getGeminiClient();
      if (gemini) {
        try {
          const mimeType = ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const filePart = {
            inlineData: {
              mimeType: mimeType,
              data: req.file.buffer.toString('base64'),
            },
          };
          
          const parsePrompt = `Bạn là một Chuyên gia phân tích dữ liệu tuyển sinh Học viện Phụ nữ Việt Nam và lập trình hệ thống RAG (Retrieval-Augmented Generation) cao cấp.
Hãy phân tích file được đính kèm này (PDF hoặc Excel) và trích xuất toàn bộ thông tin văn bản, mục tài liệu, bảng chỉ tiêu tuyển sinh thành định dạng Markdown chi tiết, chính xác.

YÊU CẦU ĐẶC BIỆT ĐỂ KHÔNG BỊ LỖI THUẬT TOÁN RAG BẢNG BIỂU:
1. Khi gặp bảng biểu phức tạp có các ô trộn hàng (rowspan) hoặc trộn cột (colspan): Bạn phải **SAO CHÉP (NHÂN BẢN)** giá trị của ô gộp hiển thị lặp lại trên tất cả dòng/cột con tương ứng. Không để khuyết hoặc trống dòng nào, để khi RAG tìm kiếm dòng nào cũng có thông tin đầy đủ về Tên ngành/Hệ đào tạo.
2. Để RAG chia chunk hoàn hảo, ngay dưới hoặc sau mỗi bảng biểu phức tạp, bạn phải viết thêm một danh sách văn xuôi chi tiết (dạng bullet points), phân rã từng hàng của bảng thành một câu văn xuôi đầy đủ nghĩa có chứa chủ ngữ tên Ngành học.
3. QUAN TRỌNG: Hãy chừa một DÒNG TRỐNG (double newline) giữa mỗi câu văn liệt kê để bộ cắt văn bản (chunk splitter) cắt chúng thành từng mẩu tài liệu độc lập có ý nghĩa hoàn chỉnh.

Ví dụ:
* Đối với Ngành Truyền thông đa phương tiện (mã ngành: 7320104), Học viện Phụ nữ Việt Nam tuyển sinh với chỉ tiêu 130 sinh viên theo tổ hợp A01, C00, D01, D15.

* Đối với Ngành Truyền thông đa phương tiện (mã ngành: 7320104), mức học phí năm học 2025 là khoảng 420.000đ/tín chỉ.

Hãy bảo đảm giữ nguyên các con số chính xác 100% (học phí, chỉ tiêu, mã ngành, mã tổ hợp, hotline). Trả về đúng nội dung văn bản Markdown kết quả, không thêm bất kỳ lời dẫn, lời chào hay giải thích gì ngoài nội dung trích xuất.`;

          const aiRes = await generateContentWithRetry(gemini, {
            model: 'gemini-3.5-flash',
            contents: [
              filePart,
              { text: parsePrompt }
            ]
          });
          extractedText = cleanMarkdownText(aiRes.text || 'Trống');
        } catch (err: any) {
          console.error("Gemini parser failed, falling back to simple text conversion", err);
          extractedText = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\s]/g, ''); // strip binary
        }
      } else {
        extractedText = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\s]/g, '');
      }
    }

    // Split paragraphs count
    const chunksCount = extractedText.split(/\n\s*\n/).filter(p => p.trim().length > 30).length || 1;

    const newDoc: RecruitmentDocument = {
      id: 'doc-' + Date.now(),
      filename,
      title: title || filename,
      content: extractedText,
      fileType: (ext === 'xls' ? 'xlsx' : ext) as any,
      category: (category || 'general') as any,
      uploadDate: new Date().toISOString().split('T')[0],
      version: version || '1.0',
      isLatest: true,
      isActive: true,
      chunksCount,
    };

    const db = readDB();

    // If new doc is set as latest, unmark other latest in same category
    db.documents.forEach(doc => {
      if (doc.category === newDoc.category) {
        doc.isLatest = false;
      }
    });

    db.documents.push(newDoc);
    writeDB(db);

    res.json({ success: true, document: newDoc });
  } catch (err: any) {
    console.error('Lỗi khi xử lý file:', err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi xử lý tải lên: ' + err.message });
  }
});

// Update an existing document's parsed text manually
app.put('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, version, category, isActive, isLatest } = req.body;
  const db = readDB();
  const idx = db.documents.findIndex(doc => doc.id === id);

  if (idx !== -1) {
    db.documents[idx] = {
      ...db.documents[idx],
      title: title ?? db.documents[idx].title,
      content: content ?? db.documents[idx].content,
      version: version ?? db.documents[idx].version,
      category: category ?? db.documents[idx].category,
      isActive: isActive ?? db.documents[idx].isActive,
      isLatest: isLatest ?? db.documents[idx].isLatest,
      chunksCount: (content ?? db.documents[idx].content).split(/\n\s*\n/).filter((p: string) => p.trim().length > 30).length || 1,
    };
    writeDB(db);
    res.json({ success: true, document: db.documents[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu.' });
  }
});

// 3. FAQs management
app.get('/api/faqs', (req, res) => {
  const db = readDB();
  res.json(db.faqs);
});

app.post('/api/faqs', (req, res) => {
  const { question, answer, category, tags } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp cả câu hỏi và câu trả lời.' });
  }

  const db = readDB();
  const newFAQ: FAQ = {
    id: 'faq-' + Date.now(),
    question,
    answer,
    category: category || 'general',
    tags: Array.isArray(tags) ? tags : [tags].filter(Boolean),
  };
  db.faqs.push(newFAQ);
  writeDB(db);
  res.json({ success: true, faq: newFAQ });
});

app.delete('/api/faqs/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  db.faqs = db.faqs.filter(f => f.id !== id);
  writeDB(db);
  res.json({ success: true, message: 'Đã xóa câu hỏi thường gặp.' });
});

// 3.5. Admin Authentication & Management
app.get('/google-sign-in.html', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Đăng nhập bằng tài khoản Google - VWA Admissions</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Roboto', sans-serif;
            background-color: #f0f4f9;
        }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white w-full max-w-[450px] rounded-lg border border-[#dadce0] px-10 py-12 shadow-sm transition-all">
        <!-- Google Logo & Heading -->
        <div class="flex flex-col items-center mb-8">
            <div class="flex items-center space-x-1.5 mb-4">
                <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
                <span class="font-semibold text-[#202124] text-xl">Google</span>
            </div>
            <h1 class="text-[#202124] text-2xl font-medium mb-2">Đăng nhập tài khoản</h1>
            <p class="text-[#5f6368] text-sm text-center">Kết nối Cổng Cán bộ Học viện Phụ nữ Việt Nam</p>
        </div>

        <!-- Form container -->
        <div id="login-container">
            <!-- Step 1: Input email -->
            <div id="step-email">
                <div class="relative mb-3">
                    <input type="email" id="email-input" placeholder=" "
                        class="block w-full px-4 py-3.5 text-base text-[#202124] bg-transparent border border-[#909399] rounded-md focus:border-[#1a73e8] focus:outline-none transition-all peer" />
                    <label for="email-input"
                        class="absolute text-[#5f6368] duration-200 transform scale-75 top-1.5 z-10 origin-[0] bg-white px-2 peer-placeholder-shown:scale-100 peer-placeholder-shown:top-3.5 peer-focus:top-1.5 peer-focus:scale-75 peer-focus:text-[#1a73e8] left-3">
                        Email hoặc Số điện thoại
                    </label>
                </div>
                
                <div class="mb-5 text-right">
                    <a href="#" class="text-[#1a73e8] text-xs font-medium hover:underline">Bạn quên địa chỉ email?</a>
                </div>

                <!-- Org domain reminder banner -->
                <div class="p-3 bg-blue-50 text-blue-800 text-xs rounded-lg border border-blue-100 mb-6 flex items-start space-x-1.5">
                    <svg class="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span><strong>Bắt buộc:</strong> Chỉ chấp nhận tài khoản có tên miền <strong>@vwa.edu.vn</strong> để chứng minh thẩm quyền cán bộ.</span>
                </div>

                <div id="email-error" class="text-red-500 text-xs font-semibold mb-4 hidden"></div>

                <div class="flex items-center justify-between mt-8">
                    <a href="#" class="text-[#1a73e8] text-sm font-medium hover:underline">Tạo tài khoản</a>
                    <button id="btn-next" 
                        class="bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors px-6 py-2 rounded-md font-medium text-sm shadow-[0_1px_2px_rgba(60,64,67,0.3)]">
                        Tiếp theo
                    </button>
                </div>
            </div>

            <!-- Step 2: Password (slide-in simulator) -->
            <div id="step-password" class="hidden">
                <div class="flex items-center space-x-2 bg-[#f1f3f4] rounded-full py-1.5 px-3 mb-5 border border-[#dadce0] w-fit mx-auto text-xs">
                    <span id="display-user-email" class="text-[#3c4043] font-medium">tructn@vwa.edu.vn</span>
                </div>

                <div class="relative mb-5">
                    <input type="password" id="password-input" placeholder=" "
                        class="block w-full px-4 py-3.5 text-base text-[#202124] bg-transparent border border-[#1a73e8] rounded-md focus:outline-none transition-all peer" />
                    <label for="password-input"
                        class="absolute text-[#1a73e8] duration-200 transform scale-75 top-1.5 z-10 origin-[0] bg-white px-2 left-3">
                        Nhập mật khẩu của bạn
                    </label>
                </div>

                <div class="flex items-center space-x-2 mb-6">
                    <input type="checkbox" id="show-pass" class="h-4 w-4 rounded border-[#dadce0] text-[#1a73e8]" />
                    <label for="show-pass" class="text-[#3c4043] text-sm">Hiện mật khẩu</label>
                </div>

                <div class="flex items-center justify-between mt-8">
                    <button id="btn-back" class="text-[#1a73e8] text-sm font-medium hover:underline">Quay lại</button>
                    <button id="btn-login"
                        class="bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors px-6 py-2 rounded-md font-medium text-sm shadow-[0_1px_2px_rgba(60,64,67,0.3)] flex items-center space-x-1.5">
                        <span id="login-text">Đăng nhập</span>
                        <div id="login-spinner" class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin hidden"></div>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const stepEmail = document.getElementById('step-email');
        const stepPassword = document.getElementById('step-password');
        const emailInput = document.getElementById('email-input');
        const passwordInput = document.getElementById('password-input');
        const displayUserEmail = document.getElementById('display-user-email');
        const emailError = document.getElementById('email-error');
        
        const btnNext = document.getElementById('btn-next');
        const btnBack = document.getElementById('btn-back');
        const btnLogin = document.getElementById('btn-login');
        const loginText = document.getElementById('login-text');
        const loginSpinner = document.getElementById('login-spinner');
        const showPass = document.getElementById('show-pass');

        // Toggle Password visibility
        showPass.addEventListener('change', function() {
            passwordInput.type = this.checked ? 'text' : 'password';
        });

        // Email Validation & Step Progression
        btnNext.addEventListener('click', function() {
            const email = emailInput.value.trim();
            if (!email) {
                showError('Vui lòng nhập địa chỉ email.');
                return;
            }

            // Verify email domain is @vwa.edu.vn
            if (!email.toLowerCase().endsWith('@vwa.edu.vn')) {
                showError('Email không hợp lệ. Chỉ chấp nhận các tài khoản kết thúc bằng "@vwa.edu.vn" (ví dụ: tructn@vwa.edu.vn).');
                return;
            }

            // Proceed to password
            hideError();
            displayUserEmail.textContent = email;
            stepEmail.classList.add('hidden');
            stepPassword.classList.remove('hidden');
            passwordInput.focus();
        });

        btnBack.addEventListener('click', function() {
            stepPassword.classList.add('hidden');
            stepEmail.classList.remove('hidden');
            emailInput.focus();
        });

        // Submit Sign-In
        btnLogin.addEventListener('click', function() {
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!password || password.length < 4) {
                alert('Mật khẩu của tài khoản VWA tối thiểu 4 kí tự để giả lập đăng nhập.');
                return;
            }

            // Show Spinner & Disable Buttons
            btnLogin.disabled = true;
            btnBack.disabled = true;
            loginText.textContent = 'Đang xác thực...';
            loginSpinner.classList.remove('hidden');

            setTimeout(() => {
                // Return success to the main window
                if (window.opener) {
                    window.opener.postMessage({
                        type: 'OAUTH_AUTH_SUCCESS', 
                        user: {
                            email: email,
                            name: email.split('@')[0],
                            picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                        }
                    }, '*');
                    window.close();
                } else {
                    alert('Đăng nhập thành công! Đang tải lại trang...');
                    window.location.href = '/';
                }
            }, 1000);
        });

        // Trigger on click Enter
        emailInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') btnNext.click();
        });
        passwordInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') btnLogin.click();
        });

        function showError(msg) {
            emailError.textContent = msg;
            emailError.classList.remove('hidden');
        }

        function hideError() {
            emailError.classList.add('hidden');
        }
    </script>
</body>
</html>
  `);
});

// Admin verify route
app.post('/api/auth/verify', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cập email xác thực.' });
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith('@vwa.edu.vn')) {
    return res.json({ 
      success: false, 
      message: 'Chỉ chấp nhận tài khoản có địa chỉ kết thúc bằng miền @vwa.edu.vn' 
    });
  }

  const db = readDB();
  const superadmin = 'tructn@vwa.edu.vn';

  if (normalized === superadmin) {
    return res.json({
      success: true,
      user: {
        email: normalized,
        role: 'superadmin',
        name: 'Master Admin Trực'
      }
    });
  }

  const isAdmin = db.admins && db.admins.map(e => e.toLowerCase()).includes(normalized);
  if (isAdmin) {
    return res.json({
      success: true,
      user: {
        email: normalized,
        role: 'admin',
        name: normalized.split('@')[0]
      }
    });
  }

  return res.json({
    success: false,
    isUnregisteredAdmin: true,
    email: normalized,
    message: 'Tài khoản của bạn đã được xác định thuộc Học viện Phụ nữ Việt Nam. Tuy nhiên quyền truy cập cán bộ chưa được Quản trị tối cao (tructn@vwa.edu.vn) phê duyệt. Vui lòng liên hệ Thầy Trực để được thêm vào danh bạ.'
  });
});

// APIs managing admin accounts list
app.get('/api/admins', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  
  if (!requesterEmail.endsWith('@vwa.edu.vn')) {
    return res.status(403).json({ success: false, message: 'Từ chối truy cập. Yêu cầu quyền vwa.edu.vn.' });
  }

  const db = readDB();
  // Ensure we list it nicely
  const adminsList = db.admins || ['tructn@vwa.edu.vn'];
  res.json({ success: true, admins: adminsList });
});

app.post('/api/admins', (req, res) => {
  const requesterEmail = String(req.body.creatorEmail || '').trim().toLowerCase();
  const { newAdminEmail } = req.body;

  if (requesterEmail !== 'tructn@vwa.edu.vn') {
    return res.status(403).json({ success: false, message: 'Chỉ có tài khoản quản trị tối cao (tructn@vwa.edu.vn) mới có quyền cấp phép.' });
  }

  if (!newAdminEmail) {
    return res.status(450).json({ success: false, message: 'Vui lòng điền email cán bộ cần thêm.' });
  }

  const targetEmail = newAdminEmail.trim().toLowerCase();
  if (!targetEmail.endsWith('@vwa.edu.vn')) {
    return res.status(400).json({ success: false, message: 'Cán bộ quản trị bắt buộc phải có địa chỉ kết thúc bằng @vwa.edu.vn.' });
  }

  const db = readDB();
  if (!db.admins) {
    db.admins = ['tructn@vwa.edu.vn'];
  }

  if (db.admins.map(e => e.toLowerCase()).includes(targetEmail)) {
    return res.status(400).json({ success: false, message: 'Cán bộ này đã được cấp quyền quản trị trước đó.' });
  }

  db.admins.push(targetEmail);
  writeDB(db);

  res.json({ success: true, message: `Thêm cán bộ ${targetEmail} thành công!`, admins: db.admins });
});

app.delete('/api/admins/:email', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const { email } = req.params;

  if (requesterEmail !== 'tructn@vwa.edu.vn') {
    return res.status(403).json({ success: false, message: 'Chỉ có tài khoản quản trị tối cao (tructn@vwa.edu.vn) mới có quyền xóa cán bộ.' });
  }

  const targetEmail = String(email || '').trim().toLowerCase();
  if (targetEmail === 'tructn@vwa.edu.vn') {
    return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản Quản trị tối cao tructn@vwa.edu.vn.' });
  }

  const db = readDB();
  if (db.admins) {
    db.admins = db.admins.filter(e => e.toLowerCase() !== targetEmail);
    writeDB(db);
  }

  res.json({ success: true, message: `Đã xóa quyền cán bộ của ${targetEmail}.`, admins: db.admins });
});

// 4. Lịch sử hỏi đáp & feedback
app.get('/api/history', (req, res) => {
  const db = readDB();
  res.json(db.history);
});

app.post('/api/history/:id/feedback', (req, res) => {
  const { id } = req.params;
  const { feedback } = req.body; // 'up', 'down', null
  const db = readDB();
  const hIdx = db.history.findIndex(h => h.id === id);
  if (hIdx !== -1) {
    db.history[hIdx].feedback = feedback;
    writeDB(db);
    res.json({ success: true, history: db.history[hIdx] });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy lịch sử hỏi đáp.' });
  }
});

// 5. Thống kê & Analytics
app.get('/api/stats', (req, res) => {
  const db = readDB();
  const totalQuestions = db.history.length;
  const totalDocs = db.documents.length;
  const totalFaqs = db.faqs.length;

  // Calculate tag tallies
  const tagCounts: { [tag: string]: number } = {};
  db.history.forEach(item => {
    item.tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  db.faqs.forEach(faq => {
    faq.tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const tagStats = Object.keys(tagCounts).map(tag => ({
    tag,
    count: tagCounts[tag],
  })).sort((a, b) => b.count - a.count).slice(0, 10);

  // Group by category counts in user queries
  const categoryCounts: { [cat: string]: number } = { ug: 0, pg: 0, general: 0, unknown: 0 };
  db.history.forEach(item => {
    const cat = item.categoryMatched || 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const categoryStats = [
    { category: 'Đại Học (UG)', count: categoryCounts.ug },
    { category: 'Sau Đại Học (PG)', count: categoryCounts.pg },
    { category: 'Chung (General)', count: categoryCounts.general },
    { category: 'Không Xác Định', count: categoryCounts.unknown },
  ];

  res.json({
    totalQuestions,
    totalDocs,
    totalFaqs,
    tagStats,
    categoryStats,
    recentQuestions: db.history.slice(-5).reverse(),
  } as RecruitmentStats);
});

// Highly intelligent direct school-based answering fallback generator for when Gemini offline or quota-exceeded
function generateSmartRuleResponse(message: string, context: string, sources: string[], matchedFaqText: string): { answer: string, suggested: string[] } {
  const lowerMsg = message.toLowerCase();
  
  let greeting = `🌸 **Kính chào Quý phụ huynh và các bạn thí sinh!**\n\n`;
  greeting += `Ban tuyển sinh Học viện Phụ nữ Việt Nam xin gửi lời chào trân trọng nhất. Hiện tại hệ thống phản hồi tự động đang bận, Ban tư vấn học viện đã tra cứu trực tiếp từ các quyết định và văn bản tuyển sinh chính thức để hỗ trợ giải đáp nhanh nhất cho bạn:\n\n`;

  let body = '';
  
  if (matchedFaqText) {
    body += `### 📌 Các câu hỏi và giải đáp liên quan tìm thấy:\n\n`;
    const cleanFaqs = matchedFaqText
      .replace(/\[Các câu hỏi bổ sung liên quan tìm được từ Hệ thống FAQ\]:\n/g, '')
      .split('\n\n')
      .map(part => {
        return part.replace(/^Hỏi:/, '**Hỏi:**').replace(/^Đáp:/, '👉 **Trả lời:**');
      })
      .join('\n\n');
    body += cleanFaqs + `\n\n`;
  }

  if (context) {
    body += `### 📄 Thông số trích lục chính thức từ Đề án tuyển sinh học viện:\n\n`;
    
    // Split context by segments
    const segments = context.split('\n\n---\n\n');
    let hasRelevantDetails = false;
    
    segments.forEach((seg, sIdx) => {
      if (seg.includes('=== TOÀN VĂN') || seg.includes('=== KẾT THÚC')) return; // ignore full text dumps to keep chat clean
      
      let cleanSeg = seg.replace(/\[Trích đoạn từ tài liệu: [^\]]+\]/g, '').trim();
      cleanSeg = cleanSeg.replace(/\[Trích đoạn từ tài liệu: [^\]]+\]\n/g, '').trim();
      
      if (!cleanSeg) return;

      const titleMatch = seg.match(/\[Trích đoạn từ tài liệu: ([^\]]+)\]/);
      const sourceTitle = titleMatch ? titleMatch[1] : `Tài liệu tuyển sinh`;

      body += `#### 🔹 Trích nghị từ văn bản: *${sourceTitle}*\n\n${cleanSeg}\n\n`;
      hasRelevantDetails = true;
    });

    if (!hasRelevantDetails) {
      body += `*(Dữ liệu tuyển sinh chi tiết đang được đồng bộ, xin vui lòng kiểm tra bảng hoặc liên hệ số hotline học viện)*\n\n`;
    }
  }

  if (!context && !matchedFaqText) {
    body += `Dạ, hiện tại Ban tuyển sinh chưa tìm thấy đoạn trích chi tiết khớp trực tiếp với câu hỏi của bạn trong tài liệu tuyển sinh hiện hành.\n\n`;
    body += `**Bạn có thể tham khảo một số thông tin quan trọng của Học viện Phụ nữ Việt Nam dưới đây:**\n`;
    body += `- **Các ngành Đại học Chính quy nổi bật:** Công nghệ thông tin (7480201), Truyền thông đa phương tiện (7320104), Giới và phát triển, Quản trị kinh doanh, Luật, Công tác xã hội, Tâm lý học, Quản trị dịch vụ du lịch và lữ hành...\n`;
    body += `- **Phương xét tuyển học bạ:** Thí sinh đăng ký trực tuyến bằng học bạ THPT. Hồ sơ gồm phiếu đăng ký học viện, học bạ THPT công chứng, CMND/CCCD.\n`;
    body += `- **Tuyển sinh Sau đại học:** Đào tạo trình độ Thạc sĩ các ngành Luật hiến pháp & Luật hành chính, Công tác xã hội, Quản trị kinh doanh.\n`;
    body += `- **Đại học sđt liên hệ:** 024.3775.1750 | **Sau đại học sđt liên hệ:** 024.3775.1750.\n\n`;
    body += `*(Bạn vui lòng viết câu hỏi rõ ràng hơn kèm các từ khóa như "học bạ", "học phí", "chỉ tiêu", "đăng ký nộp hồ sơ", hoặc tên ngành bạn quan tâm để Ban tư vấn hỗ trợ dò tìm tối ưu nhất)*\n\n`;
  }

  let footer = `\n---\n`;
  footer += `📞 **Hotline tuyển sinh chính thức:** 024.3775.1750\n`;
  footer += `🏢 **Học viện Phụ nữ Việt Nam:** Số 68 đường Nguyễn Chí Thanh, phường Láng Thượng, quận Đống Đa, TP. Hà Nội.\n`;
  footer += `*⚠️ Lưu ý: Nội dung phản hồi được rà soát trực tiếp từ tài liệu tuyển sinh chính thức của Học viện.*`;

  const suggested = [
    "Phương thức xét tuyển bằng học bạ THPT cần điều kiện gì?",
    "Mức học phí năm nay của các ngành là bao nhiêu?",
    "Học viện tuyển sinh thạc sĩ những ngành nào?"
  ];

  if (lowerMsg.includes('học bạ') || lowerMsg.includes('xét tuyển')) {
    suggested[0] = "Thời gian nhận hồ sơ xét tuyển học bạ đợt 1?";
    suggested[1] = "Điểm chuẩn xét tuyển học bạ năm ngoái?";
    suggested[2] = "Cách quy đổi điểm học bạ sang điểm xét tuyển?";
  } else if (lowerMsg.includes('học phí') || lowerMsg.includes('tiền') || lowerMsg.includes('đóng')) {
    suggested[0] = "Có được miễn giảm học phí cho ngành Giới và phát triển không?";
    suggested[1] = "Mức học phí ngành Truyền thông đa phương tiện?";
    suggested[2] = "Chính sách học bổng dành cho tân sinh viên?";
  } else if (lowerMsg.includes('sau đại học') || lowerMsg.includes('thạc sĩ') || lowerMsg.includes('cao học')) {
    suggested[0] = "Điều kiện nộp hồ sơ cao học ngành Luật?";
    suggested[1] = "Môn thi tuyển sinh thạc sĩ gồm những môn nào?";
    suggested[2] = "Học phí thạc sĩ một học kỳ hết bao nhiêu?";
  }

  return {
    answer: greeting + body + footer,
    suggested
  };
}

// 6. CHATBOT CORE INTELLIGENT HANDLER
app.post('/api/chat', async (req, res) => {
  try {
    const { message, activeCategory } = req.body; // activeCategory: 'ug', 'pg', 'general', 'all'
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message trống hoặc sai định dạng.' });
    }

    const db = readDB();
    const gemini = getGeminiClient();

    // 1. Auto detect category & tag keywords
    let detectedCategory: 'ug' | 'pg' | 'general' | 'unknown' = 'unknown';
    const msgLower = message.toLowerCase();
    
    const ugKeywords = ['đại học', 'học bạ', 'cử nhân', 'ngành luật', 'công nghệ thông tin', 'truyền thông đa phương tiện', 'vpa', 'thpt', 'tốt nghiệp', 'điểm sàn', 'giới và phát triển', 'tâm lý học chính quy'];
    const pgKeywords = ['thạc sĩ', 'sau đại học', 'cao học', 'tiến sĩ', 'mba', 'luật hiến pháp', 'ngoại ngữ b1', 'thi đầu vào thạc', 'luật hành chính'];
    const generalKeywords = ['phụ nữ', 'địa chỉ', 'ở đâu', 'hotline', 'nam sinh', 'con gái', 'học viện', 'liên hệ', 'khoa'];

    let ugScore = 0;
    let pgScore = 0;
    
    ugKeywords.forEach(k => { if (msgLower.includes(k)) ugScore += 1; });
    pgKeywords.forEach(k => { if (msgLower.includes(k)) pgScore += 1; });
    
    if (ugScore > pgScore && ugScore > 0) {
      detectedCategory = 'ug';
    } else if (pgScore > ugScore && pgScore > 0) {
      detectedCategory = 'pg';
    } else if (generalKeywords.some(k => msgLower.includes(k))) {
      detectedCategory = 'general';
    }

    // Determine category search target
    const searchCategory = activeCategory && activeCategory !== 'all' ? activeCategory : (detectedCategory === 'unknown' ? 'all' : detectedCategory);

    // 2. Retrieve relevant document context
    const { context, sources } = searchDocsContext(message, searchCategory);

    // 3. Match from existing FAQs for rapid reference or keyword boosting
    let matchedFaqText = '';
    const relevantFaqs = db.faqs.filter(faq => {
      const qLower = faq.question.toLowerCase();
      // Simple word match check (FAQ trigger check)
      const matchesCount = message.toLowerCase().split(/\s+/).filter(w => w.length > 2 && qLower.includes(w)).length;
      return matchesCount > 2;
    });
    if (relevantFaqs.length > 0) {
      matchedFaqText = `[Các câu hỏi bổ sung liên quan tìm được từ Hệ thống FAQ]:\n` + 
        relevantFaqs.map(f => `Hỏi: ${f.question}\nĐáp: ${f.answer}`).join('\n\n');
    }

    // 4. Generate AI response using Gemini if available, or fallback gracefully
    let mainAnswer = '';
    let suggestedQuestions: string[] = [];

    const systemInstruction = `Bạn là Chuyên gia Tư vấn Tuyển sinh thông thái mang tên "VWA-Admissions-AI" của Học viện Phụ nữ Việt Nam (VWA).
Hãy trả lời các câu hỏi của phụ huynh, học sinh và học viên một cách tinh tế, ấm áp, tận tụy và cực kỳ chuẩn xác dựa TRÊN NGUỒN TÀI LIỆU CHÍNH THỐNG được cung cấp.

Học viện Phụ nữ Việt Nam là cơ sở giáo dục đại học công lập của Nhà nước, tuyển sinh bình đẳng cả nam sinh và nữ sinh trên cả nước. Trụ sở học viện tọa lạc tại số 68 đường Nguyễn Chí Thanh, phường Láng Thượng, quận Đống Đa, TP. Hà Nội.

Khi tư vấn và trả lời, hãy áp dụng các nguyên tắc hàng đầu sau để bảo đảm tính cá nhân hoá và tự nhiên nhất:
1. NGÔN NGỮ QUÝ PHÁI, THÂN THIỆN VÀ TỰ NHIÊN:
   - Sử dụng từ ngữ xưng hô tiếng Việt lịch thiệp, gần gũi, truyền thống (ví dụ: "Dạ, Học viện Phụ nữ Việt Nam xin chào em!", "Chào bạn, Ban tuyển sinh xin được chia sẻ...", "Xin kính thông tin tới Quý phụ huynh...").
   - Giọng điệu tư vấn viên phải lưu loát, tự nhiên như người Việt bản xứ, nói câu mạch lạc, tránh hành văn cứng nhắc hay thuần thục kiểu máy dịch dịch thuật.

2. XỬ LÝ KHÉO LÉO CÁC CÂU CHÀO HỎI & CÁC CÂU HỎI CHUNG:
   - Nếu người dùng chỉ nói câu chào xã giao (ví dụ: "chào bạn", "hello", "hi", "tư vấn tôi với", "cho hỏi"), TUYỆT ĐỐI không được báo lỗi "không tìm thấy dữ liệu". Ngược lại, hãy nồng nhiệt đón chào, giới thiệu ngắn gọn về Học viện (vị trí ở HN, đào tạo đa ngành UG & PG, công lập) và gợi ý mở để người dùng hỏi thêm về học bạ, học phí, chỉ tiêu tuyển sinh, v.v.

3. SỰ CHUẨN XÁC VÀ ĐỘ CHẬM TRONG TRÍCH XUẤT SỐ LIỆU ĐỀ ÁN:
   - Khi dẫn thông tin có số liệu (học phí, tổ hợp môn, mã ngành, hotline, chỉ tiêu tuyển sinh), bạn phải đối chiếu rà soát thật kỹ từ nguồn ngữ cảnh đi kèm và giữ nguyên tính chính xác 100%. Hãy in đậm các mã tổ hợp (ví dụ: **A00**, **D01**), mã ngành (ví dụ: **7480201**), số hotline tuyển sinh (**024.3775.1750**) và học phí cụ thể. Bạn được truyền đạt từ văn bản nào hãy ghi rõ nguồn văn bản đó để người học tin tưởng.
   - TUYỆT ĐỐI KHÔNG tự bịa ra học phí, mã hay con số mà tài liệu không ghi.

4. GIỚI HẠN THÔNG TIN & PHÁT NGÔN AN TOÀN:
   - Nếu trong dữ liệu cung cấp hoàn toàn không đề cập thông tin cần tìm, hãy khéo léo và chân thành giải thích: "Dạ, hiện tại trong nguồn dữ liệu đề án tuyển sinh chính thức được cung cấp chưa có thông tin chi tiết về [tên nội dung]. Để được hỗ trợ đầy đủ nhất, bạn vui lòng liên hệ trực tiếp qua số Hotline tuyển sinh của Học viện: 024.3775.1750 hoặc trang Fanpage Tuyển sinh Học viện Phụ nữ Việt Nam để các thầy cô hướng dẫn chi tiết ạ!"

5. ĐỊNH DẠNG MƯỢT MÀ, DỄ ĐỌC:
   - Trả ra Markdown hoàn mỹ, dùng bảng biểu nếu liệt kê danh sách ngành, học phí hay tổ hợp môn. Xuống dòng ngắt đoạn thông thoáng, rõ rệt, không ôm đồm viết nguyên một khối chữ dài khó theo dõi.
   - Kết thúc câu trả lời bằng một dòng ghi chú in nghiêng thanh lịch và khiêm nhường: "*⚠️ Thông tin được tra cứu và trích xuất trực tiếp từ các tài liệu tuyển sinh chính thống của Học viện Phụ nữ Việt Nam.*"

Định dạng đầu ra:
Bạn bắt buộc phải trả về câu trả lời ở định dạng JSON thô (raw JSON) theo schema:
{
  "answer": "Nội dung câu trả lời đầy đủ bằng văn bản Markdown tự nhiên và ấm áp dạt dào cảm xúc tư vấn.",
  "suggested": [
    "Câu hỏi gợi ý tiếp theo số 1 phù hợp ngữ cảnh?",
    "Câu hỏi gợi ý tiếp theo số 2 phù hợp ngữ cảnh?",
    "Câu hỏi gợi ý tiếp theo số 3 phù hợp ngữ cảnh?"
  ]
}`;

    const promptText = `CÂU HỎI CỦA NGƯỜI DÙNG: "${message}"

NGỮ CẢNH DỮ LIỆU ĐƯỢC TRÍCH XUẤT TỪ FILE TÀI LIỆU TUYỂN SINH CỦA TRƯỜNG:
${context ? context : "Không tìm thấy đoạn trích có sẵn trong các tài liệu tải lên."}

${matchedFaqText ? `FAQ BỔ SUNG KHAI THÁC ĐƯỢC:\n${matchedFaqText}` : ''}

Hãy trả lời câu hỏi của người dùng và sinh ra 3 câu hỏi gợi ý liên quan theo đúng định dạng cấu trúc JSON đã hướng dẫn. Chú ý chỉ trả về JSON thuần túy, KHÔNG viết bất kỳ ký tự nào nào ngoài chuỗi JSON.`;

    if (gemini) {
      try {
        const generation = await generateContentWithRetry(gemini, {
          model: 'gemini-3.5-flash',
          contents: promptText,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                answer: { type: Type.STRING },
                suggested: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ['answer', 'suggested']
            }
          }
        });

        const jsonRes = JSON.parse(generation.text || '{}');
        mainAnswer = jsonRes.answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.";
        suggestedQuestions = jsonRes.suggested || [];
      } catch (err) {
        console.error("Gemini runtime error during chat, using backup rule generation", err);
        const fbObj = generateSmartRuleResponse(message, context, sources, matchedFaqText);
        mainAnswer = fbObj.answer;
        suggestedQuestions = fbObj.suggested;
      }
    } else {
      const fbObj = generateSmartRuleResponse(message, context, sources, matchedFaqText);
      mainAnswer = fbObj.answer;
      suggestedQuestions = fbObj.suggested;
    }

    // 5. Append to database histories
    const newHistoryId = 'h-' + Date.now();
    
    // Categorize tags
    const matchedTags: string[] = [];
    if (msgLower.includes('học phí') || msgLower.includes('tiền')) matchedTags.push('học phí');
    if (msgLower.includes('ngành') || msgLower.includes('khoa')) matchedTags.push('ngành đào tạo');
    if (msgLower.includes('học bạ') || msgLower.includes('thpt') || msgLower.includes('xét tuyển')) matchedTags.push('phương thức xét tuyển');
    if (msgLower.includes('hồ sơ') || msgLower.includes('giấy tờ')) matchedTags.push('hồ sơ');
    if (msgLower.includes('lịch') || msgLower.includes('hạn') || msgLower.includes('thời gian')) matchedTags.push('lịch tuyển sinh');
    if (msgLower.includes('thạc sĩ') || msgLower.includes('cao học') || msgLower.includes('sau đại học')) matchedTags.push('thạc sĩ');
    if (msgLower.includes('giới') || msgLower.includes('bình đẳng')) matchedTags.push('Giới và Phát triển');
    if (matchedTags.length === 0) matchedTags.push('hỏi đáp chung');

    const newHistoryItem: HistoryItem = {
      id: newHistoryId,
      timestamp: new Date().toISOString(),
      question: message,
      answer: mainAnswer,
      categoryMatched: detectedCategory,
      feedback: null,
      tags: matchedTags,
      documentReferenced: sources,
    };

    db.history.push(newHistoryItem);
    writeDB(db);

    res.json({
      id: newHistoryId,
      answer: mainAnswer,
      categoryMatched: detectedCategory,
      sourceDocs: sources,
      suggestedQuestions: suggestedQuestions,
    });
  } catch (err: any) {
    console.error('Lỗi ở Chatbot API:', err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + err.message });
  }
});

// Setup Vite or build static file serving
const startExpress = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VWA Admissions Chatbot Server] running on http://0.0.0.0:${PORT}`);
  });
};

startExpress();
