/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';
import { GoogleGenAI, Type } from '@google/genai';
import multer from 'multer';
import mammoth from 'mammoth';
import { RecruitmentDocument, FAQ, HistoryItem, RecruitmentStats, SchoolConfig } from './src/types.ts';
import { initializeApp as initializeFirebase } from 'firebase/app';
import { getFirestore as getFirebaseFirestore, initializeFirestore, setLogLevel, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

// OAuth Configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'fake_id',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'fake_secret',
  callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/google/callback`
},
(accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj: any, done) => done(null, obj));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = express();

app.use(session({
  secret: 'vwa-secret-key-123456',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Setup database files
const DB_FILE = path.join(process.cwd(), 'db.json');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const DATA_DIR = path.join(UPLOAD_DIR, 'Data');
const IMAGE_DIR = path.join(UPLOAD_DIR, 'Image');
const RAG_DIR = path.join(UPLOAD_DIR, 'RAG');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
if (!fs.existsSync(RAG_DIR)) fs.mkdirSync(RAG_DIR, { recursive: true });

// Load Firebase configuration
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
let firestoreDb: any = null;

if (fs.existsSync(firebaseConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
    console.log('[Firebase Init] Loading config:', JSON.stringify(config, null, 2));
    const firebaseApp = initializeFirebase(config);
    
    // Set level to 'error' to silent transient stream connection warnings
    setLogLevel('error');
    
    // Use initializeFirestore with experimentalForceLongPolling to prevent WebSocket/gRPC stream drops on container environment
    firestoreDb = config.firestoreDatabaseId 
      ? initializeFirestore(firebaseApp, { experimentalForceLongPolling: true }, config.firestoreDatabaseId)
      : initializeFirestore(firebaseApp, { experimentalForceLongPolling: true });
      
    console.log('[Firebase Init] Khởi tạo Firebase Firestore thành công từ file config! Database ID:', config.firestoreDatabaseId || 'default');
  } catch (err) {
    console.error('[Firebase Init Error] Không thể kết nối Firestore:', err);
  }
} else {
  console.log('[Firebase Init] firebase-applet-config.json không tồn tại.');
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
        errString.toLowerCase().includes('timeout') ||
        errString.toLowerCase().includes('fetch failed') ||
        errString.toLowerCase().includes('undici') ||
        errString.toLowerCase().includes('socket') ||
        errString.toLowerCase().includes('typeerror') ||
        errString.toLowerCase().includes('network') ||
        errString.includes('ECONNRESET') ||
        errString.includes('ETIMEDOUT') ||
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

interface TrainingCategory {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

interface ConsultationItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  level: 'ug' | 'pg'; // ug = Đại học, pg = SĐH
  notes?: string;
  status: 'pending' | 'contacted' | 'cancelled';
  createdAt: string;
}

// Interfaces for our DB structure
interface DB {
  documents: RecruitmentDocument[];
  faqs: FAQ[];
  history: HistoryItem[];
  admins: string[];
  adminPermissions?: Record<string, string[]>;
  schoolConfig?: SchoolConfig;
  categories?: TrainingCategory[];
  consultations?: ConsultationItem[];
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
        schoolConfig: {
          name: "Học viện Phụ nữ Việt Nam",
          shortName: "VWA",
          logoUrl: "",
          logoIcon: "GraduationCap",
          address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
          hotline: "024.3775.1750",
          email: "tuyensinh@vwa.edu.vn",
          website: "https://tuyensinh.hvpnvn.edu.vn/",
          aiRoutingMode: "hybrid",
          faqConfidenceThreshold: 40,
          defaultModel: "gemini-3.5-flash",
          aiMaxTokens: 8192,
          enableCache: true
        }
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }
    const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
    let parsed: any;
    try {
      parsed = JSON.parse(fileContent);
    } catch (e) {
      console.error('[readDB Error] JSON corruption detected. Resetting to default data.', e);
      // Fallback to default
      const data: DB = {
        documents: INITIAL_DOCS,
        faqs: INITIAL_FAQS,
        history: [],
        admins: ['tructn@vwa.edu.vn'],
        schoolConfig: {
          name: "Học viện Phụ nữ Việt Nam",
          shortName: "VWA",
          logoUrl: "",
          logoIcon: "GraduationCap",
          address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
          hotline: "024.3775.1750",
          email: "tuyensinh@vwa.edu.vn",
          website: "https://tuyensinh.hvpnvn.edu.vn/",
          aiRoutingMode: "hybrid",
          faqConfidenceThreshold: 40,
          defaultModel: "gemini-3.5-flash",
          aiMaxTokens: 8192,
          enableCache: true
        }
      };
      // Keep it corrupted? or backup? Let's rename it
      const corruptedPath = DB_FILE + '.corrupted';
      if (fs.existsSync(corruptedPath)) {
        try {
          fs.unlinkSync(corruptedPath);
        } catch (unlinkErr) {
          console.warn('[readDB Warning] Could not delete existing corrupted DB file:', unlinkErr);
        }
      }
      try {
        fs.renameSync(DB_FILE, corruptedPath);
      } catch (renameErr) {
        console.warn('[readDB Warning] Could not rename corrupted DB file:', renameErr);
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }
    
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

    if (!parsed.schoolConfig) {
      parsed.schoolConfig = {
        name: "Học viện Phụ nữ Việt Nam",
        shortName: "VWA",
        logoUrl: "",
        logoIcon: "GraduationCap",
        address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
        hotline: "024.3775.1750",
        email: "tuyensinh@vwa.edu.vn",
        website: "https://tuyensinh.hvpnvn.edu.vn/",
        aiRoutingMode: "hybrid",
        faqConfidenceThreshold: 40,
        defaultModel: "gemini-3.5-flash",
        aiMaxTokens: 8192,
        enableCache: true
      };
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('Không cập nhật được schoolConfig vào DB:', writeErr);
      }
    } else {
      let updatedObj = false;
      if (!parsed.schoolConfig.aiRoutingMode) { parsed.schoolConfig.aiRoutingMode = 'hybrid'; updatedObj = true; }
      if (parsed.schoolConfig.faqConfidenceThreshold === undefined) { parsed.schoolConfig.faqConfidenceThreshold = 40; updatedObj = true; }
      if (!parsed.schoolConfig.defaultModel) { parsed.schoolConfig.defaultModel = 'gemini-3.5-flash'; updatedObj = true; }
      if (parsed.schoolConfig.aiMaxTokens === undefined) { parsed.schoolConfig.aiMaxTokens = 8192; updatedObj = true; }
      if (parsed.schoolConfig.enableCache === undefined) { parsed.schoolConfig.enableCache = true; updatedObj = true; }
      
      if (updatedObj) {
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
        } catch (writeErr) {
          console.error('Không ghi được Cost fields bổ sung vào schoolConfig:', writeErr);
        }
      }
    }

    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      parsed.categories = [
        { id: 'ug', name: 'Đại học Chính quy', description: 'Hệ đào tạo Đại học chính quy Học viện Phụ nữ Việt Nam', isActive: true },
        { id: 'pg', name: 'Thạc sĩ - Sau đại học', description: 'Chương trình đào tạo Sau đại học gồm Thạc sĩ và Tiến sĩ', isActive: true },
        { id: 'general', name: 'Hỏi đáp & Tổng quan', description: 'Giải đáp thắc mắc tuyển sinh chung toàn trường', isActive: true }
      ];
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('Không cập nhật được categories mặc định vào DB:', writeErr);
      }
    }

    if (!parsed.consultations || !Array.isArray(parsed.consultations)) {
      parsed.consultations = [];
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      } catch (writeErr) {
        console.error('Không cập nhật được consultations mặc định vào DB:', writeErr);
      }
    }

    return parsed as DB;
  } catch (err) {
    console.error('Lỗi khi đọc file db.json:', err);
    return { 
      documents: [], 
      faqs: [], 
      history: [], 
      admins: ['tructn@vwa.edu.vn'],
      schoolConfig: {
        name: "Học viện Phụ nữ Việt Nam",
        shortName: "VWA",
        logoUrl: "",
        logoIcon: "GraduationCap",
        address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
        hotline: "024.3775.1750",
        email: "tuyensinh@vwa.edu.vn",
        website: "https://tuyensinh.hvpnvn.edu.vn/"
      }
    };
  }
}

// Helper to write database
function writeDB(data: DB) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    if (firestoreDb) {
      syncToFirestoreBackground(data).catch(err => {
        console.error('[Firebase Background Write Error] Lỗi ghi đồng bộ Firestore:', err);
      });
    }
  } catch (err) {
    console.error('Lỗi khi ghi file db.json:', err);
  }
}

// Background sync to Firestore to maximize performance and save reads/writes
async function syncToFirestoreBackground(data: DB) {
  if (!firestoreDb) return;
  try {
    // 1. School Config
    if (data.schoolConfig) {
      await setDoc(doc(firestoreDb, 'configs', 'schoolConfig'), data.schoolConfig);
    }

    // 2. Admins representation (represented as email ids in collection)
    for (const email of data.admins || []) {
      const emailLower = email.toLowerCase();
      const perms = data.adminPermissions?.[emailLower] || ['ug', 'pg', 'general'];
      await setDoc(doc(firestoreDb, 'admins', emailLower), { permissions: perms });
    }

    // 3. Sync Categories
    for (const cat of data.categories || []) {
      await setDoc(doc(firestoreDb, 'categories', cat.id), cat);
    }

    // 4. Since saving all FAQs on every write is expensive, let's write newest items
    if (data.faqs && data.faqs.length > 0) {
      const newestFaq = data.faqs[data.faqs.length - 1];
      if (newestFaq && newestFaq.id) {
        await setDoc(doc(firestoreDb, 'faqs', newestFaq.id), newestFaq);
      }
    }

    // 5. Newest consultation item
    if (data.consultations && data.consultations.length > 0) {
      const newestCons = data.consultations[data.consultations.length - 1];
      if (newestCons && newestCons.id) {
        await setDoc(doc(firestoreDb, 'consultations', newestCons.id), newestCons);
      }
    }

    // 6. Newest history item
    if (data.history && data.history.length > 0) {
      const newestHist = data.history[data.history.length - 1];
      if (newestHist && newestHist.id) {
        await setDoc(doc(firestoreDb, 'history', newestHist.id), newestHist);
      }
    }
  } catch (err) {
    console.error('[Firebase Background Sync Error]:', err);
  }
}

// Sync from Cloud Firestore down to Cache on server boot
async function syncFirestoreToLocal() {
  if (!firestoreDb) return;
  try {
    console.log('[Firebase Boot Sync] Bắt đầu đồng bộ hóa dữ liệu từ Google Cloud Firestore...');
    const localDb = readDB();
    let updated = false;

    // 1. Sync SchoolConfig
    const configDocRef = doc(firestoreDb, 'configs', 'schoolConfig');
    const configSnap = await getDoc(configDocRef);
    if (configSnap.exists()) {
      localDb.schoolConfig = configSnap.data() as SchoolConfig;
      updated = true;
    } else {
      if (localDb.schoolConfig) {
        await setDoc(configDocRef, localDb.schoolConfig);
        console.log('[Firebase Initial Boot] Đã đẩy cấu hình trường lên Cloud Firestore!');
      }
    }

    // 2. Sync Admins
    const adminsColRef = collection(firestoreDb, 'admins');
    const adminsSnap = await getDocs(adminsColRef);
    if (!adminsSnap.empty) {
      const cloudAdmins: string[] = [];
      const cloudPermissions: Record<string, string[]> = {};
      adminsSnap.forEach(snap => {
        const data = snap.data();
        const email = snap.id.toLowerCase();
        cloudAdmins.push(email);
        cloudPermissions[email] = data.permissions || ['ug', 'pg', 'general'];
      });
      localDb.admins = cloudAdmins;
      localDb.adminPermissions = cloudPermissions;
      updated = true;
    } else {
      for (const email of localDb.admins || []) {
        const emailLower = email.toLowerCase();
        const perms = localDb.adminPermissions?.[emailLower] || ['ug', 'pg', 'general'];
        await setDoc(doc(firestoreDb, 'admins', emailLower), { permissions: perms });
      }
      console.log('[Firebase Initial Boot] Đã đẩy các cán bộ phân quyền lên Cloud Firestore!');
    }

    // 3. Sync Categories
    const catColRef = collection(firestoreDb, 'categories');
    const catSnap = await getDocs(catColRef);
    if (!catSnap.empty) {
      const cloudCats: any[] = [];
      catSnap.forEach(snap => {
        cloudCats.push(snap.data());
      });
      localDb.categories = cloudCats as any[];
      updated = true;
    } else {
      for (const cat of localDb.categories || []) {
        await setDoc(doc(firestoreDb, 'categories', cat.id), cat);
      }
      console.log('[Firebase Initial Boot] Đã đẩy danh mục phân hệ lên Cloud Firestore!');
    }

    // 4. Sync FAQs
    const faqsColRef = collection(firestoreDb, 'faqs');
    const faqsSnap = await getDocs(faqsColRef);
    if (!faqsSnap.empty) {
      const cloudFaqs: FAQ[] = [];
      faqsSnap.forEach(snap => {
        cloudFaqs.push(snap.data() as FAQ);
      });
      localDb.faqs = cloudFaqs;
      updated = true;
    } else {
      for (const faq of localDb.faqs || []) {
        await setDoc(doc(firestoreDb, 'faqs', faq.id), faq);
      }
      console.log('[Firebase Initial Boot] Đã đẩy danh sách FAQs lên Cloud Firestore!');
    }

    // 5. Sync Consultations
    const consColRef = collection(firestoreDb, 'consultations');
    const consSnap = await getDocs(consColRef);
    if (!consSnap.empty) {
      const cloudCons: any[] = [];
      consSnap.forEach(snap => {
        cloudCons.push(snap.data());
      });
      localDb.consultations = cloudCons;
      updated = true;
    } else {
      for (const con of localDb.consultations || []) {
        await setDoc(doc(firestoreDb, 'consultations', con.id), con);
      }
    }

    // 6. Sync History (Take last 100 maximum)
    const histColRef = collection(firestoreDb, 'history');
    const histSnap = await getDocs(histColRef);
    if (!histSnap.empty) {
      const cloudHist: HistoryItem[] = [];
      histSnap.forEach(snap => {
        cloudHist.push(snap.data() as HistoryItem);
      });
      cloudHist.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      localDb.history = cloudHist.slice(0, 100);
      updated = true;
    } else {
      for (const hist of (localDb.history || []).slice(-20)) {
        await setDoc(doc(firestoreDb, 'history', hist.id), hist);
      }
    }

    if (updated) {
      fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2), 'utf-8');
      console.log('[Firebase Boot Sync] Đồng bộ hóa thành công! Dữ liệu Cloud đã tải về nạp vào cache.');
    }
  } catch (err) {
    console.error('[Firebase Sync Error] Lỗi đồng bộ hóa dữ liệu từ Firestore lúc khởi động:', err);
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
  const docLiveContentMap = new Map<string, string>();
  
  for (const doc of activeDocs) {
    // Read live content directly from physical files under uploads/RAG/ matching user rules 3 & 4
    let docContent = doc.content;
    if (doc.ragPath) {
      const fullPath = path.isAbsolute(doc.ragPath) ? doc.ragPath : path.join(process.cwd(), doc.ragPath);
      if (fs.existsSync(fullPath)) {
        try {
          docContent = fs.readFileSync(fullPath, 'utf-8');
          console.log(`[RAG Live Disk Match] Read fresh content from ${fullPath}`);
        } catch (err) {
          console.error(`[RAG Live Disk Match] Error reading RAG path for ${doc.title}:`, err);
        }
      }
    }
    docLiveContentMap.set(doc.id, docContent);

    // Split by double newline or single newline to keep table row structures
    const paragraphs = docContent
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

  // Take the top matched paragraphs (optimized to top 4 segments for cost-efficient RAG)
  const topMatches = scoredParagraphs.slice(0, 4);
  const contextSegments: string[] = [];
  const sourceSet = new Set<string>();

  // To avoid duplicate adjacent paragraphs in the output, track keys: "docId-index"
  const addedParagraphKeys = new Set<string>();

  topMatches.forEach(match => {
    sourceSet.add(match.docTitle);
    const docParagraphs = docParagraphsMap.get(match.docId) || [];
    
    // Get adjacent block (parent window window: index - 2, index - 1, index, index + 2)
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

  const finalContext = contextSegments.join('\n\n---\n\n');

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

// OAuth routes
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.send(`
      <script>
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: ${JSON.stringify(req.user)} }, '*');
        window.close();
      </script>
    `);
  }
);

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

// Helper to manage and create structured subfolders under /uploads
function getStructuredUploadPaths(filename: string, category: string, uploadDate?: string) {
  const dateStr = uploadDate || new Date().toISOString().split('T')[0];
  const cat = category || 'general';
  
  const dataDir = path.join(process.cwd(), 'uploads', 'Data', dateStr);
  const imageDir = path.join(process.cwd(), 'uploads', 'Image', dateStr);
  const ragDir = path.join(process.cwd(), 'uploads', 'RAG', dateStr);
  
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
  if (!fs.existsSync(ragDir)) fs.mkdirSync(ragDir, { recursive: true });
  
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const baseName = filename.replace(/\.[^/.]+$/, "");
  
  const dataPath = path.join(dataDir, filename);
  // Structured file name for self-description: [category]__[basename].md
  const ragPath = path.join(ragDir, `${cat}__${baseName}.md`);
  
  // Return relative paths for DB index (so they work on any environment/container cold start)
  const relativeDataPath = path.join('uploads', 'Data', dateStr, filename);
  const relativeRagPath = path.join('uploads', 'RAG', dateStr, `${cat}__${baseName}.md`);
  
  return { 
    dataDir, 
    imageDir, 
    ragDir, 
    dataPath, 
    ragPath,
    relativeDataPath,
    relativeRagPath
  };
}

// Upload endpoint
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file tải lên.' });
    }

    const { title, category, version } = req.body;
    const filename = req.file.originalname;
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeType = req.file.mimetype;

    const allowedExtensions = ['docx', 'pdf', 'xlsx', 'xls', 'txt', 'png', 'jpg', 'jpeg', 'webp'];
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({ success: false, message: 'Chỉ hỗ trợ file Word (.docx), PDF (.pdf), Excel (.xlsx/.xls), Text (.txt) và Hình ảnh (.png, .jpg, .jpeg, .webp).' });
    }

    const docCategory = category || 'general';
    const uploadDateStr = new Date().toISOString().split('T')[0];
    
    // Resolve structured paths
    const paths = getStructuredUploadPaths(filename, docCategory, uploadDateStr);

    let extractedText = '';

    // Choose parsing pipeline based on file type
    if (ext === 'docx') {
      // 1. Double save original file
      fs.writeFileSync(paths.dataPath, req.file.buffer);

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
          console.error("Lỗi khi dùng Gemini phân tích DOCX HTML, chuyển sang trích xuất thô", err);
          const result = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedText = result.value;
        }
      } else {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value;
      }
    } else if (ext === 'txt') {
      // txt raw direct path write
      fs.writeFileSync(paths.dataPath, req.file.buffer);
      extractedText = req.file.buffer.toString('utf-8');
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      // Save to Image as well as Data as requested by User Goal 4
      fs.writeFileSync(paths.dataPath, req.file.buffer);
      const destImagePath = path.join(paths.imageDir, filename);
      fs.writeFileSync(destImagePath, req.file.buffer);
      console.log(`[Upload] Image physically saved additionally to ${destImagePath}`);

      const gemini = getGeminiClient();
      if (gemini) {
        try {
          const imagePart = {
            inlineData: {
              mimeType: mimeType,
              data: req.file.buffer.toString('base64'),
            },
          };
          
          const parsePrompt = `Bạn là một Chuyên gia phân tích dữ liệu tuyển sinh Học viện Phụ nữ Việt Nam và lập trình hệ thống RAG (Retrieval-Augmented Generation) cao cấp.
