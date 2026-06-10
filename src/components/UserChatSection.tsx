/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Sparkles, AlertCircle, HelpCircle, Phone, Globe, BookOpen, 
  MapPin, ShieldAlert, ChevronRight, ChevronLeft, ThumbsUp, ThumbsDown, MessageSquare, 
  CheckCircle, FileText, ArrowRight, UserPlus, FileQuestion, GraduationCap
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import katex from 'katex';
import { Message, FAQ, SchoolConfig } from '../types.ts';

interface UserChatSectionProps {
  faqs: FAQ[];
  onRefreshStats: () => void;
  schoolConfig: SchoolConfig | null;
}

export default function UserChatSection({ faqs, onRefreshStats, schoolConfig }: UserChatSectionProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: `### Chào mừng quý phụ huynh, thí sinh và học viên! 👋 \n\nTôi là **VWA Assistant** - Trợ lý Tuyển sinh Thông minh của **Học viện Phụ nữ Việt Nam**.\n\nHôm nay, bạn quan tâm nội dung gì về tuyển sinh của Học viện, bạn hãy hỏi tôi nhé,  tôi rất vui vì được hỗ trợ bạn`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      category: 'general',
      suggestedQuestions: [
        '🏫 Giới thiệu tổng quan về Học viện Phụ nữ Việt Nam?',
        '🎓 Các ngành tuyển sinh Đại học chính quy năm nay?',
        '📚 Điều kiện và hồ sơ tuyển sinh Thạc sĩ?'
      ]
    }
  ]);

  // Synchronize dynamic school config changes to greeting message
  useEffect(() => {
    if (schoolConfig) {
      setMessages(prev => {
        return prev.map(msg => {
          if (msg.id === 'welcome') {
            const shortName = schoolConfig.shortName || "VWA";
            const fullName = schoolConfig.name || "Học viện Phụ nữ Việt Nam";
            const assistantName = shortName === "VWA" ? "VWA Assistant" : `${shortName} Assistant`;
            return {
              ...msg,
              text: `### Chào mừng quý phụ huynh, thí sinh và học viên! 👋 \n\nTôi là **${assistantName}** - Trợ lý Tuyển sinh Thông minh của **${fullName}**.\n\nHôm nay, bạn quan tâm nội dung gì về tuyển sinh của Học viện, bạn hãy hỏi tôi nhé,  tôi rất vui vì được hỗ trợ bạn`,
              suggestedQuestions: [
                `🏫 Giới thiệu tổng quan về ${fullName}?`,
                '🎓 Các ngành tuyển sinh Đại học chính quy năm nay?',
                '📚 Điều kiện và hồ sơ tuyển sinh Thạc sĩ?'
              ]
            };
          }
          return msg;
        });
      });
    }
  }, [schoolConfig]);

  const [inputMessage, setInputMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [categories, setCategories] = useState<{ id: string; name: string; description?: string; isActive: boolean }[]>([]);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        if (res.ok && data.success) {
          setCategories(data.categories.filter((c: any) => c.isActive));
        }
      } catch (err) {
        console.error("Lỗi nạp hệ đào tạo:", err);
      }
    };
    fetchCategories();
  }, []);

  const [responseLength, setResponseLength] = useState<'short' | 'detailed'>('detailed');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackIssued, setFeedbackIssued] = useState<{ [msgId: string]: 'up' | 'down' | null }>({});
  
  // Counselor Form State
  const [showCounselorForm, setShowCounselorForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', level: 'ug', notes: '' });
  const [formSubmitted, setFormSubmitted] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to the last question asked so that it is positioned clear and visible
  useEffect(() => {
    if (messages.length > 1) {
      // Find the last user message (question)
      let lastUserMsgId: string | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].sender === 'user') {
          lastUserMsgId = messages[i].id;
          break;
        }
      }

      if (lastUserMsgId) {
        const lastUserEl = document.getElementById(`chat-msg-${lastUserMsgId}`);
        if (lastUserEl) {
          lastUserEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }

      // Fallback
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Handle Quick Topic Buttons
  const handleQuickSearch = (topic: string) => {
    let query = '';
    if (activeCategory === 'ug') {
      switch (topic) {
        case 'ngành': query = 'Ngành đào tạo tuyển sinh Đại học chính quy năm nay gồm những ngành nào và chỉ tiêu ra sao?'; break;
        case 'học phí': query = 'Học phí các ngành Đại học là bao nhiêu và lộ trình tăng như thế nào?'; break;
        case 'phương thức': query = 'Phương thức xét tuyển Đại học gồm những phương thức nào, xét học bạ ra sao?'; break;
        case 'hồ sơ': query = 'Hồ sơ tuyển sinh Đại học cần chuẩn bị văn bản gì và nộp ở đâu?'; break;
        case 'liên hệ': query = 'Xin số điện thoại hotline tư vấn tuyển sinh Đại học và địa chỉ trường?'; break;
        default: query = topic;
      }
    } else if (activeCategory === 'pg') {
      switch (topic) {
        case 'ngành': query = 'Học viện đào tạo thạc sĩ những ngành nào và điều kiện dự tuyển ra sao?'; break;
        case 'học phí': query = 'Lệ phí và học phí sau đại học, thạc sĩ của trường là bao nhiêu?'; break;
        case 'phương thức': query = 'Phương thức tuyển sinh thạc sĩ thế nào? Có phải phỏng vấn không'; break;
        case 'hồ sơ': query = 'Hồ sơ tuyển sinh cao học thạc sĩ gồm những giấy tờ nào?'; break;
        case 'liên hệ': query = 'Xin thông tin liên hệ và lịch tuyển sinh thạc sĩ năm nay?'; break;
        default: query = topic;
      }
    } else {
      const schoolName = schoolConfig?.name || 'Học viện Phụ nữ Việt Nam';
      switch (topic) {
        case 'ngành': query = `Tổng hợp các ngành đào tạo Đại học và Thạc sĩ tại ${schoolName}?`; break;
        case 'học phí': query = `Bảng học phí đại học và thạc sĩ tại trường như thế nào?`; break;
        case 'phương thức': query = `Các phương thức xét tuyển mới nhất của ${schoolName}?`; break;
        case 'hồ sơ': query = `Hồ sơ nộp xét tuyển của trường gồm những gì?`; break;
        case 'liên hệ': query = `Địa chỉ ${schoolName} và hotline liên hệ tuyển sinh?`; break;
        default: query = topic;
      }
    }
    sendMessageToBot(query);
  };

  // Chat Submission
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;
    sendMessageToBot(inputMessage.trim());
    setInputMessage('');
  };

  // Core Send Bot Message
  const sendMessageToBot = async (text: string) => {
    // 1. Add User Message
    const userMsgId = 'msg-user-' + Date.now();
    const newUserMsg: Message = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      // Build message payload with custom instructions on length if configured
      let queryToSend = text;
      if (responseLength === 'short') {
        queryToSend += " (Hãy trả lời theo phong cách ngắn gọn, súc tích nhất, tập trung trực tiếp vào con số và thông tin cốt lõi khoảng 2-3 câu).";
      } else {
        queryToSend += " (Hãy trả lời chi tiết, trình bày khoa học bằng Markdown, có gạch đầu dòng rõ ràng để thí sinh dễ nắm bắt).";
      }

      // Call Express API
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: queryToSend,
          activeCategory: activeCategory
        })
      });

      const data = await res.json();

      if (res.ok) {
        const botMsg: Message = {
          id: data.id || 'msg-bot-' + Date.now(),
          sender: 'bot',
          text: data.answer,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          category: data.categoryMatched,
          sourceDocs: data.sourceDocs,
          suggestedQuestions: data.suggestedQuestions
        };
        setMessages(prev => [...prev, botMsg]);
        onRefreshStats(); // update stats of database counts
      } else {
        throw new Error(data.message || 'Lỗi truy vấn chatbot');
      }
    } catch (err: any) {
      console.error(err);
      
      const botErrorMsg: Message = {
        id: 'msg-bot-err-' + Date.now(),
        sender: 'bot',
        text: `⚠️ **Rất tiếc, hệ thống đang bận phản hồi!**\n\nKhông thể kết nối đến máy chủ AI hỗ trợ tuyển sinh. Thí sinh vui lòng đăng ký hỗ trợ trực tiếp từ Cán bộ Tư vấn hoặc thử lại sau vài giây.\n\n📞 **Hotline khẩn cấp:** 024.3775.1750 (Phòng Đào tạo Học viện).`,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botErrorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle upvote/downvote feedback
  const handleFeedback = async (msgId: string, rating: 'up' | 'down') => {
    // Toggle check
    const currentRating = feedbackIssued[msgId];
    const targetRating = currentRating === rating ? null : rating;
    
    setFeedbackIssued(prev => ({
      ...prev,
      [msgId]: targetRating
    }));

    try {
      await fetch(`/api/history/${msgId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: targetRating })
      });
      onRefreshStats();
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Counselor Submission
  const handleCounselorFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) return;
    setFormSubmitted(true);
    
    try {
      const res = await fetch('/api/consultations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          email: formData.email,
          level: formData.level,
          notes: formData.notes
        })
      });

      if (res.ok) {
        // Add a virtual messages showing confirmation
        const schoolName = schoolConfig?.name || "Học viện Phụ nữ Việt Nam";
        const confirmationMsg: Message = {
          id: 'contact-confirm-' + Date.now(),
          sender: 'bot',
          text: `### 🎉 Đã chuyển tiếp thành công tới Cán bộ tuyển sinh!\n\nThông tin của em đã được gửi trực tiếp đến Ban tuyển sinh **${schoolName}**.\n\n- **Học viên/Thí sinh:** ${formData.name}\n- **Số điện thoại:** ${formData.phone}\n- **Nguyện vọng tìm hiểu:** Hỗ trợ tư vấn ${formData.level === 'ug' ? 'Đại học Chính quy' : 'Thạc sĩ - Sau đại học'}\n\nCán bộ phòng đào tạo và giảng viên chuyên môn sẽ gọi điện kết nối hỗ trợ trực tiếp trực tuyến qua Zalo hoặc điện thoại cho em hoặc phụ huynh trong vòng tối đa **4 giờ làm việc** sắp tới. Chúc em vững tin và đạt kết quả cao!`,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, confirmationMsg]);
        setShowCounselorForm(false);
        setFormData({ name: '', phone: '', email: '', level: 'ug', notes: '' });
      } else {
        console.error('Lỗi khi gửi yêu cầu tư vấn 1-1');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFormSubmitted(false);
    }
  };

  // Math renderer helper using KaTeX
  const MathComponent = ({ math, block }: { math: string; block: boolean }) => {
    let html = '';
    try {
      html = katex.renderToString(math, {
        displayMode: block,
        throwOnError: false,
      });
    } catch (err) {
      console.error("KaTeX error:", err);
      html = block ? `$$\n${math}\n$$` : `$${math}$`;
    }
    return <span dangerouslySetInnerHTML={{ __html: html }} className="inline-block max-w-full overflow-x-auto align-middle" />;
  };

  // Helper to map and convert math notations in children elements
  const processInlineMath = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        const inlineParts = child.split(/(\$.*?\$)/g);
        return (
          <>
            {inlineParts.map((inlinePart, i) => {
              if (inlinePart.startsWith('$') && inlinePart.endsWith('$')) {
                const formula = inlinePart.slice(1, -1).trim();
                return <MathComponent key={i} math={formula} block={false} />;
              }
              return inlinePart;
            })}
          </>
        );
      }
      return child;
    });
  };

  // Help parsing custom simple markdown in message text using ReactMarkdown and remarkGfm with Math support
  const renderMessageContent = (text: string) => {
    if (!text) return null;

    // Split text by block formula segments: $$ ... $$
    const blockParts = text.split(/(\$\$.*?\$\$)/gs);

    return (
      <div className="markdown-body text-slate-800 space-y-2">
        {blockParts.map((part, index) => {
          if (part.startsWith('$$') && part.endsWith('$$')) {
            const formula = part.slice(2, -2).trim();
            return (
              <div key={index} className="my-4 overflow-x-auto py-2 bg-blue-50/10 rounded-xl px-4 border border-blue-100/30 text-center">
                <MathComponent math={formula} block={true} />
              </div>
            );
          } else {
            return (
              <ReactMarkdown
                key={index}
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ node, ...props }) => (
                    <div className="overflow-x-auto my-3 border border-blue-100 rounded-xl bg-blue-50/20 shadow-sm">
                      <table {...props} className="min-w-full border-collapse divide-y divide-blue-100/50 text-left" />
                    </div>
                  ),
                  thead: ({ node, ...props }) => <thead {...props} className="bg-blue-50/80" />,
                  tbody: ({ node, ...props }) => <tbody {...props} className="divide-y divide-slate-100" />,
                  tr: ({ node, ...props }) => <tr {...props} className="hover:bg-[#fbfcfe] transition-colors" />,
                  th: ({ node, ...props }) => <th {...props} className="px-4 py-2.5 text-xs font-bold text-blue-900 uppercase tracking-wider border-r border-blue-100/55 last:border-r-0 whitespace-nowrap" />,
                  td: ({ node, ...props }) => <td {...props} className="px-4 py-2.5 text-xs text-slate-700 border-r border-blue-50 last:border-r-0 align-middle leading-relaxed" />,
                  p: ({ node, children, ...props }) => <p {...props} className="text-sm text-slate-700 leading-relaxed mb-3 last:mb-0">{processInlineMath(children)}</p>,
                  ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-5 my-2.5 space-y-1 text-slate-700" />,
                  ol: ({ node, ...props }) => <ol {...props} className="list-decimal pl-5 my-2.5 space-y-1 text-slate-700" />,
                  li: ({ node, children, ...props }) => <li {...props} className="text-sm leading-relaxed">{processInlineMath(children)}</li>,
                  strong: ({ node, ...props }) => <strong {...props} className="font-bold text-pink-600" />,
                  a: ({ node, ...props }) => <a {...props} className="text-blue-600 hover:underline hover:text-pink-600 font-bold" target="_blank" rel="noreferrer" />,
                  h1: ({ node, ...props }) => <h1 {...props} className="text-xl font-bold text-blue-900 mt-4 mb-2 first:mt-0 font-display" />,
                  h2: ({ node, ...props }) => <h2 {...props} className="text-lg font-bold text-blue-900 mt-4 mb-2 first:mt-0 font-display border-b pb-1 border-blue-100" />,
                  h3: ({ node, ...props }) => <h3 {...props} className="text-sm font-bold text-pink-600 mt-3.5 mb-1.5 first:mt-0 font-display" />,
                  h4: ({ node, ...props }) => <h4 {...props} className="text-sm font-bold text-slate-800 mt-2.5 mb-1 first:mt-0" />
                }}
              >
                {part}
              </ReactMarkdown>
            );
          }
        })}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto h-auto min-h-[500px]">
      
      {/* LEFT COLUMN: GUIDELINES & SELECTION SHORTCUTS - Hidden on Mobile, Premium Sidebar on Desktop */}
      <div className={`${isSidebarCollapsed ? 'lg:hidden' : 'hidden lg:flex lg:col-span-1'} flex-col space-y-4 lg:sticky lg:top-6 lg:self-start`}>
        
        {/* Category selector */}
        <div className="bg-white border border-blue-100 p-4 rounded-2xl shadow-[0_4px_20px_rgba(37,99,235,0.03)]">
          <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2.5 flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <BookOpen className="h-3.5 w-3.5 text-blue-600" />
              <span>Phân Hệ Tư Vấn</span>
            </div>
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              className="text-slate-400 hover:text-blue-600 hover:bg-slate-100 p-1 rounded-lg transition-all cursor-pointer hidden lg:block border-none bg-transparent"
              title="Thu gọn menu"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </h2>
          <div className="flex flex-col space-y-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                activeCategory === 'all' 
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-900 text-white font-bold shadow-md shadow-blue-500/10' 
                  : 'bg-slate-50 text-slate-650 hover:bg-slate-100 hover:text-blue-700 border border-slate-100'
              } flex items-center justify-between cursor-pointer`}
            >
              <span>🌐 Hệ thống Chung</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>ALL</span>
            </button>

            {categories.length > 0 ? (
              categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                const iconAndLabel = cat.id === 'ug' 
                  ? { emoji: '🎓', label: 'CỬ NHÂN' } 
                  : cat.id === 'pg' 
                  ? { emoji: '📚', label: 'THẠC SĨ' } 
                  : { emoji: '📝', label: cat.id.toUpperCase() };

                const activeBg = cat.id === 'ug'
                  ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-pink-500 text-white font-bold shadow-[0_4px_12px_rgba(236,72,153,0.2)]'
                  : cat.id === 'pg'
                  ? 'bg-gradient-to-r from-blue-800 to-indigo-900 text-white font-bold shadow-sm shadow-blue-800/10'
                  : 'bg-gradient-to-r from-slate-700 to-slate-900 text-white font-bold shadow-sm shadow-slate-700/10';

                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                      isActive 
                        ? activeBg 
                        : 'bg-slate-50 text-slate-650 hover:bg-slate-100 hover:text-blue-700 border border-slate-100'
                    } flex items-center justify-between cursor-pointer`}
                  >
                    <span>{iconAndLabel.emoji} {cat.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {iconAndLabel.label}
                    </span>
                  </button>
                );
              })
            ) : (
              <>
                <button
                  onClick={() => setActiveCategory('ug')}
                  className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                    activeCategory === 'ug' 
                      ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-pink-500 text-white font-bold shadow-[0_4px_12px_rgba(236,72,153,0.2)]' 
                      : 'bg-slate-50 text-slate-650 hover:bg-slate-100 hover:text-blue-700 border border-slate-100'
                  } flex items-center justify-between cursor-pointer`}
                >
                  <span>🎓 Tuyển sinh Đại Học</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'ug' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>CỬ NHÂN</span>
                </button>
                <button
                  onClick={() => setActiveCategory('pg')}
                  className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                    activeCategory === 'pg' 
                      ? 'bg-gradient-to-r from-blue-800 to-indigo-900 text-white font-bold shadow-sm shadow-blue-800/10' 
                      : 'bg-slate-50 text-slate-650 hover:bg-slate-100 hover:text-blue-700 border border-slate-100'
                  } flex items-center justify-between cursor-pointer`}
                >
                  <span>📚 Tuyển sinh Sau Đại Học</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'pg' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>THẠC SĨ</span>
                </button>
              </>
            )}
          </div>
        </div>



        {/* AI Config Options */}
        <div className="bg-white border border-blue-100 p-4 rounded-2xl shadow-[0_4px_20px_rgba(37,99,235,0.03)]">
          <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center space-x-1.5">
            <FileText className="h-3.5 w-3.5 text-blue-600" />
            <span>Tùy Chỉnh Câu Trả Lời</span>
          </h2>
          <div className="flex bg-slate-100 border border-slate-250 p-1 rounded-xl">
            <button
              onClick={() => setResponseLength('short')}
              className={`flex-1 py-1.5 text-xs text-center font-bold cursor-pointer transition-all rounded-lg ${
                responseLength === 'short' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'text-slate-500 hover:text-blue-700'
              }`}
            >
              Ngắn gọn
            </button>
            <button
              onClick={() => setResponseLength('detailed')}
              className={`flex-1 py-1.5 text-xs text-center font-bold cursor-pointer transition-all rounded-lg ${
                responseLength === 'detailed' 
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm' 
                  : 'text-slate-500 hover:text-blue-700'
              }`}
            >
              Chi tiết
            </button>
          </div>
        </div>

        {/* Escalation Button to actual counselor */}
        <button
          onClick={() => setShowCounselorForm(true)}
          className="w-full bg-gradient-to-r from-pink-500 via-rose-550 to-pink-600 hover:from-pink-650 hover:to-rose-650 text-white py-3.5 px-4 rounded-2xl text-xs font-bold shadow-[0_4px_15px_rgba(244,63,94,0.18)] transition-all flex items-center justify-center space-x-2 border-none cursor-pointer hover:scale-102 transform duration-150"
        >
          <UserPlus className="h-4 w-4" />
          <span>Gặp Cán Bộ Hỗ Trợ Trực Tiếp</span>
        </button>

      </div>

      {/* CENTER & RIGHT COLUMN (CONJOINED): ACTIVE CHAT CONSOLE */}
      <div className={`${isSidebarCollapsed ? 'lg:col-span-4' : 'lg:col-span-3'} flex flex-col bg-white rounded-3xl shadow-[0_8px_30px_rgba(37,99,235,0.03)] border border-blue-105 overflow-hidden h-auto`}>
        
        {/* Chat Console Header */}
        <div className="bg-gradient-to-r from-[#003366] via-blue-800 to-purple-900 p-3 sm:p-4 text-white flex items-center justify-between border-b border-blue-200 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            {/* Desktop Collapse/Expand Trigger inside Chat Header */}
            <button
              onClick={() => setIsSidebarCollapsed(prev => !prev)}
              className="hidden lg:flex items-center space-x-1 bg-white/10 hover:bg-white/20 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer text-white shrink-0 border-none"
              title={isSidebarCollapsed ? "Mở rộng bảng phân hệ tư vấn" : "Thu gọn bảng phân hệ tư vấn"}
            >
              {isSidebarCollapsed ? (
                <>
                  <ChevronRight className="h-4 w-4 text-pink-300 animate-pulse" />
                  <span>Mở Menu</span>
                </>
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 text-slate-300" />
                  <span>Thu gọn</span>
                </>
              )}
            </button>

            <div className="relative shrink-0">
              <div className="bg-white/10 p-2 rounded-xl flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-pink-300 animate-pulse" />
              </div>
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 border border-slate-950"></span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h3 className="font-display font-bold text-xs sm:text-sm tracking-wide truncate">VWA Assistant</h3>
              </div>
              <p className="text-[10px] sm:text-[11px] text-blue-101 truncate opacity-90">
                {activeCategory === 'ug' ? 'Đang lọc dữ liệu xét tuyển Đại học' : activeCategory === 'pg' ? 'Đang lọc tuyển sinh Cao học' : 'Hệ thống hỗ trợ thí sinh trực tuyến 24/7'}
              </p>
            </div>
          </div>

          {/* Quick Actions for Mobile/Tablet in Header */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setResponseLength(prev => prev === 'short' ? 'detailed' : 'short')}
              className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer flex items-center space-x-1 ${
                responseLength === 'detailed'
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white border-pink-500 shadow-sm'
                  : 'bg-white/10 text-blue-100 border-white/20'
              }`}
              title={responseLength === 'detailed' ? 'Chọn trả lời ngắn gọn' : 'Chọn trả lời chi tiết'}
            >
              <span>{responseLength === 'detailed' ? '✨ Chi tiết' : '⚡ Ngắn'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCounselorForm(true)}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg flex items-center space-x-1 border-none cursor-pointer transition-all active:scale-95 shadow-sm"
              title="Đăng ký hỗ trợ 1-1 từ cán bộ"
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden xs:inline">Hỗ trợ 1-1</span>
            </button>
          </div>
        </div>

        {/* Mobile Filter Category Tabs */}
        <div className="flex lg:hidden items-center justify-start py-2 px-3 bg-slate-50 border-b border-blue-100 overflow-x-auto scrollbar-none gap-2 shrink-0">
          <span className="text-[10px] uppercase font-bold text-slate-400 pl-1 shrink-0">Phân hệ:</span>
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'all'
                ? 'bg-[#003366] text-white'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            🌐 Chung
          </button>
          
          {categories.length > 0 ? (
            categories.map((cat) => {
              const isActive = activeCategory === cat.id;
              const emoji = cat.id === 'ug' ? '🎓' : cat.id === 'pg' ? '📚' : '📝';
              const activeBg = cat.id === 'ug'
                ? 'bg-gradient-to-r from-blue-600 to-pink-500 text-white shadow-xs'
                : cat.id === 'pg'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-600 text-white';
              
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? activeBg
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {emoji} {cat.name.split(' ')[0] || cat.name}
                </button>
              );
            })
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveCategory('ug')}
                className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
                  activeCategory === 'ug'
                    ? 'bg-gradient-to-r from-blue-600 to-pink-500 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                🎓 Đại học
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('pg')}
                className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer whitespace-nowrap ${
                  activeCategory === 'pg'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                📚 Cao học
              </button>
            </>
          )}
        </div>

        {/* Chat Display Pane */}
        <div className="p-4 sm:p-6 space-y-6 bg-[#fbfdfa]/30 overflow-visible h-auto">
          {messages.map((msg) => (
            <div
              key={msg.id}
              id={`chat-msg-${msg.id}`}
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} items-start space-x-2 sm:space-x-3`}
            >
              {/* Bot Avatar */}
              {msg.sender === 'bot' && (
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-600 to-pink-500 text-white flex items-center justify-center shrink-0 border border-white mt-1 shadow-sm">
                  <GraduationCap className="h-4 w-4 text-white" />
                </div>
              )}

              {/* Message bubble card */}
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 shadow-sm relative ${
                msg.sender === 'user'
                  ? 'bg-gradient-to-r from-pink-50 to-pink-100/50 border border-pink-200/50 text-slate-800 rounded-tr-none shadow-[0_4px_12px_rgba(219,39,119,0.03)]'
                  : 'bg-[#f4f8fc] border border-blue-50 text-slate-800 rounded-tl-none'
              }`}>
                {/* Meta details */}
                <div className="flex items-center justify-between space-x-4 mb-2 text-[10px] opacity-75">
                  <span className={`font-bold uppercase tracking-wide ${msg.sender === 'user' ? 'text-pink-600' : 'text-blue-700'}`}>
                    {msg.sender === 'user' ? 'Thí sinh / Phụ huynh' : 'Trợ lý Tuyển sinh AI'}
                  </span>
                  <span className="text-slate-400 font-medium">{msg.timestamp}</span>
                </div>

                {/* Content rendering */}
                <div className={msg.sender === 'user' ? 'text-sm text-slate-700 font-medium' : 'prose text-slate-800'}>
                  {msg.sender === 'user' ? msg.text : renderMessageContent(msg.text)}
                </div>

                {/* Source attribution references */}
                {msg.sender === 'bot' && msg.sourceDocs && msg.sourceDocs.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-200/50 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-pink-600 font-bold uppercase flex items-center space-x-1">
                      <FileText className="h-3 w-3 text-pink-500" />
                      <span>Cơ sở văn bản gốc:</span>
                    </span>
                    {msg.sourceDocs.map((doc, idx) => (
                      <span key={idx} className="text-[10px] bg-blue-50 text-blue-800 font-semibold py-1 px-2 rounded-lg border border-blue-100 max-w-[200px] truncate hover:bg-pink-50 hover:text-pink-700 transition-all cursor-default" title={doc}>
                        {doc.replace('.docx', '').replace('.pdf', '')}
                      </span>
                    ))}
                  </div>
                )}

                {/* Bottom tools (like feedback) */}
                {msg.sender === 'bot' && msg.id !== 'welcome' && (
                  <div className="mt-3 pt-2 border-t border-slate-200/50 flex items-center justify-between text-xs text-slate-400">
                    <span className="text-[10px] text-slate-400 italic">
                      Thông tin này hữu ích với em?
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleFeedback(msg.id, 'up')}
                        className={`p-1 rounded hover:bg-slate-100 transition-all cursor-pointer ${
                          feedbackIssued[msg.id] === 'up' ? 'text-green-600 bg-green-50 scale-110' : 'hover:text-slate-700 text-slate-400'
                        }`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleFeedback(msg.id, 'down')}
                        className={`p-1 rounded hover:bg-slate-100 transition-all cursor-pointer ${
                          feedbackIssued[msg.id] === 'down' ? 'text-red-500 bg-rose-50 scale-110' : 'hover:text-slate-700 text-slate-400'
                        }`}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* User Avatar */}
              {msg.sender === 'user' && (
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-pink-500 to-rose-450 text-white flex items-center justify-center shrink-0 mt-1 font-bold text-xs uppercase border border-white shadow-sm">
                  TS
                </div>
              )}
            </div>
          ))}

          {/* Loading Indicator for ongoing AI responses */}
          {isLoading && (
            <div className="flex justify-start items-start space-x-2 sm:space-x-3">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-600 to-pink-500 text-white flex items-center justify-center shrink-0 border border-white mt-1 shadow-sm">
                <GraduationCap className="h-4 w-4 text-white animate-pulse" />
              </div>
              <div className="max-w-[75%] rounded-2xl p-4 bg-[#f0f4f8] border border-blue-50 text-slate-700 rounded-tl-none shadow-sm space-y-2">
                <div className="flex space-x-1 items-center py-2">
                  <div className="h-2.5 w-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2.5 w-2.5 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2.5 w-2.5 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <p className="text-[11px] text-slate-400 italic">
                  Trợ lý tuyển sinh đang tìm kiếm thông tin, xin vui lòng chờ trong giây lát...
                </p>
              </div>
            </div>
          )}

          {/* Collapsible suggested subsequent questions list */}
          {!isLoading && messages.length > 0 && messages[messages.length - 1].suggestedQuestions && (
            <div className="ml-10 space-y-2 max-w-[85%] mt-2 bg-gradient-to-br from-blue-50/40 to-pink-50/30 p-4 rounded-2xl border border-blue-100/60 shadow-sm animate-fade-in">
              <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700 flex items-center space-x-1.5 mb-2">
                <FileQuestion className="h-3.5 w-3.5 text-pink-500" />
                <span>Gợi ý câu hỏi tuyển sinh liên quan:</span>
              </div>
              <div className="flex flex-col space-y-1.5">
                {messages[messages.length - 1].suggestedQuestions?.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendMessageToBot(q.replace(/^[🏫🎓📚•\d\.\s\-]+/, ''))} // Clean icons and prefixes
                    className="text-left py-2 px-3 bg-white hover:bg-pink-50/50 border border-blue-100/80 hover:border-pink-300 text-slate-750 hover:text-pink-600 font-semibold transition-all shadow-sm rounded-xl py-2 px-3 text-xs cursor-pointer flex items-center justify-between"
                  >
                    <span>{q}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 ml-2 text-pink-500" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Form to ask questions */}
        <div className="p-3 sm:p-4 border-t border-blue-100 bg-white shadow-[0_-4px_25px_rgba(0,0,0,0.02)] shrink-0">
          
          {/* Quick topic slider (Essential shortcut on Mobile, awesome on Desktop) */}
          <div className="flex items-center space-x-2 pb-2 overflow-x-auto scrollbar-none">
            <Sparkles className="h-3.5 w-3.5 text-pink-500 shrink-0 animate-pulse" />
            <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">Hỏi nhanh:</span>
            <div className="flex space-x-1.5 overflow-x-auto scrollbar-none py-0.5">
              {[
                { label: '🏫 Ngành đào tạo', id: 'ngành' },
                { label: '💰 Học phí năm nay', id: 'học phí' },
                { label: '📑 Hồ sơ xét tuyển', id: 'hồ sơ' },
                { label: '✍️ Xét tuyển học bạ', id: 'phương thức' },
                { label: '📞 Liên hệ hotline', id: 'liên hệ' }
              ].map((btn, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleQuickSearch(btn.id)}
                  className="whitespace-nowrap px-3 py-1 bg-blue-50/50 hover:bg-pink-50 border border-blue-100/60 hover:border-pink-200 text-[11px] text-blue-700 hover:text-pink-600 rounded-full transition-all font-semibold shadow-2xs cursor-pointer inline-flex items-center"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="flex space-x-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={isLoading}
              placeholder={
                activeCategory === 'ug'
                  ? 'Hỏi chatbot tuyển sinh Đại học (ví dụ: học phí, tổ hợp, ngành học...)...'
                  : activeCategory === 'pg'
                  ? 'Hỏi chatbot tuyển sinh Thạc sĩ / Tiến sĩ (ví dụ: văn bằng, chứng chỉ B1, học phí...)...'
                  : 'Bạn cần tư vấn nội dung gì, hãy gõ nội dung câu hỏi vào đây...'
              }
              className="flex-1 text-sm bg-slate-50 hover:bg-white border border-blue-150 rounded-2xl px-4 py-3.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-300/50 focus:border-pink-500 text-slate-800 placeholder:text-slate-400 font-medium transition-all shadow-inner"
            />
            <button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-pink-500 hover:to-rose-500 text-white rounded-2xl px-5 py-3.5 flex items-center space-x-1.5 transition-all duration-300 text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-[0_4px_15px_rgba(236,72,153,0.3)] h-[48px]"
            >
              <span>Gửi</span>
              <Send className="h-4 w-4" />
            </button>
          </form>
          
          {/* Quick instructions indicator */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
            <div className="font-medium text-slate-400">
              💡Hệ thống Trợ lý AI VWA. Chúc các em nỗ lực đạt ước mơ của mình!
            </div>
            <div className="flex items-center space-x-1">
              <Globe className="h-3 w-3 text-blue-500" />
              <a href={schoolConfig?.website || "https://hvpnvn.edu.vn"} target="_blank" rel="noreferrer" className="hover:underline hover:text-pink-600 font-bold text-blue-600 transition-colors">
                Trang tuyển sinh {schoolConfig?.name || "Học viện Phụ nữ Việt Nam"}
              </a>
            </div>
          </div>
        </div>

      </div>

      {/* MODAL / OVERLAY: ESCALATION CONTACT FORM FOR COUNSELOR */}
      {showCounselorForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-blue-100 w-full max-w-lg overflow-hidden animate-scale-up">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-pink-500 text-white p-5 flex items-center justify-between border-b border-blue-100 shadow-sm">
              <div className="flex items-center space-x-2">
                <Phone className="h-5 w-5 text-white animate-bounce" />
                <h3 className="font-display font-bold text-base">Đăng ký Kết nối Tư vấn 1-1</h3>
              </div>
              <button
                onClick={() => setShowCounselorForm(false)}
                className="text-white hover:text-slate-100 p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <XButton />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleCounselorFormSubmit} className="p-6 space-y-4 text-left">
              <div className="bg-blue-55/40 text-blue-800 text-xs rounded-xl border border-blue-100 p-4 leading-relaxed flex items-start space-x-2.5">
                <InfoIcon />
                <span>
                  Nếu lời giải đáp tự động chưa giải quyết đủ yêu cầu của em, hãy điền mẫu sau. Thầy cô phòng tư vấn hoặc chủ nhiệm bộ môn Học viện sẽ liên hệ hỗ trợ trực tiếp.
                </span>
              </div>
              
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Họ và tên thí sinh / học viên *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ví dụ: Nguyễn Thị Mai"
                  className="w-full bg-slate-50 hover:bg-white text-slate-800 text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 font-medium transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Số điện thoại / Zalo *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Ví dụ: 0912345678"
                    className="w-full bg-slate-50 hover:bg-white text-slate-800 text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 font-medium transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Hộp thư Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="mail@vi-du.com"
                    className="w-full bg-slate-50 hover:bg-white text-slate-800 text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 font-medium transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Chương trình quan tâm *
                </label>
                <div className="flex space-x-3">
                  <label className={`flex-1 flex items-center justify-center p-3 border rounded-xl cursor-pointer text-xs font-semibold select-none transition-all ${
                    formData.level === 'ug' ? 'border-pink-500 bg-pink-50/50 text-pink-600 shadow-sm' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="form-level"
                      value="ug"
                      checked={formData.level === 'ug'}
                      onChange={() => setFormData({ ...formData, level: 'ug' })}
                      className="mr-2 accent-pink-500"
                    />
                    Đại học Chính quy
                  </label>
                  <label className={`flex-1 flex items-center justify-center p-3 border rounded-xl cursor-pointer text-xs font-semibold select-none transition-all ${
                    formData.level === 'pg' ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="form-level"
                      value="pg"
                      checked={formData.level === 'pg'}
                      onChange={() => setFormData({ ...formData, level: 'pg' })}
                      className="mr-2 accent-blue-600"
                    />
                    Sau Đại học / Thạc sĩ
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Câu hỏi cụ thể hoặc lời nhắn gửi tuyển sinh
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Em muốn hỏi thêm về chỉ tiêu ngành Công nghệ thông tin..."
                  rows={3}
                  className="w-full bg-slate-50 hover:bg-white text-slate-800 text-sm border border-slate-200 rounded-xl px-3.5 py-2 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400 transition-all"
                ></textarea>
              </div>

              {/* Submit button */}
              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCounselorForm(false)}
                  className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer text-slate-500 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={formSubmitted}
                  className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-[0_4px_12px_rgba(236,72,153,0.25)] transition-all cursor-pointer flex items-center space-x-2"
                >
                  {formSubmitted ? (
                    <span>Đang nộp...</span>
                  ) : (
                    <>
                      <span>Đăng ký ngay</span>
                      <CheckCircle className="h-4 w-4 text-white" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// Inline SVGs/micro components to keep it modular and robust
function XButton() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-4 h-4 text-brand-blue-light shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
  );
}