Bạn nhận được một hình ảnh tuyển sinh đính kèm (chứa thông tin, sơ đồ, bảng chỉ tiêu hoặc biểu phí nhập học...).
Nhiệm vụ của bạn: Hãy phân tích kỹ hình ảnh này, đọc tất cả văn bản (OCR) và mô tả/chuyển hóa lại toàn bộ thông tin có trong ảnh thành văn bản dạng Markdown chất lượng cao, tối ưu tuyệt đối cho công cụ tìm kiếm và RAG:

1. Trích xuất CHÍNH XÁC 100% tất cả các con số, tên gọi, bảng dữ liệu biểu phí hay chỉ tiêu ngành.
2. Nếu có bảng biểu hoặc ô trộn dòng/cột: Bạn phải vẽ lại bảng bằng Markdown, điền đầy đủ các ô, nhân bản giá trị ô trộn để dòng nào cũng có ngữ cảnh hoàn chỉnh.
3. Kèm theo phần diễn giải chi tiết dạng danh sách văn xuôi cho từng hàng của bảng hoặc phần nội dung của ảnh để RAG phân đoạn hiệu quả nhất. Không làm mất bất kỳ một thông tin hay số liệu nào trong ảnh.
4. Trả về đúng nội dung văn bản Markdown kết quả, không thêm bất kỳ lời dẫn, lời chào hay giải thích gì bên ngoài.`;

          const aiRes = await generateContentWithRetry(gemini, {
            model: 'gemini-3.5-flash',
            contents: [imagePart, { text: parsePrompt }]
          });
          extractedText = cleanMarkdownText(aiRes.text || 'Trống');
        } catch (err: any) {
          console.error("Gemini OCR parser failed, falling back to basic metadata placeholder", err);
          extractedText = `Hình ảnh tuyển sinh gốc: ${filename}\nTải lên ngày: ${uploadDateStr}\nPhân hệ: ${docCategory}`;
        }
      } else {
        extractedText = `Hình ảnh tuyển sinh gốc: ${filename}\nTải lên ngày: ${uploadDateStr}\nPhân hệ: ${docCategory}`;
      }
    } else {
      // PDF or Excel
      fs.writeFileSync(paths.dataPath, req.file.buffer);

      const gemini = getGeminiClient();
      if (gemini) {
        try {
          const targetMimeType = ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const filePart = {
            inlineData: {
              mimeType: targetMimeType,
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

    // Save final processed RAG text to disk matching user goal 2 & 4
    fs.writeFileSync(paths.ragPath, extractedText, 'utf-8');
    console.log(`[Upload] Processed RAG text saved to ${paths.ragPath}`);

    // Split paragraphs count
    const chunksCount = extractedText.split(/\n\s*\n/).filter(p => p.trim().length > 30).length || 1;

    const newDoc: RecruitmentDocument = {
      id: 'doc-' + Date.now(),
      filename,
      title: title || filename,
      content: extractedText,
      fileType: (ext === 'xls' ? 'xlsx' : ext) as any,
      category: docCategory as any,
      uploadDate: uploadDateStr,
      version: version || '1.0',
      isLatest: true,
      isActive: true,
      chunksCount,
      dataPath: paths.relativeDataPath,
      ragPath: paths.relativeRagPath
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
  let firebaseConfigStr = '{}';
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      firebaseConfigStr = fs.readFileSync(configPath, 'utf-8');
    }
  } catch (err) {
    console.error('Lỗi đọc cấu hình Firebase cho SSO:', err);
  }

  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Đăng nhập bằng tài khoản Google - VWA Admissions</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <!-- Load Firebase SDK library Compat -->
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>
    <style>
        body {
            font-family: 'Roboto', sans-serif;
            background-color: #f0f4f9;
        }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white w-full max-w-[450px] rounded-lg border border-[#dadce0] px-8 py-10 shadow-sm transition-all">
        <!-- Google Logo & Heading -->
        <div class="flex flex-col items-center mb-6">
            <div class="flex items-center space-x-1.5 mb-2">
                <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
                <span class="font-semibold text-[#202124] text-xl">Google</span>
            </div>
            <h1 class="text-[#202124] text-xl font-medium mb-1">Cổng đăng nhập SSO cán bộ</h1>
            <p class="text-[#5f6368] text-xs text-center">Xác thực chính thức VWA Admissions hoặc đối tác</p>
        </div>

        <!-- Connection indicators -->
        <div id="firebase-status" class="p-2 mb-4 text-[11px] text-center rounded hidden"></div>

        <!-- Choice Panels -->
        <div class="space-y-4">
            <!-- 1. Real Google SSO Button (Primary Action) -->
            <div class="border border-[#e0e0e0] p-4 rounded-lg bg-slate-50/50">
                <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 flex items-center">
                    <span class="mr-1">🔐</span> PHƯƠNG THỨC CHÍNH THỨC (REAL SSO)
                </h3>
                <p class="text-[11px] text-slate-500 mb-3 leading-relaxed">Xác thực thực tế và đồng bộ dữ liệu cán bộ thông qua Google SSO và lưu trữ tài khoản vào Firebase Firestore:</p>
                <button id="btn-real-google" onclick="triggerRealGoogleSignIn()"
                    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-md text-xs transition-colors flex items-center justify-center space-x-2 shadow-sm cursor-pointer border border-blue-700">
                    <svg class="h-4 w-4 fill-white pr-0.5" viewBox="0 0 24 24">
                        <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.86-3.577-7.86-8s3.53-8 7.86-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C17.955 2.192 15.34 1 12.24 1 6.31 1 1.5 5.81 1.5 11.75S6.31 22.5 12.24 22.5c6.19 0 10.3-4.352 10.3-10.477 0-.71-.077-1.25-.175-1.738H12.24z"/>
                    </svg>
                    <span>Xác thực thật với Google SSO</span>
                </button>
            </div>

            <!-- Fallback Switch Trigger -->
            <div id="toggle-simulated-box" class="text-center">
                <button type="button" onclick="toggleSimulatedView()" class="text-xs text-blue-600 hover:underline hover:text-blue-800 font-medium cursor-pointer">
                    👉 Bạn không thể đăng nhập thật? Sử dụng chế độ xác thực mật khẩu
                </button>
            </div>

            <!-- 2. Fallback Simulated SSO -->
            <div id="simulated-box" class="border border-dashed border-[#dadce0] p-4 rounded-lg bg-white hidden">
                <h3 class="text-xs font-bold text-slate-500 uppercase mb-3 text-center">
                    CHẾ ĐỘ XÁC THỰC MẬT KHẨU (SIMULATED FALLBACK)
                </h3>
                <div id="login-container">
                    <!-- Step 1: Input email -->
                    <div id="step-email">
                        <div class="relative mb-3">
                            <input type="email" id="email-input" placeholder=" "
                                class="block w-full px-4 py-2 text-sm text-[#202124] bg-transparent border border-[#909399] rounded-md focus:border-[#1a73e8] focus:outline-none transition-all peer" />
                            <label for="email-input"
                                class="absolute text-[#5f6368] duration-200 transform scale-75 top-1 z-10 origin-[0] bg-white px-1.5 peer-placeholder-shown:scale-100 peer-placeholder-shown:top-2 peer-focus:top-1 peer-focus:scale-75 peer-focus:text-[#1a73e8] left-3 text-xs">
                                Email cán bộ
                            </label>
                        </div>
                        
                        <!-- Org domain reminder banner -->
                        <div class="p-3 bg-blue-50 text-blue-800 text-[10.5px] rounded-lg border border-blue-100 mb-3 flex items-start space-x-1.5 leading-tight">
                            <svg class="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span><strong>Hỗ trợ:</strong> Không giới hạn tên miền. Chấp nhận mọi tài khoản Google đại diện cán bộ.</span>
                        </div>

                        <div id="email-error" class="text-red-500 text-xs font-semibold mb-3 hidden leading-tight"></div>

                        <div class="flex items-center justify-between mt-4">
                            <button type="button" onclick="toggleSimulatedView()" class="text-xs text-slate-500 hover:underline">Hủy bỏ</button>
                            <button id="btn-next" 
                                class="bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors px-4 py-1.5 rounded-md font-medium text-xs shadow-sm">
                                Tiếp theo
                            </button>
                        </div>
                    </div>

                    <!-- Step 2: Password (slide-in simulator) -->
                    <div id="step-password" class="hidden">
                        <div class="flex items-center space-x-2 bg-[#f1f3f4] rounded-full py-1 px-2.5 mb-3 border border-[#dadce0] w-fit mx-auto text-[11px]">
                            <span id="display-user-email" class="text-[#3c4043] font-medium">tructn@vwa.edu.vn</span>
                        </div>

                        <div class="relative mb-3">
                            <input type="password" id="password-input" placeholder=" "
                                class="block w-full px-4 py-2 text-sm text-[#202124] bg-transparent border border-[#1a73e8] rounded-md focus:outline-none transition-all peer" />
                            <label for="password-input"
                                class="absolute text-[#1a73e8] duration-200 transform scale-75 top-1 z-10 origin-[0] bg-white px-1.5 left-3 text-xs">
                                Nhập mật khẩu giả lập
                            </label>
                        </div>

                        <div class="flex items-center space-x-1.5 mb-4">
                            <input type="checkbox" id="show-pass" class="h-3.5 w-3.5 rounded border-[#dadce0] text-[#1a73e8]" />
                            <label for="show-pass" class="text-[#3c4043] text-xs">Hiện mật khẩu</label>
                        </div>

                        <div class="flex items-center justify-between mt-4">
                            <button id="btn-back" class="text-[#1a73e8] text-xs font-medium hover:underline">Quay lại</button>
                            <button id="btn-login"
                                class="bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors px-4 py-1.5 rounded-md font-medium text-xs shadow-sm flex items-center space-x-1">
                                <span id="login-text">Đăng nhập</span>
                                <div id="login-spinner" class="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin hidden"></div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div id="status-error" class="text-red-500 text-xs font-semibold p-3 bg-red-50 rounded-lg border border-red-100 hidden leading-normal"></div>
            
            <div id="real-spinner-box" class="hidden flex flex-col items-center justify-center p-4">
                <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-2"></div>
                <p class="text-xs text-blue-700 font-medium">Đang xử lý đăng nhập thực qua Google...</p>
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
        const statusError = document.getElementById('status-error');
        const realSpinnerBox = document.getElementById('real-spinner-box');
        
        const btnNext = document.getElementById('btn-next');
        const btnBack = document.getElementById('btn-back');
        const btnLogin = document.getElementById('btn-login');
        const loginText = document.getElementById('login-text');
        const loginSpinner = document.getElementById('login-spinner');
        const showPass = document.getElementById('show-pass');

        // Initialize Firebase
        const firebaseConfig = ${firebaseConfigStr};
        let db = null;
        let auth = null;
        let isFirebaseAvailable = false;

        try {
            if (firebaseConfig && firebaseConfig.apiKey) {
                firebase.initializeApp(firebaseConfig);
                auth = firebase.auth();
                db = firebase.firestore();
                isFirebaseAvailable = true;
                
                const statusEl = document.getElementById('firebase-status');
                statusEl.textContent = "🟢 Tích hợp Firebase Auth động trực tuyến hoạt động";
                statusEl.className = "p-2 mb-4 text-[10px] text-center rounded bg-emerald-50 text-emerald-800 font-semibold border border-emerald-100 block";
            }
        } catch (e) {
            console.error("Không khởi tạo được Firebase cho Google SSO:", e);
        }

        function toggleSimulatedView() {
            const simulatedBox = document.getElementById('simulated-box');
            const toggleBox = document.getElementById('toggle-simulated-box');
            if (simulatedBox.classList.contains('hidden')) {
                simulatedBox.classList.remove('hidden');
                toggleBox.classList.add('hidden');
                emailInput.focus();
            } else {
                simulatedBox.classList.add('hidden');
                toggleBox.classList.remove('hidden');
            }
        }

        // Live Real Google Authentication!
        async function triggerRealGoogleSignIn() {
            if (!isFirebaseAvailable) {
                showDangerError("Lỗi hệ thống: Firebase chưa được định cấu hình. Vui lòng kiểm tra lại tệp tin cấu hình.");
                return;
            }

            hideDangerError();
            realSpinnerBox.classList.remove('hidden');
            document.getElementById('btn-real-google').disabled = true;

            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({
                prompt: 'select_account'
            });

            try {
                const result = await auth.signInWithPopup(provider);
                const user = result.user;
                const email = user.email ? user.email.trim().toLowerCase() : '';

                if (!email) {
                    showDangerError("Đăng nhập thất bại: Không lấy được địa chỉ email từ tài khoản Google.");
                    await auth.signOut();
                    realSpinnerBox.classList.add('hidden');
                    document.getElementById('btn-real-google').disabled = false;
                    return;
                }

                // Store or update account profiles in real Firebase Firestore collection
                try {
                    await db.collection('accounts').doc(user.uid).set({
                        email: email,
                        name: user.displayName || email.split('@')[0],
                        photoURL: user.photoURL || '',
                        providerId: 'google.com',
                        authenticatedAt: new Date().toISOString(),
                        type: 'real_google_sso'
                    }, { merge: true });
                } catch (fsErr) {
                    console.warn("Firestore save account trace failed but OAuth successful:", fsErr);
                }

                // Communicate success back to main window App.tsx
                postLoginSuccess(email, user.displayName || email.split('@')[0], user.photoURL);

            } catch (authErr) {
                console.error("Firebase Authentication Error:", authErr);
                realSpinnerBox.classList.add('hidden');
                document.getElementById('btn-real-google').disabled = false;

                if (authErr.code === 'auth/operation-not-allowed') {
                    showDangerError("Cảnh báo: Bạn chưa bật nhà cung cấp đăng nhập 'Google' trong trang cài đặt Firebase Console (Authentication Providers) của dự án " + firebaseConfig.projectId + ". Vui lòng bật nó, hoặc sử dụng phương thức xác thực mật khẩu giả lập dưới đây.");
                    toggleSimulatedView();
                } else {
                    showDangerError("Lỗi xác thực: " + authErr.message);
                }
            }
        }

        function postLoginSuccess(email, displayName, photoURL) {
            if (window.opener) {
                window.opener.postMessage({
                    type: 'OAUTH_AUTH_SUCCESS', 
                    user: {
                        email: email,
                        name: displayName || email.split('@')[0],
                        picture: photoURL || 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                    }
                }, '*');
                window.close();
            } else {
                alert('Xác thực SSO thành công! Đang chuyển hướng...');
                window.location.href = '/';
            }
        }

        function showDangerError(msg) {
            statusError.textContent = msg;
            statusError.classList.remove('hidden');
        }

        function hideDangerError() {
            statusError.classList.add('hidden');
        }

        // Toggle Password visibility
        showPass.addEventListener('change', function() {
            passwordInput.type = this.checked ? 'text' : 'password';
        });

        // Email Validation & Step Progression for fallback
        btnNext.addEventListener('click', function() {
            const email = emailInput.value.trim();
            if (!email) {
                showValidationError('Vui lòng nhập địa chỉ email.');
                return;
            }

            const lowEmail = email.toLowerCase();
            if (!lowEmail.includes('@')) {
                showValidationError('Email không hợp lệ. Vui lòng nhập đúng định dạng email.');
                return;
            }

            hideValidationError();
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
    </script>
</body>
</html>
  `);
});

app.get('/microsoft-sign-in.html', (req, res) => {
  let firebaseConfigStr = '{}';
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      firebaseConfigStr = fs.readFileSync(configPath, 'utf-8');
    }
  } catch (err) {
    console.error('Lỗi đọc cấu hình Firebase cho Microsoft SSO:', err);
  }

  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Đăng nhập tài khoản Microsoft - Cổng Cán bộ VWA</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Segoe+UI:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <!-- Load Firebase SDK library Compat -->
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', 'Inter', sans-serif;
            background-color: #e5e5e5;
            background-image: radial-gradient(circle at 100% 100%, rgba(0, 120, 215, 0.08) 0%, transparent 40%),
                              radial-gradient(circle at 0% 0%, rgba(0, 103, 184, 0.05) 0%, transparent 30%);
        }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white w-full max-w-[440px] rounded-lg p-8 shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-[#dadce0] transition-all">
        <!-- Microsoft Logo Grid -->
        <div class="mb-5 flex items-center justify-between">
            <div class="flex items-center space-x-2">
                <div class="grid grid-cols-2 gap-0.5 w-[21px] h-[21px] shrink-0">
                    <div class="bg-[#f25022] w-2.5 h-2.5"></div>
                    <div class="bg-[#7fba00] w-2.5 h-2.5"></div>
                    <div class="bg-[#00a4ef] w-2.5 h-2.5"></div>
                    <div class="bg-[#ffb900] w-2.5 h-2.5"></div>
                </div>
                <span class="font-semibold text-[#737373] text-lg font-sans">Microsoft</span>
            </div>
        </div>

        <h1 class="text-[#1b1b1b] text-xl font-semibold mb-1">Cài đặt Đăng nhập Cán bộ</h1>
        <p class="text-[#505050] text-xs mb-6">Liên kết xác thực tài khoản Microsoft Cán bộ Học viện & Đối tác</p>

        <!-- Connection indicators -->
        <div id="firebase-status" class="p-2 mb-4 text-[10px] text-center rounded hidden"></div>

        <!-- Multi portal sign-in -->
        <div class="space-y-4">
            <!-- 1. Real Microsoft Azure Auth SSO -->
            <div class="border border-[#e0e0e0] p-4 rounded bg-[#f3f2f1]/50">
                <h3 class="text-xs font-semibold text-slate-700 tracking-wide mb-2 flex items-center shadow-none">
                    <span class="mr-1">🔐</span> PHƯƠNG THỨC THƯỜNG TRỰC (REAL AZURE SSO)
                </h3>
                <p class="text-[11px] text-slate-500 mb-3 leading-relaxed">Đăng nhập tài khoản Microsoft bất kì thuộc phạm vi liên kết cán bộ và tự động lưu phiên nhận diện:</p>
                <button id="btn-real-ms" onclick="triggerRealMicrosoftSignIn()"
                    class="w-full bg-[#0067b8] hover:bg-[#005da6] text-white font-medium py-2 px-4 text-xs transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-sm">
                    <div class="grid grid-cols-2 gap-0.5 w-[14px] h-[14px] shrink-0">
                        <div class="bg-white w-1.5 h-1.5"></div>
                        <div class="bg-white w-1.5 h-1.5"></div>
                        <div class="bg-white w-1.5 h-1.5"></div>
                        <div class="bg-white w-1.5 h-1.5"></div>
                    </div>
                    <span>Xác thực thật với Microsoft SSO</span>
                </button>
            </div>

            <!-- Fallback Switch Trigger -->
            <div id="toggle-simulated-box" class="text-center">
                <button type="button" onclick="toggleSimulatedView()" class="text-xs text-[#0067b8] hover:underline font-semibold cursor-pointer">
                    👉 Bạn không thể đăng nhập Azure? Sử dụng tài khoản kiểm tra giáo vụ
                </button>
            </div>

            <!-- 2. Fallback Credential Login -->
            <div id="simulated-box" class="border border-dashed border-[#cccccc] p-4 rounded bg-white hidden">
                <h3 class="text-xs font-bold text-slate-500 uppercase mb-3 text-center">
                    MẬT KHẨU LIÊN KẾT (FALLBACK CREDENTIAL)
                </h3>
                <div id="login-container">
                    <!-- Step 1: Email Input -->
                    <div id="step-email">
                        <div class="relative mb-3 border-b border-[#505050] focus-within:border-[#0067b8] transition-all">
                            <input type="email" id="email-input" placeholder="Email tài khoản Microsoft cán bộ"
                                class="block w-full py-1.5 text-xs text-[#000] bg-transparent focus:outline-none placeholder-[#666]" />
                        </div>

                        <!-- Domain info banner -->
                        <div class="p-3 bg-[#f3f2f1] text-[#323130] text-[10.5px] rounded-sm mb-3 flex items-start space-x-2 border-l-4 border-[#0067b8] leading-tight">
                            <svg class="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#0067b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0-6v2m0-6h.01M12 2a10 10 0 110 20 10 10 0 010-20z" />
                            </svg>
                            <span>Hệ thống hỗ trợ mọi tài khoản Microsoft liên kết cán bộ phân quyền.</span>
                        </div>

                        <div id="email-error" class="text-red-600 text-xs font-semibold mb-3 hidden leading-tight"></div>

                        <div class="flex items-center justify-between mt-4">
                            <button type="button" onclick="toggleSimulatedView()" class="text-xs text-slate-500 hover:underline">Hủy bỏ</button>
                            <button id="btn-next" 
                                class="bg-[#0067b8] hover:bg-[#005da6] transition-colors text-white px-5 py-1.5 text-xs font-medium">
                                Tiếp theo
                            </button>
                        </div>
                    </div>

                    <!-- Step 2: Password Input -->
                    <div id="step-password" class="hidden">
                        <div class="flex items-center space-x-1 text-xs text-[#2b2b2b] mb-3 bg-[#f3f2f1] py-1 px-2.5 w-fit rounded-full cursor-pointer hover:bg-[#e1dfdd]" id="btn-show-email">
                            <svg class="h-3 w-3 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            <span id="display-user-email" class="font-medium"></span>
                        </div>

                        <div class="relative mb-3 border-b border-[#505050] focus-within:border-[#0067b8] transition-all">
                            <input type="password" id="password-input" placeholder="Mật khẩu"
                                class="block w-full py-1.5 text-xs text-[#000] bg-transparent focus:outline-none placeholder-[#666]" />
                        </div>

                        <div class="flex items-center space-x-1.5 mb-4">
                            <input type="checkbox" id="show-pass" class="h-3.5 w-3.5 border-[#505050] rounded-none text-[#0067b8] focus:ring-0" />
                            <label for="show-pass" class="text-xs text-[#2b2b2b]">Hiển thị mật khẩu</label>
                        </div>

                        <div class="flex items-center justify-between mt-4">
                            <button id="btn-back" class="text-[#0067b8] text-xs font-medium hover:underline">Quay lại</button>
                            <button id="btn-login"
                                class="bg-[#0067b8] hover:bg-[#005da6] transition-colors text-white px-5 py-1.5 text-xs font-semibold flex items-center space-x-1">
                                <span id="login-text">Đăng nhập</span>
                                <div id="login-spinner" class="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin hidden"></div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="status-error" class="text-red-500 text-xs font-semibold p-3 bg-red-50 rounded-lg border border-red-100 hidden leading-normal"></div>

            <div id="real-spinner-box" class="hidden flex flex-col items-center justify-center p-4">
                <div class="animate-spin rounded-full h-8 w-8 border-4 border-[#0067b8] border-t-transparent mb-2"></div>
                <p class="text-xs text-[#0067b8] font-medium">Đang mở xác thực Microsoft Account...</p>
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
        const statusError = document.getElementById('status-error');
        const realSpinnerBox = document.getElementById('real-spinner-box');
        
        const btnNext = document.getElementById('btn-next');
        const btnBack = document.getElementById('btn-back');
        const btnShowEmail = document.getElementById('btn-show-email');
        const btnLogin = document.getElementById('btn-login');
        const loginText = document.getElementById('login-text');
        const loginSpinner = document.getElementById('login-spinner');
        const showPass = document.getElementById('show-pass');

        // Initialize Firebase
        const firebaseConfig = ${firebaseConfigStr};
        let db = null;
        let auth = null;
        let isFirebaseAvailable = false;

        try {
            if (firebaseConfig && firebaseConfig.apiKey) {
                firebase.initializeApp(firebaseConfig);
                auth = firebase.auth();
                db = firebase.firestore();
                isFirebaseAvailable = true;
                
                const statusEl = document.getElementById('firebase-status');
                statusEl.textContent = "🟢 Liên kết động Firebase Auth trực tuyến sẵn sàng";
                statusEl.className = "p-2 mb-4 text-[10px] text-center rounded bg-emerald-50 text-emerald-800 font-semibold border border-emerald-100 block";
            }
        } catch (e) {
            console.error("Không khởi tạo được Firebase cho Microsoft SSO:", e);
        }

        function toggleSimulatedView() {
            const simulatedBox = document.getElementById('simulated-box');
            const toggleBox = document.getElementById('toggle-simulated-box');
            if (simulatedBox.classList.contains('hidden')) {
                simulatedBox.classList.remove('hidden');
                toggleBox.classList.add('hidden');
                emailInput.focus();
            } else {
                simulatedBox.classList.add('hidden');
                toggleBox.classList.remove('hidden');
            }
        }

        // Live Real Microsoft SSO Authentication!
        async function triggerRealMicrosoftSignIn() {
            if (!isFirebaseAvailable) {
                showDangerError("Lỗi hệ thống: Firebase chưa được định cấu hình. Vui lòng kiểm tra lại cấu hình kết nối.");
                return;
            }

            hideDangerError();
            realSpinnerBox.classList.remove('hidden');
            document.getElementById('btn-real-ms').disabled = true;

            const provider = new firebase.auth.OAuthProvider('microsoft.com');
            provider.setCustomParameters({
                prompt: 'select_account',
                tenant: 'common'
            });

            try {
                const result = await auth.signInWithPopup(provider);
                const user = result.user;
                const email = user.email ? user.email.trim().toLowerCase() : '';

                if (!email) {
                    showDangerError("Xác thực Microsoft thất bại: Không lấy được địa chỉ email từ tài khoản.");
                    await auth.signOut();
                    realSpinnerBox.classList.add('hidden');
                    document.getElementById('btn-real-ms').disabled = false;
                    return;
                }

                // Store account profile in online Database
                try {
                    await db.collection('accounts').doc(user.uid).set({
                        email: email,
                        name: user.displayName || email.split('@')[0],
                        photoURL: user.photoURL || '',
                        providerId: 'microsoft.com',
                        authenticatedAt: new Date().toISOString(),
                        type: 'real_microsoft_sso'
                    }, { merge: true });
                } catch (fsErr) {
                    console.warn("Lỗi lưu thông tin vào Firestore nhưng OAuth đã thành công:", fsErr);
                }

                // Call post back success
                postLoginSuccess(email, user.displayName || email.split('@')[0], user.photoURL);

            } catch (authErr) {
                console.error("Microsoft Login Error:", authErr);
                realSpinnerBox.classList.add('hidden');
                document.getElementById('btn-real-ms').disabled = false;

                if (authErr.code === 'auth/operation-not-allowed') {
                    showDangerError("Cảnh báo: Nhà cung cấp 'Microsoft / Azure AD' chưa được kích hoạt trong Firebase Console dự án " + firebaseConfig.projectId + ". Vui lòng kích hoạt trong Authentication -> Sign-in Method, hoặc sử dụng cổng giả lập dưới đây.");
                    toggleSimulatedView();
                } else {
                    showDangerError("Lỗi đăng nhập Azure: " + authErr.message);
                }
            }
        }

        function postLoginSuccess(email, displayName, photoURL) {
            if (window.opener) {
                window.opener.postMessage({
                    type: 'OAUTH_AUTH_SUCCESS', 
                    user: {
                        email: email,
                        name: displayName || email.split('@')[0],
                        picture: photoURL || 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                    }
                }, '*');
                window.close();
            } else {
                alert('Xác thực SSO thành công! Đang chuyển hướng...');
                window.location.href = '/';
            }
        }

        function showDangerError(msg) {
            statusError.textContent = msg;
            statusError.classList.remove('hidden');
        }

        function hideDangerError() {
            statusError.classList.add('hidden');
        }

        showPass.addEventListener('change', function() {
            passwordInput.type = this.checked ? 'text' : 'password';
        });

        // Email flow for fallback
        btnNext.addEventListener('click', function() {
            const email = emailInput.value.trim();
            if (!email) {
                showValidationError('Vui lòng nhập địa chỉ email.');
                return;
            }

            const lowEmail = email.toLowerCase();
            if (!lowEmail.includes('@')) {
                showValidationError('Địa chỉ email Microsoft không hợp lý. Vui lòng kiểm tra lại cấu trúc email.');
                return;
            }

            hideValidationError();
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

        btnShowEmail.addEventListener('click', function() {
            btnBack.click();
        });

        // Fail-safe credential simulation write
        btnLogin.addEventListener('click', function() {
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!password || password.length < 4) {
                alert('Mật khẩu tối thiểu phải từ 4 kí tự.');
                return;
            }

            btnLogin.disabled = true;
            btnBack.disabled = true;
            loginText.textContent = 'Đang đăng ký phiên...';
            loginSpinner.classList.remove('hidden');

            setTimeout(async () => {
                // Persistent recording to client Firestore
                if (isFirebaseAvailable) {
                    try {
                        const fakeUid = 'simulated_ms_' + email.replace(/[^a-zA-Z0-9]/g, '_');
                        await db.collection('accounts').doc(fakeUid).set({
                            email: email,
                            name: email.split('@')[0],
                            photoURL: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
                            providerId: 'simulated_microsoft_pwd',
                            authenticatedAt: new Date().toISOString(),
                            type: 'simulated_credential'
                        }, { merge: true });
                    } catch (fsErr) {
                        console.warn('Lỗi ghi thông tin giả lập lên Firestore:', fsErr);
                    }
                }

                postLoginSuccess(email, email.split('@')[0], '');
            }, 1000);
        });

        emailInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') btnNext.click();
        });
        passwordInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') btnLogin.click();
        });

        function showValidationError(msg) {
            emailError.textContent = msg;
            emailError.classList.remove('hidden');
        }

        function hideValidationError() {
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
  const db = readDB();
  const superadmin = 'tructn@vwa.edu.vn';
  const superadminGmail = 'trinhngoctruc@gmail.com';

  if (normalized === superadmin || normalized === superadminGmail) {
    return res.json({
      success: true,
      user: {
        email: normalized,
        role: 'superadmin',
        name: normalized === superadminGmail ? 'Master Admin Trực (Gmail)' : 'Master Admin Trực',
        categories: ['ug', 'pg', 'general']
      }
    });
  }

  const isAdmin = db.admins && db.admins.map(e => e.toLowerCase()).includes(normalized);
  if (isAdmin) {
    const cats = (db.adminPermissions && db.adminPermissions[normalized]) || ['ug', 'pg', 'general'];
    return res.json({
      success: true,
      user: {
        email: normalized,
        role: 'admin',
        name: normalized.split('@')[0],
        categories: cats
      }
    });
  }

  return res.json({
    success: false,
    isUnregisteredAdmin: true,
    email: normalized,
    message: `Tài khoản của bạn (${normalized}) đã được xác thực thành công. Tuy nhiên quyền truy cập cán bộ chưa được Quản trị tối cao (tructn@vwa.edu.vn) phê duyệt. Vui lòng liên hệ Thầy Trực để được phê duyệt gán quyền cán bộ.`
  });
});

// APIs managing admin accounts list
app.get('/api/admins', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const db = readDB();
  const adminsList = db.admins || ['tructn@vwa.edu.vn'];
  
  const isAuthorized = requesterEmail === 'tructn@vwa.edu.vn' || 
                       requesterEmail === 'trinhngoctruc@gmail.com' || 
                       adminsList.map(e => e.toLowerCase()).includes(requesterEmail);
  
  if (!isAuthorized) {
    return res.status(403).json({ success: false, message: 'Từ chối truy cập. Bạn không có quyền truy cập trang quản lý cán bộ.' });
  }

  const permissions = db.adminPermissions || {};

  const adminsWithPerms = adminsList.map(email => {
    const lowEmail = email.toLowerCase();
    const cats = permissions[lowEmail] || ['ug', 'pg', 'general'];
    return { email, categories: cats };
  });

  res.json({ success: true, admins: adminsWithPerms });
});

app.post('/api/admins', (req, res) => {
  const requesterEmail = String(req.body.creatorEmail || '').trim().toLowerCase();
  const { newAdminEmail, categories } = req.body;

  if (requesterEmail !== 'tructn@vwa.edu.vn' && requesterEmail !== 'trinhngoctruc@gmail.com') {
    return res.status(403).json({ success: false, message: 'Chỉ có tài khoản quản trị tối cao (tructn@vwa.edu.vn) mới có quyền cấp phép.' });
  }

  if (!newAdminEmail) {
    return res.status(450).json({ success: false, message: 'Vui lòng điền email cán bộ cần thêm.' });
  }

  const targetEmail = newAdminEmail.trim().toLowerCase();
  const db = readDB();
  if (!db.admins) {
    db.admins = ['tructn@vwa.edu.vn'];
  }

  if (db.admins.map(e => e.toLowerCase()).includes(targetEmail)) {
    return res.status(400).json({ success: false, message: 'Cán bộ này đã được cấp quyền quản trị trước đó.' });
  }

  db.admins.push(targetEmail);

  if (!db.adminPermissions) {
    db.adminPermissions = {};
  }
  db.adminPermissions[targetEmail] = Array.isArray(categories) && categories.length > 0 ? categories : ['ug', 'pg', 'general'];

  writeDB(db);

  const permissions = db.adminPermissions || {};
  const adminsWithPerms = db.admins.map(email => {
    const lowEmail = email.toLowerCase();
    const cats = permissions[lowEmail] || ['ug', 'pg', 'general'];
    return { email, categories: cats };
  });

  res.json({ success: true, message: `Thêm cán bộ ${targetEmail} thành công và phân phối phạm vi quản lý!`, admins: adminsWithPerms });
});

app.put('/api/admins/:email/permissions', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const { email } = req.params;
  const { categories } = req.body;

  if (requesterEmail !== 'tructn@vwa.edu.vn') {
    return res.status(403).json({ success: false, message: 'Chỉ có tài khoản quản trị tối cao (tructn@vwa.edu.vn) mới có quyền cập nhật phân quyền.' });
  }

  const targetEmail = String(email || '').trim().toLowerCase();
  const db = readDB();
  
  if (!db.admins || !db.admins.map(e => e.toLowerCase()).includes(targetEmail)) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy cán bộ để cập nhật quyền.' });
  }

  if (!db.adminPermissions) {
    db.adminPermissions = {};
  }

  db.adminPermissions[targetEmail] = Array.isArray(categories) ? categories : [];
  writeDB(db);

  const permissions = db.adminPermissions || {};
  const adminsWithPerms = db.admins.map(email => {
    const lowEmail = email.toLowerCase();
    const cats = permissions[lowEmail] || ['ug', 'pg', 'general'];
    return { email, categories: cats };
  });

  res.json({ success: true, message: `Cập nhật phân quyền cho ${targetEmail} thành công!`, admins: adminsWithPerms });
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
    if (db.adminPermissions) {
      delete db.adminPermissions[targetEmail];
    }
    writeDB(db);
  }

  const permissions = db.adminPermissions || {};
  const adminsWithPerms = (db.admins || ['tructn@vwa.edu.vn']).map(email => {
    const lowEmail = email.toLowerCase();
    const cats = permissions[lowEmail] || ['ug', 'pg', 'general'];
    return { email, categories: cats };
  });

  res.json({ success: true, message: `Đã xóa quyền cán bộ của ${targetEmail}.`, admins: adminsWithPerms });
});

// Category/System training management endpoints
app.get('/api/categories', (req, res) => {
  const db = readDB();
  if (!db.categories || !Array.isArray(db.categories)) {
    db.categories = [
      { id: 'ug', name: 'Đại học Chính quy', description: 'Hệ đào tạo Đại học chính quy Học viện Phụ nữ Việt Nam', isActive: true },
      { id: 'pg', name: 'Thạc sĩ - Sau đại học', description: 'Chương trình đào tạo Sau đại học gồm Thạc sĩ và Tiến sĩ', isActive: true },
      { id: 'general', name: 'Hỏi đáp & Tổng quan', description: 'Giải đáp thắc mắc tuyển sinh chung toàn trường', isActive: true }
    ];
    writeDB(db);
  }
  res.json({ success: true, categories: db.categories });
});

app.post('/api/categories', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const db = readDB();
  const isAdmin = db.admins && db.admins.map(e => e.toLowerCase()).includes(requesterEmail);
  const isSuper = requesterEmail === 'tructn@vwa.edu.vn';
  if (!isAdmin && !isSuper) {
    return res.status(403).json({ success: false, message: 'Chỉ có cán bộ quản trị mới có quyền thêm hệ đào tạo mới.' });
  }

  const { id, name, description, isActive } = req.body;
  if (!id || !name) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp đầy đủ Mã hệ (ID) và Tên hệ đào tạo.' });
  }

  const code = id.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Mã hệ đào tạo chỉ được chứa chữ thường không dấu, số, dấu gạch dưới hoặc gạch ngang.' });
  }

  if (!db.categories || !Array.isArray(db.categories)) {
    db.categories = [
      { id: 'ug', name: 'Đại học Chính quy', description: 'Hệ đào tạo Đại học chính quy Học viện Phụ nữ Việt Nam', isActive: true },
      { id: 'pg', name: 'Thạc sĩ - Sau đại học', description: 'Chương trình đào tạo Sau đại học gồm Thạc sĩ và Tiến sĩ', isActive: true },
      { id: 'general', name: 'Hỏi đáp & Tổng quan', description: 'Giải đáp thắc mắc tuyển sinh chung toàn trường', isActive: true }
    ];
  }

  if (db.categories.some(c => c.id === code)) {
    return res.status(400).json({ success: false, message: `Mã hệ đào tạo "${code}" đã tồn tại trên hệ thống.` });
  }

  db.categories.push({
    id: code,
    name: name.trim(),
    description: (description || '').trim(),
    isActive: isActive !== false
  });

  writeDB(db);
  res.json({ success: true, message: `Thêm hệ đào tạo "${name.trim()}" thành công!`, categories: db.categories });
});

app.put('/api/categories/:id', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const db = readDB();
  const isAdmin = db.admins && db.admins.map(e => e.toLowerCase()).includes(requesterEmail);
  const isSuper = requesterEmail === 'tructn@vwa.edu.vn';
  if (!isAdmin && !isSuper) {
    return res.status(403).json({ success: false, message: 'Chỉ có cán bộ quản trị mới có quyền chỉnh sửa hệ đào tạo.' });
  }

  const { id } = req.params;
  const { name, description, isActive } = req.body;

  if (!db.categories || !Array.isArray(db.categories)) {
    db.categories = [
      { id: 'ug', name: 'Đại học Chính quy', description: 'Hệ đào tạo Đại học chính quy Học viện Phụ nữ Việt Nam', isActive: true },
      { id: 'pg', name: 'Thạc sĩ - Sau đại học', description: 'Chương trình đào tạo Sau đại học gồm Thạc sĩ và Tiến sĩ', isActive: true },
      { id: 'general', name: 'Hỏi đáp & Tổng quan', description: 'Giải đáp thắc mắc tuyển sinh chung toàn trường', isActive: true }
    ];
  }

  const catIndex = db.categories.findIndex(c => c.id === id);
  if (catIndex === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hệ đào tạo cần sửa đổi.' });
  }

  if (name !== undefined) {
    db.categories[catIndex].name = name.trim();
  }
  if (description !== undefined) {
    db.categories[catIndex].description = description.trim();
  }
  if (isActive !== undefined) {
    db.categories[catIndex].isActive = !!isActive;
  }

  writeDB(db);
  res.json({ success: true, message: `Cập nhật hệ đào tạo "${id}" thành công!`, categories: db.categories });
});

app.delete('/api/categories/:id', (req, res) => {
  const requesterEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const db = readDB();
  const isAdmin = db.admins && db.admins.map(e => e.toLowerCase()).includes(requesterEmail);
  const isSuper = requesterEmail === 'tructn@vwa.edu.vn';
  if (!isAdmin && !isSuper) {
    return res.status(403).json({ success: false, message: 'Chỉ có cán bộ quản trị mới có quyền xóa hệ đào tạo.' });
  }

  const { id } = req.params;
  if (!db.categories || !Array.isArray(db.categories)) {
    return res.status(404).json({ success: false, message: 'Danh sách hệ đào tạo trống.' });
  }

  const catIndex = db.categories.findIndex(c => c.id === id);
  if (catIndex === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hệ đào tạo để thực hiện xóa.' });
  }

  // Prevent deleting core general
  if (id === 'general') {
    return res.status(400).json({ success: false, message: 'Không thể xóa hệ đào tạo mặc định hệ thống (general).' });
  }

  // Safety check: is it in use by docs or faqs?
  const docsCount = (db.documents || []).filter(doc => doc.category === id).length;
  const faqsCount = (db.faqs || []).filter(faq => faq.category === id).length;

  if (docsCount > 0 || faqsCount > 0) {
    return res.status(400).json({
      success: false,
      message: `Không thể xóa hệ đào tạo "${id}". Hiện đang có ${docsCount} tài liệu và ${faqsCount} câu hỏi FAQ được gán mã này. Vui lòng chuyển hướng hoặc xóa các tài liệu/FAQ này trước.`
    });
  }

  db.categories = db.categories.filter(c => c.id !== id);
  writeDB(db);
  res.json({ success: true, message: `Đã xóa hoàn toàn hệ đào tạo "${id}" khỏi hệ thống!`, categories: db.categories });
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

// API Endpoints for 1-1 consultations
app.post('/api/consultations', express.json(), (req, res) => {
  const { name, phone, email, level, notes } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ success: false, message: 'Họ tên và số điện thoại là bắt buộc.' });
  }
  const db = readDB();
  if (!db.consultations) db.consultations = [];
  const newItem: ConsultationItem = {
    id: 'consult-' + Date.now(),
    name,
    phone,
    email: email || '',
    level: level || 'ug',
    notes: notes || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.consultations.push(newItem);
  writeDB(db);
  res.json({ success: true, consultation: newItem });
});

app.get('/api/consultations', (req, res) => {
  const db = readDB();
  res.json(db.consultations || []);
});

app.post('/api/consultations/:id/status', express.json(), (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'pending', 'contacted', 'cancelled'
  const db = readDB();
  if (!db.consultations) db.consultations = [];
  const idx = db.consultations.findIndex(c => c.id === id);
  if (idx !== -1) {
    db.consultations[idx].status = status;
    writeDB(db);
    res.json({ success: true, consultation: db.consultations[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu tư vấn.' });
  }
});

app.delete('/api/consultations/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  if (!db.consultations) db.consultations = [];
  db.consultations = db.consultations.filter(c => c.id !== id);
  writeDB(db);
  res.json({ success: true });
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
  
  let greeting = '';

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
    if (body) body += `\n`;
    
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
  }

  if (!context && !matchedFaqText) {
    body += `Dạ, hiện tại Ban tuyển sinh chưa tìm thấy đoạn trích chi tiết khớp trực tiếp với câu hỏi của bạn.\n\n`;
    body += `**Bạn có thể tham khảo một số thông tin quan trọng dưới đây:**\n`;
    body += `- **Các ngành Đại học Chính quy:** Công nghệ thông tin (7480201), Truyền thông đa phương tiện (7320104), Giới và phát triển, Quản trị kinh doanh, Luật, Công tác xã hội, Tâm lý học, Quản trị dịch vụ du lịch và lữ hành...\n`;
    body += `- **Phương xét tuyển học bạ:** Thí sinh đăng ký trực tuyến bằng học bạ THPT. Hồ sơ gồm phiếu đăng ký học viện, học bạ THPT công chứng, CMND/CCCD.\n`;
    body += `- **Tuyển sinh Sau đại học:** Đào tạo trình độ Thạc sĩ các ngành Luật hiến pháp & Luật hành chính, Công tác xã hội, Quản trị kinh doanh.\n`;
  }

  let footer = '';

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

interface ChatCacheEntry {
  answer: string;
  suggested: string[];
  date: number;
}
const chatCache = new Map<string, ChatCacheEntry>();

function scoreFaqMatch(userQuery: string, faqQuestion: string): number {
  const q1 = userQuery.toLowerCase().replace(/[?.,!/]/g, '').trim();
  const q2 = faqQuestion.toLowerCase().replace(/[?.,!/]/g, '').trim();
  
  if (q1 === q2) return 1.0; // Perfect match
  
  const words1 = q1.split(/\s+/).filter(w => w.length > 2);
  const words2 = q2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matchCount = 0;
  words1.forEach(w => {
    if (words2.includes(w)) {
      matchCount++;
    }
  });
  
  return (2 * matchCount) / (words1.length + words2.length);
}

// 5.5 ROBUST GEIMINI RESPONSE CLEANING & RECOVERY HELPERS
function cleanJsonString(str: string): string {
  if (!str) return '{}';
  
  let cleaned = str.trim();
  // Remove markdown code blocks if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "");
    cleaned = cleaned.replace(/\n?```$/, "");
    cleaned = cleaned.trim();
  }

  // Scan and escape unescaped literal newlines and control characters inside double-quoted strings
  let result = "";
  let inString = false;
  let escapeActive = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escapeActive) {
        result += char;
        escapeActive = false;
      } else if (char === '\\') {
        result += char;
        escapeActive = true;
      } else if (char === '"') {
        result += char;
        inString = false;
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      result += char;
      if (char === '"') {
        inString = true;
      }
    }
  }
  return result;
}

function safeParseGeminiResponse(rawText: string): { answer: string; suggested: string[] } {
  const trimmed = rawText.trim();
  
  // Tier 1: Try parsing directly to avoid any potential corruption from regex or custom cleaners
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        answer: parsed.answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.",
        suggested: Array.isArray(parsed.suggested) ? parsed.suggested : []
      };
    }
  } catch (err) {
    // Standard parse failed, proceed to next steps
  }

  // Tier 2: Strip outer markdown wrappers (```json ... ```) first, then parse directly
  let stripped = trimmed;
  if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```(?:json)?\n?/, "");
    stripped = stripped.replace(/\n?```$/, "");
    stripped = stripped.trim();
  }

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') {
      return {
        answer: parsed.answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.",
        suggested: Array.isArray(parsed.suggested) ? parsed.suggested : []
      };
    }
  } catch (err) {
    // Continue below
  }

  // Tier 3: Extreme Custom Non-Strict Parser (Extract text blocks directly from raw string)
  // This completely bypasses JSON syntax errors like unescaped nested quotes in answer or suggestions
  try {
    let textToScan = trimmed;
    if (textToScan.startsWith("```")) {
      textToScan = textToScan.replace(/^```(?:json)?\n?/, "");
      textToScan = textToScan.replace(/\n?```$/, "");
      textToScan = textToScan.trim();
    }

    let answer = "";
    let suggested: string[] = [];

    // 1. Extract "answer" string
    const answerKeyMatch = textToScan.match(/"answer"\s*:\s*"/);
    if (answerKeyMatch && answerKeyMatch.index !== undefined) {
      const startIdx = answerKeyMatch.index + answerKeyMatch[0].length;
      
      // Look for the closing quote of "answer".
      // We look for where "suggested" or the list end starts.
      const suggestedKeyMatch = textToScan.match(/"suggested"\s*/);
      let endIdx = -1;

      if (suggestedKeyMatch && suggestedKeyMatch.index !== undefined && suggestedKeyMatch.index > startIdx) {
        const suggestedStart = suggestedKeyMatch.index;
        // Search backwards from suggestedStart - 1
        for (let j = suggestedStart - 1; j >= startIdx; j--) {
          if (textToScan[j] === '"') {
            const sub = textToScan.substring(j + 1, suggestedStart).trim();
            if (sub === "" || sub === "," || sub === ", ") {
              endIdx = j;
              break;
            }
          }
        }
      } else {
        // If "suggested" is not after "answer", maybe "answer" is at the end.
        // Search backwards from the end of the string.
        for (let j = textToScan.length - 1; j >= startIdx; j--) {
          if (textToScan[j] === '"') {
            const sub = textToScan.substring(j + 1).trim();
            if (sub === "" || sub === "}" || sub === "}\n" || sub === "};") {
              endIdx = j;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const rawContent = textToScan.substring(startIdx, endIdx);
        // Replace standard escape sequences
        answer = rawContent
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      } else {
        // Fallback for truncated JSON where closing quote of "answer" string is cut off
        let rawContent = textToScan.substring(startIdx).trim();
        if (rawContent.endsWith('"}')) {
          rawContent = rawContent.slice(0, -2);
        } else if (rawContent.endsWith('}')) {
          rawContent = rawContent.slice(0, -1);
        }
        if (rawContent.endsWith('"')) {
          rawContent = rawContent.slice(0, -1);
        }
        answer = rawContent
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }

    // 2. Extract "suggested" array items
    const suggestedKeyMatchForList = textToScan.match(/"suggested"\s*/);
    if (suggestedKeyMatchForList && suggestedKeyMatchForList.index !== undefined) {
      const listStart = textToScan.indexOf('[', suggestedKeyMatchForList.index);
      if (listStart !== -1) {
        const listEnd = textToScan.lastIndexOf(']');
        if (listEnd !== -1 && listEnd > listStart) {
          const listText = textToScan.substring(listStart + 1, listEnd).trim();
          if (listText) {
            let cleanedListText = listText;
            if (cleanedListText.startsWith('"') && cleanedListText.endsWith('"')) {
              cleanedListText = cleanedListText.substring(1, cleanedListText.length - 1);
            }
            const items = cleanedListText.split(/"\s*,\s*"/);
            suggested = items.map(item => 
              item.trim()
                .replace(/\\n/g, '\n')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\')
            ).filter(item => item.length > 0);
          }
        }
      }
    }

    if (answer || suggested.length > 0) {
      console.log("[JSON Robust Scanner] Successfully recovered block parse on raw text:", { hasAnswer: !!answer, suggestedCount: suggested.length });
      return {
        answer: answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.",
        suggested: suggested
      };
    }
  } catch (scanErr) {
    console.log("[JSON Robust Scanner info] Scanner fallback logic failed, continuing.", scanErr);
  }

  // Tier 4: Run custom robust cleaning to handle unescaped control codes and parse
  const cleaned = cleanJsonString(rawText);
  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: parsed.answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.",
      suggested: Array.isArray(parsed.suggested) ? parsed.suggested : []
    };
  } catch (parseErr) {
    console.log("[JSON Parse Err debug] Failed standard JSON parse on cleaned text, executing regex recovery.", parseErr);
    
    let answer = "";
    const suggested: string[] = [];
    
    // Regex fallback: Match "answer" field
    const answerMatch = cleaned.match(/"answer"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"|}|,?\s*"suggested")/);
    if (answerMatch && answerMatch[1]) {
      answer = answerMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else {
      const looseAnswerMatch = cleaned.match(/"answer"\s*:\s*"([\s\S]*)$/);
      if (looseAnswerMatch && looseAnswerMatch[1]) {
        let rawAns = looseAnswerMatch[1].trim();
        if (rawAns.endsWith('"}')) {
          rawAns = rawAns.slice(0, -2);
        } else if (rawAns.endsWith('}')) {
          rawAns = rawAns.slice(0, -1);
        }
        answer = rawAns
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }

    // Match "suggested" field list
    const suggestedMatch = cleaned.match(/"suggested"\s*:\s*\[([\s\S]*?)\]/);
    if (suggestedMatch && suggestedMatch[1]) {
      const itemsText = suggestedMatch[1];
      const itemRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      let m;
      while ((m = itemRegex.exec(itemsText)) !== null) {
        suggested.push(
          m[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
        );
      }
    }

    if (answer || suggested.length > 0) {
      console.log("[JSON Regex Recovery] Successfully extracted from broken JSON:", { hasAnswer: !!answer, suggestedCount: suggested.length });
      return {
        answer: answer || "Dạ, Học viện chưa tìm thấy thông tin tương thích.",
        suggested
      };
    }
    
    throw parseErr;
  }
}

// 6. CHATBOT CORE INTELLIGENT HANDLER
app.post('/api/chat', async (req, res) => {
  try {
    const { message, activeCategory, history } = req.body; // activeCategory: 'ug', 'pg', 'general', 'all'
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message trống hoặc sai định dạng.' });
    }

    // Build optimized conversation history sliding window of last 6 messages
    let formattedHistory = '';
    if (Array.isArray(history) && history.length > 0) {
      const recentHistory = history.slice(-6);
      formattedHistory = recentHistory.map(h => `${h.sender === 'user' ? 'Thí sinh' : 'AI Trợ lý'}: ${h.text}`).join('\n');
    }

    const db = readDB();
    const gemini = getGeminiClient();

    // 0. Đọc cấu hình phân hệ kiểm soát chi phi & định tuyến AI
    const config = db.schoolConfig || {
      aiRoutingMode: 'hybrid',
      faqConfidenceThreshold: 40,
      defaultModel: 'gemini-3.5-flash',
      aiMaxTokens: 8192,
      enableCache: true
    };
    const routingMode = config.aiRoutingMode || 'hybrid';
    const confidenceThreshold = config.faqConfidenceThreshold !== undefined ? Number(config.faqConfidenceThreshold) : 40;
    const currentModel = config.defaultModel || 'gemini-3.5-flash';
    const maxTokens = config.aiMaxTokens !== undefined ? Math.max(Number(config.aiMaxTokens), 8192) : 8192;
    const isCacheEnabled = config.enableCache !== undefined ? Boolean(config.enableCache) : true;

    // 1. Kiểm tra bộ nhớ đệm (Response Cache) - Hoàn toàn miễn phí, phản hồi tức thì
    const cacheKey = `${message.trim().toLowerCase()}##${activeCategory || 'all'}`;
    if (isCacheEnabled && chatCache.has(cacheKey)) {
      const cached = chatCache.get(cacheKey)!;
      if (Date.now() - cached.date < 43200000) { // Bộ nhớ đệm hợp lệ trong 12 tiếng
        console.log(`[Cache Hit] Trả về câu trả lời đã lưu từ bộ nhớ cache cho câu hỏi: "${message}"`);
        
        const historyId = 'hist_cache_' + Date.now();
        db.history.unshift({
          id: historyId,
          timestamp: new Date().toISOString(),
          question: message,
          answer: cached.answer,
          categoryMatched: activeCategory === 'all' ? 'general' : activeCategory,
          feedback: null,
          tags: ['Cache-Hit'],
          documentReferenced: ['Bộ nhớ đệm thông minh']
        });
        writeDB(db);

        return res.json({
          success: true,
          id: historyId,
          answer: cached.answer,
          suggested: cached.suggested,
          isCached: true,
          routingStrategy: 'response_cache'
        });
      }
    }

    // 2. Chế độ Định tuyến FAQ nội bộ trước (Bypass LLM nếu độ tương đồng cao)
    let bestFaq: FAQ | null = null;
    let highestScore = 0;
    if (routingMode === 'hybrid' || routingMode === 'faq_only') {
      db.faqs.forEach(faq => {
        const score = scoreFaqMatch(message, faq.question);
        if (score > highestScore) {
          highestScore = score;
          bestFaq = faq;
        }
      });
    }

    if ((routingMode === 'hybrid' && bestFaq && (highestScore * 100 >= confidenceThreshold)) || (routingMode === 'faq_only' && bestFaq && highestScore > 0.15)) {
      console.log(`[Router Match] Đã tìm thấy FAQ tương thích cao (${Math.round(highestScore * 100)}%). Bỏ qua cuộc gọi API tới Gemini để tiết kiệm token!`);
      
      const replyAnswer = (bestFaq as FAQ).answer;
      const defaultSuggestions = [
        "Xét tuyển bằng phương thức học bạ ra sao?",
        "Học phí hệ chính quy dự kiến năm nay là bao nhiêu?",
        "Chế độ học bổng ưu đãi của trường?"
      ];
      const relatedFaqs = db.faqs
        .filter(f => f.id !== (bestFaq as FAQ).id)
        .slice(0, 3)
        .map(f => f.question);
      const suggestions = relatedFaqs.length >= 3 ? relatedFaqs : [...relatedFaqs, ...defaultSuggestions].slice(0, 3);
      
      const historyId = 'hist_faq_' + Date.now();
      db.history.unshift({
        id: historyId,
        timestamp: new Date().toISOString(),
        question: message,
        answer: replyAnswer,
        categoryMatched: activeCategory === 'all' ? 'general' : activeCategory,
        feedback: null,
        tags: ['FAQ-Router'],
        documentReferenced: ['Câu hỏi thường gặp']
      });
      writeDB(db);

      return res.json({
        success: true,
        id: historyId,
        answer: replyAnswer,
        suggested: suggestions,
        routingStrategy: 'faq_bypass'
      });
    }

    // 3. Tìm kiếm ngữ cảnh tài liệu qua RAG thông minh (Đã rút gọn tối ưu chỉ lấy top 4 đoạn để tiết kiệm token)
    const { context, sources } = searchDocsContext(message, activeCategory || 'all');

    let matchedFaqText = '';
    const relevantFaqs = db.faqs.filter(faq => {
      const qLower = faq.question.toLowerCase();
      const matchesCount = message.toLowerCase().split(/\s+/).filter(w => w.length > 2 && qLower.includes(w)).length;
      return matchesCount > 2;
    });
    if (relevantFaqs.length > 0) {
      matchedFaqText = `[Các câu hỏi bổ sung liên quan tìm được từ Hệ thống FAQ]:\n` + 
        relevantFaqs.map(f => `Hỏi: ${f.question}\nĐáp: ${f.answer}`).join('\n\n');
    }

    // Tự động phân loại luồng danh mục
    let detectedCategory = activeCategory === 'all' ? 'general' : (activeCategory || 'general');
    const msgLower = message.toLowerCase();
    if (detectedCategory === 'general') {
      if (msgLower.includes('đại học') || msgLower.includes('cử nhân') || msgLower.includes('học bạ thpt')) {
        detectedCategory = 'ug';
      } else if (msgLower.includes('thạc sĩ') || msgLower.includes('tiến sĩ') || msgLower.includes('sau đại học') || msgLower.includes('sau đh') || msgLower.includes('cao học')) {
        detectedCategory = 'pg';
      }
    }

    // 4. Sinh phản hồi AI bằng cách gọi Gemini SDK chính thức
    let mainAnswer = '';
    let suggestedQuestions: string[] = [];

    const systemInstruction = `Bạn là Chuyên gia Tư vấn Tuyển sinh thông thái mang tên "VWA Assistant" của Học viện Phụ nữ Việt Nam (VWA).
Hãy trả lời các câu hỏi dựa TRÊN NGUỒN TÀI LIỆU CHÍNH THỐNG được cung cấp.

Khi tư vấn và trả lời, hãy áp dụng các nguyên tắc hàng đầu sau:
1. ĐƯA THẲNG CÂU TRẢ LỜI ĐẦY ĐỦ, CHI TIẾT & CHÍNH XÁC NHẤT:
   - Khi có câu hỏi, Bạn phải cung cấp câu trả lời tuyệt đối ĐẦY ĐỦ, CHI TIẾT, TOÀN DIỆN và CHÍNH XÁC NHẤT dựa trên các tài liệu tuyển sinh được cung cấp.
   - Tuyệt đối KHÔNG ĐƯỢC lược bỏ bớt các thông tin quan trọng, không được tóm tắt quá ngắn làm thiếu hụt số liệu hay nội dung chi tiết cần thiết. Hãy đảm bảo đưa ra câu trả lời chi tiết và rõ ràng nhất để người học không phải tự tìm kiếm hay đoán mò.
   - Để tiết kiệm token thông minh mà không làm ảnh hưởng đến độ dài và độ chi tiết của câu trả lời, bạn hãy TUYỆT ĐỐI BỎ các câu xã giao chào hỏi lê thê ở đầu câu trả lời và lời kết chúc tụng, dặn dò rườm rà ở cuối câu trả lời.
   - TUYỆT ĐỐI KHÔNG thêm bất kỳ câu nào đại loại như: "Để được hỗ trợ giải đáp nhanh chóng và đầy đủ...", "Quý học viên vui lòng liên hệ trực tiếp qua số Hotline...", hay câu cảnh báo nguồn "⚠️ Thông tin được tra cứu và trích xuất trực tiếp từ các tài liệu tuyển sinh chính thống..." ở cuối câu trả lời.

2. SỰ CHUẨN XÁC TRONG TRÍCH XUẤT SỐ LIỆU ĐỀ ÁN:
   - Khi dẫn thông tin có số liệu (học phí, tổ hợp môn, mã ngành, hotline, chỉ tiêu tuyển sinh), bạn phải đối chiếu rà soát thật kỹ từ nguồn ngữ cảnh đi kèm và giữ nguyên tính chính xác 100%. Hãy in đậm các mã tổ hợp (ví dụ: **A00**, **D01**), mã ngành (ví dụ: **7480201**), số hotline tuyển sinh (**024.3775.1750**) và học phí cụ thể.
   - TUYỆT ĐỐI KHÔNG tự bịa ra học phí, mã hay con số mà tài liệu không ghi.

3. GIỚI HẠN THÔNG TIN HOÀN TOÀN TỰ NHIÊN:
   - Nếu trong dữ liệu cung cấp hoàn toàn không đề cập thông tin cần tìm, hãy chân thành giải thích ngắn gọn: "Dạ, hiện tại trong nguồn dữ liệu đề án tuyển sinh chính thức không có thông tin chi tiết về [tên nội dung]."

4. ĐỊNH DẠNG DẠNG BẢNG (TABLE) KHI LIỆT KÊ SỐ LIỆU & TỐI ƯU HÓA TOKEN TRÁNH CẮT XÉN:
   - ĐẶC BIỆT LƯU Ý: Đối với các câu hỏi mang tính chất liệt kê danh sách, chứa số liệu hoặc thống kê (ví dụ: chỉ tiêu tuyển sinh chi tiết từng ngành, danh sách các ngành đào tạo, tổ hợp môn xét tuyển, mức học phí của từng ngành...), bạn BẮT BUỘC phải trình bày dưới dạng BẢNG (Markdown Table) với các cột phân tách rõ ràng (ví dụ: STT, Tên ngành, Mã ngành, Chỉ tiêu, Tổ hợp môn,...).
   - TỐI ƯU HÓA BẢNG LIỆT KÊ: Để tránh câu trả lời bảng biểu bị lặp rườm rà dẫn đến vượt quá giới hạn độ dài hiển thị (gây lỗi cắt cụt JSON), bạn tuyệt đối KHÔNG lặp lại các cột tẻ nhạt (như cột "Cơ sở" hay "Phương thức tuyển sinh" lặp lại giống hệt nhau ở mọi hàng). Hãy đơn giản hóa bảng, chỉ trình bày các cột cốt lõi nhất: STT, Tên ngành/chương trình, Mã xét tuyển, Chỉ tiêu tuyển sinh, Tổ hợp xét tuyển. Việc thiết kế bảng biểu thanh lịch, súc tích giúp mang lại tỷ lệ hiển thị mỹ thuật tối đa trên thiết bị di động và loại trừ 100% mọi nguy cơ cắt cụt văn bản!
   - Tuyệt đối không viết gạch đầu dòng lê thê hoặc một khối chữ liền mạch khó theo dõi khi thông tin có cấu trúc nhiều thành phần cột. Xuống dòng ngắt đoạn thông thoáng, gọn gàng để tối ưu hóa việc hiển thị.

Định dạng đầu ra:
Bạn bắt buộc phải trả về câu trả lời ở định dạng JSON thô (raw JSON) theo schema:
{
  "answer": "Nội dung câu trả lời đầy đủ, vô cùng chi tiết, rõ ràng và chính xác tuyệt đối bằng văn bản Markdown.",
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
          model: currentModel,
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
            },
            maxOutputTokens: maxTokens
          }
        });

        const jsonRes = safeParseGeminiResponse(generation.text || '{}');
        mainAnswer = jsonRes.answer;
        suggestedQuestions = jsonRes.suggested;
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

    // Luôn lưu cache nếu thành công và cache bật
    if (isCacheEnabled && mainAnswer) {
      chatCache.set(cacheKey, {
        answer: mainAnswer,
        suggested: suggestedQuestions,
        date: Date.now()
      });
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
      routingStrategy: 'llm_gemini_api'
    });
  } catch (err: any) {
    console.error('Lỗi ở Chatbot API:', err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + err.message });
  }
});

// GET school profile configuration
app.get('/api/school-config', (req, res) => {
  try {
    const db = readDB();
    res.json(db.schoolConfig || {
      name: "Học viện Phụ nữ Việt Nam",
      shortName: "VWA",
      logoUrl: "",
      logoIcon: "GraduationCap",
      address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
      hotline: "024.3775.1750",
      email: "tuyensinh@vwa.edu.vn",
      website: "https://tuyensinh.hvpnvn.edu.vn/"
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi tải thông tin đơn vị: ' + err.message });
  }
});

// POST update school profile configuration
app.post('/api/school-config', express.json(), (req, res) => {
  try {
    const db = readDB();
    const newConfig = req.body;
    if (!newConfig.name || !newConfig.shortName || !newConfig.address) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc (Tên trường, Tên viết tắt, Địa chỉ)' });
    }
    
    db.schoolConfig = {
      name: newConfig.name,
      shortName: newConfig.shortName,
      logoUrl: newConfig.logoUrl || '',
      logoIcon: newConfig.logoIcon || 'GraduationCap',
      address: newConfig.address,
      hotline: newConfig.hotline || '024.3775.1750',
      email: newConfig.email || 'tuyensinh@vwa.edu.vn',
      website: newConfig.website || 'https://tuyensinh.hvpnvn.edu.vn/',
      // Phân hệ Tối ưu chi phí & Định tuyến thông minh
      aiRoutingMode: newConfig.aiRoutingMode || 'hybrid',
      faqConfidenceThreshold: newConfig.faqConfidenceThreshold !== undefined ? Number(newConfig.faqConfidenceThreshold) : 40,
      defaultModel: newConfig.defaultModel || 'gemini-3.5-flash',
      aiMaxTokens: newConfig.aiMaxTokens !== undefined ? Number(newConfig.aiMaxTokens) : 8192,
      enableCache: newConfig.enableCache !== undefined ? Boolean(newConfig.enableCache) : true
    };
    
    writeDB(db);
    res.json({ success: true, schoolConfig: db.schoolConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi lưu thông tin đơn vị: ' + err.message });
  }
});

// POST upload custom school logo image
app.post('/api/school-config/logo', upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không có tệp tải lên' });
    }
    
    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const fileExt = path.extname(req.file.originalname) || '.png';
    const filename = `logo_school_${Date.now()}${fileExt}`;
    const destination = path.join(UPLOAD_DIR, filename);
    
    fs.writeFileSync(destination, req.file.buffer);
    
    const logoUrl = `/api/uploads/${filename}`;
    
    const db = readDB();
    if (!db.schoolConfig) {
      db.schoolConfig = {
        name: "Học viện Phụ nữ Việt Nam",
        shortName: "VWA",
        logoUrl: logoUrl,
        logoIcon: "GraduationCap",
        address: "Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội",
        hotline: "024.3775.1750",
        email: "tuyensinh@vwa.edu.vn",
        website: "https://tuyensinh.hvpnvn.edu.vn/"
      };
    } else {
      db.schoolConfig.logoUrl = logoUrl;
    }
    writeDB(db);
    
    res.json({ success: true, logoUrl, schoolConfig: db.schoolConfig });
  } catch (err: any) {
    console.error('Lỗi khi tải logo lên:', err);
    res.status(500).json({ success: false, message: 'Lỗi tải logo máy chủ: ' + err.message });
  }
});

// Auto-synchronize static RAG files in source tree to db.json on startup
async function syncStaticRAGDocuments() {
  console.log('[RAG Syncer] Starting static RAG documents synchronization...');
  const categories = ['ug', 'pg', 'general'];
  const db = readDB();
  let updated = false;

  // 1. Legacy directory scanner (for backward compatibility)
  for (const cat of categories) {
    const catDir = path.join(process.cwd(), 'uploads', cat);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
      continue;
    }

    const files = fs.readdirSync(catDir);
    for (const filename of files) {
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (!['txt', 'md', 'docx'].includes(ext)) {
        continue;
      }

      // Check if this file is already indexed in db.documents
      const alreadyIndexed = db.documents.some(doc => doc.filename === filename && doc.category === cat);
      if (alreadyIndexed) {
        continue;
      }

      console.log(`[RAG Syncer] Found new static legacy document: ${filename} in category ${cat}. Indexing...`);
      const filePath = path.join(catDir, filename);
      let extractedText = '';

      try {
        if (ext === 'docx') {
          const buffer = fs.readFileSync(filePath);
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;
        } else {
          extractedText = fs.readFileSync(filePath, 'utf-8');
        }

        const chunksCount = extractedText.split(/\n\s*\n/).filter((p: string) => p.trim().length > 30).length || 1;
        const newDoc: RecruitmentDocument = {
          id: 'static-doc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
          filename,
          title: filename.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
          content: extractedText,
          fileType: ext as any,
          category: cat as any,
          uploadDate: new Date().toISOString().split('T')[0],
          version: '1.0',
          isLatest: true,
          isActive: true,
          chunksCount,
          dataPath: path.join('uploads', cat, filename),
          ragPath: filePath.replace(process.cwd() + path.sep, '')
        };

        // Unmark other latest in the same category just to keep DB consistent
        db.documents.forEach(doc => {
          if (doc.category === cat) {
            doc.isLatest = false;
          }
        });

        db.documents.push(newDoc);
        updated = true;
        console.log(`[RAG Syncer] Successfully indexed static legacy document: ${filename}`);
      } catch (err) {
        console.error(`[RAG Syncer] Failed to index static legacy document ${filename}:`, err);
      }
    }
  }

  // 2. Advanced structured RAG subdirectory (uploads/RAG/<uploadDate>/[category]__[filename].md) scanner
  const ragRoot = path.join(process.cwd(), 'uploads', 'RAG');
  if (fs.existsSync(ragRoot)) {
    try {
      const dates = fs.readdirSync(ragRoot);
      for (const dDir of dates) {
        const fullDDir = path.join(ragRoot, dDir);
        if (!fs.statSync(fullDDir).isDirectory()) continue;
        
        const files = fs.readdirSync(fullDDir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          
          let category: 'ug' | 'pg' | 'general' = 'general';
          let originalName = file;
          
          if (file.includes('__')) {
            const parts = file.split('__');
            const catPart = parts[0];
            if (['ug', 'pg', 'general'].includes(catPart)) {
              category = catPart as any;
              originalName = parts.slice(1).join('__');
            }
          }
          
          // Check if already indexed in db.documents by checking filename or ragPath
          const relativeRagPath = path.join('uploads', 'RAG', dDir, file);
          const alreadyIndexed = db.documents.some(doc => 
            (doc.ragPath === relativeRagPath) || 
            (doc.filename === originalName && doc.category === category)
          );
          
          if (alreadyIndexed) continue;
          
          console.log(`[RAG Syncer] Found new auto-structured document in RAG folder: ${file} (Date: ${dDir}, Category: ${category}). Indexing...`);
          const fileContent = fs.readFileSync(path.join(fullDDir, file), 'utf-8');
          const chunksCount = fileContent.split(/\n\s*\n/).filter((p: string) => p.trim().length > 30).length || 1;
          
          const newDoc: RecruitmentDocument = {
            id: 'static-rag-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            filename: originalName,
            title: originalName.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
            content: fileContent,
            fileType: 'md' as any,
            category: category,
            uploadDate: dDir,
            version: '1.0',
            isLatest: true,
            isActive: true,
            chunksCount,
            dataPath: path.join('uploads', 'Data', dDir, originalName),
            ragPath: relativeRagPath
          };
          
          db.documents.forEach(doc => {
            if (doc.category === category) {
              doc.isLatest = false;
            }
          });
          
          db.documents.push(newDoc);
          updated = true;
          console.log(`[RAG Syncer] Successfully indexed static structured RAG file: ${file}`);
        }
      }
    } catch (err) {
      console.error('[RAG Syncer] Error during structured RAG sync scan:', err);
    }
  }

  if (updated) {
    writeDB(db);
    console.log('[RAG Syncer] db.json updated with newly discovered static documents.');
  } else {
    console.log('[RAG Syncer] Static RAG documents synchronized. No new documents found.');
  }
}

// Setup Vite or build static file serving
const startExpress = async () => {
  // Check if we are running the production build from 'dist' or if NODE_ENV is set to production
  // We check both the process.cwd() and __dirname paths to ensure absolute robustness in Cloud Run container environments
  const isProduction = 
    process.env.NODE_ENV === 'production' || 
    fs.existsSync(path.join(process.cwd(), 'dist', 'index.html')) ||
    fs.existsSync(path.join(__dirname, 'index.html'));

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('[System Boot] Started in DEVELOPMENT mode with dynamic Vite middleware.');
    } catch (viteErr) {
      console.warn('[System Boot Fallback] Failed to load Vite development server, fallback to PRODUCTION static file serving:', viteErr);
      const distPath = fs.existsSync(path.join(process.cwd(), 'dist')) ? path.join(process.cwd(), 'dist') : __dirname;
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        const indexPath = fs.existsSync(path.join(distPath, 'index.html')) ? path.join(distPath, 'index.html') : path.join(process.cwd(), 'dist', 'index.html');
        res.sendFile(indexPath);
      });
    }
  } else {
    const distPath = fs.existsSync(path.join(process.cwd(), 'dist')) ? path.join(process.cwd(), 'dist') : __dirname;
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = fs.existsSync(path.join(distPath, 'index.html')) ? path.join(distPath, 'index.html') : path.join(process.cwd(), 'dist', 'index.html');
      res.sendFile(indexPath);
    });
    console.log('[System Boot] Started in PRODUCTION mode serving static files from:', distPath);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VWA Admissions Chatbot Server] running on http://0.0.0.0:${PORT}`);
    
    // Trigger background sync tasks AFTER starting to listen to prevent port-binding timeouts during container boot
    console.log('[System Boot] Port bound successfully. Initiating background sync programs...');
    syncStaticRAGDocuments()
      .then(() => {
        console.log('[System Boot] Static RAG files synchronized successfully in background.');
        return syncFirestoreToLocal();
      })
      .then(() => {
        console.log('[System Boot] Cloud Firestore data cache synchronized in background.');
      })
      .catch((err) => {
        console.error('[System Boot Error] Background initial sync failed:', err);
      });
  });
};

startExpress();

export default app;
