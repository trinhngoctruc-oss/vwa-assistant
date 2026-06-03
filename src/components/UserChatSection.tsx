/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Sparkles, AlertCircle, HelpCircle, Phone, Globe, BookOpen, 
  MapPin, ShieldAlert, ChevronRight, ThumbsUp, ThumbsDown, MessageSquare, 
  CheckCircle, FileText, ArrowRight, UserPlus, FileQuestion, GraduationCap
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, FAQ } from '../types.ts';

interface UserChatSectionProps {
  faqs: FAQ[];
  onRefreshStats: () => void;
}

export default function UserChatSection({ faqs, onRefreshStats }: UserChatSectionProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: `### Chào mừng quý phụ huynh, thí sinh và học viên! 👋 \n\nTôi là **VWA-Admissions-AI** - Trợ lý Tuyển sinh Thông minh của **Học viện Phụ nữ Việt Nam**.\n\nHôm nay, bạn quan tâm đến hệ đào tạo nào? Hãy chọn hệ để tôi chuẩn hóa dữ liệu tư vấn tốt nhất cho bạn nhé!`,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      category: 'general',
      suggestedQuestions: [
        '🏫 Giới thiệu tổng quan về Học viện Phụ nữ Việt Nam?',
        '🎓 Các ngành tuyển sinh Đại học chính quy năm nay?',
        '📚 Điều kiện và hồ sơ tuyển sinh Thạc sĩ?'
      ]
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<'ug' | 'pg' | 'general' | 'all'>('all');
  const [responseLength, setResponseLength] = useState<'short' | 'detailed'>('detailed');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackIssued, setFeedbackIssued] = useState<{ [msgId: string]: 'up' | 'down' | null }>({});
  
  // Counselor Form State
  const [showCounselorForm, setShowCounselorForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', level: 'ug', notes: '' });
  const [formSubmitted, setFormSubmitted] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      switch (topic) {
        case 'ngành': query = 'Tổng hợp các ngành đào tạo Đại học và Thạc sĩ tại Học viện Phụ nữ Việt Nam?'; break;
        case 'học phí': query = 'Bảng học phí đại học và thạc sĩ tại trường như thế nào?'; break;
        case 'phương thức': query = 'Các phương thức xét tuyển mới nhất của Học viện Phụ nữ Việt Nam?'; break;
        case 'hồ sơ': query = 'Hồ sơ nộp xét tuyển của trường gồm những gì?'; break;
        case 'liên hệ': query = 'Địa chỉ Học viện Phụ nữ Việt Nam và hotline liên hệ tuyển sinh?'; break;
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
  const handleCounselorFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) return;
    setFormSubmitted(true);
    setTimeout(() => {
      // Add a virtual messages showing confirmation
      const confirmationMsg: Message = {
        id: 'contact-confirm-' + Date.now(),
        sender: 'bot',
        text: `### 🎉 Đã chuyển tiếp thành công tới Cán bộ tuyển sinh!\n\nThông tin của em đã được gửi trực tiếp đến Ban tuyển sinh **Học viện Phụ nữ Việt Nam**.\n\n- **Học viên/Thí sinh:** ${formData.name}\n- **Số điện thoại:** ${formData.phone}\n- **Nguyện vọng tìm hiểu:** Hỗ trợ tư vấn ${formData.level === 'ug' ? 'Đại học Chính quy' : 'Thạc sĩ - Sau đại học'}\n\nCán bộ phòng đào tạo và giảng viên chuyên môn sẽ gọi điện kết nối hỗ trợ trực tiếp trực tuyến qua Zalo hoặc điện thoại cho em hoặc phụ huynh trong vòng tối đa **4 giờ làm việc** sắp tới. Chúc em vững tin và đạt kết quả cao!`,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, confirmationMsg]);
      setShowCounselorForm(false);
      setFormData({ name: '', phone: '', email: '', level: 'ug', notes: '' });
      setFormSubmitted(false);
    }, 1200);
  };

  // Help parsing custom simple markdown in message text using ReactMarkdown and remarkGfm
  const renderMessageContent = (text: string) => {
    return (
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ node, ...props }) => (
              <div className="overflow-x-auto my-3 border border-white/10 rounded-xl bg-slate-950/40">
                <table {...props} className="min-w-full border-collapse divide-y divide-white/10 text-left" />
              </div>
            ),
            thead: ({ node, ...props }) => <thead {...props} className="bg-slate-900/85" />,
            tbody: ({ node, ...props }) => <tbody {...props} className="divide-y divide-white/5" />,
            tr: ({ node, ...props }) => <tr {...props} className="hover:bg-white/5 transition-colors" />,
            th: ({ node, ...props }) => <th {...props} className="px-4 py-2.5 text-xs font-semibold text-teal-450 uppercase tracking-wider border-r border-white/10 last:border-r-0 whitespace-nowrap" />,
            td: ({ node, ...props }) => <td {...props} className="px-4 py-2.5 text-xs text-slate-300 border-r border-white/5 last:border-r-0 align-middle leading-relaxed" />,
            p: ({ node, ...props }) => <p {...props} className="text-sm text-slate-300 leading-relaxed mb-3 last:mb-0" />,
            ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-5 my-2.5 space-y-1 text-slate-300" />,
            ol: ({ node, ...props }) => <ol {...props} className="list-decimal pl-5 my-2.5 space-y-1 text-slate-300" />,
            li: ({ node, ...props }) => <li {...props} className="text-sm leading-relaxed" />,
            strong: ({ node, ...props }) => <strong {...props} className="font-bold text-teal-400" />,
            a: ({ node, ...props }) => <a {...props} className="text-teal-400 hover:underline hover:text-teal-300 font-semibold" target="_blank" rel="noreferrer" />,
            h1: ({ node, ...props }) => <h1 {...props} className="text-xl font-bold text-teal-300 mt-4 mb-2 first:mt-0 font-display" />,
            h2: ({ node, ...props }) => <h2 {...props} className="text-lg font-bold text-white mt-4 mb-2 first:mt-0 font-display border-b pb-1 border-white/10" />,
            h3: ({ node, ...props }) => <h3 {...props} className="text-sm font-bold text-teal-400 mt-3.5 mb-1.5 first:mt-0 font-display" />,
            h4: ({ node, ...props }) => <h4 {...props} className="text-sm font-bold text-slate-200 mt-2.5 mb-1 first:mt-0" />
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto h-[calc(100vh-80px)]">
      
      {/* LEFT COLUMN: GUIDELINES & SELECTION SHORTCUTS */}
      <div className="lg:col-span-1 flex flex-col space-y-4">
        
        {/* Category selector */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 p-4 rounded-2xl shadow-sm">
          <h2 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2.5 flex items-center space-x-1.5">
            <BookOpen className="h-3.5 w-3.5 text-teal-400" />
            <span>Phân Hệ Tư Vấn</span>
          </h2>
          <div className="flex flex-col space-y-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                activeCategory === 'all' 
                  ? 'bg-teal-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(20,184,166,0.3)]' 
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/5'
              } flex items-center justify-between cursor-pointer`}
            >
              <span>🌐 Hệ thống Chung</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'all' ? 'bg-slate-950 text-teal-400' : 'bg-white/10 text-slate-300'}`}>ALL</span>
            </button>
            <button
              onClick={() => setActiveCategory('ug')}
              className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                activeCategory === 'ug' 
                  ? 'bg-teal-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(20,184,166,0.3)]' 
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/5'
              } flex items-center justify-between cursor-pointer`}
            >
              <span>🎓 Tuyển sinh Đại Học</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'ug' ? 'bg-slate-950 text-teal-400' : 'bg-white/10 text-slate-300'}`}>CỬ NHÂN</span>
            </button>
            <button
              onClick={() => setActiveCategory('pg')}
              className={`w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-left transition-all ${
                activeCategory === 'pg' 
                  ? 'bg-teal-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(20,184,166,0.3)]' 
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/5'
              } flex items-center justify-between cursor-pointer`}
            >
              <span>📚 Tuyển sinh Sau Đại Học</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${activeCategory === 'pg' ? 'bg-slate-950 text-teal-400' : 'bg-white/10 text-slate-300'}`}>THẠC SĨ</span>
            </button>
          </div>
        </div>

        {/* Quick topic buttons dashboard */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 p-4 rounded-2xl shadow-sm">
          <h2 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2.5 flex items-center space-x-1.5">
            <Sparkles className="h-3.5 w-3.5 text-teal-400" />
            <span>Nút Hỏi Nhanh</span>
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Ngành đào tạo', id: 'ngành' },
              { label: 'Học phí', id: 'học phí' },
              { label: 'Hồ sơ tuyển', id: 'hồ sơ' },
              { label: 'Xét tuyển học bạ', id: 'phương thức' },
              { label: 'Liên hệ / Hotline', id: 'liên hệ' }
            ].map((btn, index) => (
              <button
                key={index}
                onClick={() => handleQuickSearch(btn.id)}
                className="py-2 px-2.5 bg-slate-950/40 hover:bg-teal-500/10 border border-white/10 text-slate-300 hover:text-white hover:border-teal-500/30 rounded-xl text-xs font-medium text-center transition-all hover:scale-103 cursor-pointer p-2 h-16 flex items-center justify-center content-center leading-tight shadow-sm"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* AI Config Options */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 p-4 rounded-2xl shadow-sm">
          <h2 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2 flex items-center space-x-1.5">
            <FileText className="h-3.5 w-3.5 text-teal-400" />
            <span>Tùy Chỉnh Câu Trả Lời</span>
          </h2>
          <div className="flex bg-slate-950 border border-white/10 p-1 rounded-xl">
            <button
              onClick={() => setResponseLength('short')}
              className={`flex-1 py-1.5 text-xs text-center font-bold cursor-pointer transition-all rounded-lg ${
                responseLength === 'short' 
                  ? 'bg-teal-500 text-slate-950 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ngắn gọn
            </button>
            <button
              onClick={() => setResponseLength('detailed')}
              className={`flex-1 py-1.5 text-xs text-center font-bold cursor-pointer transition-all rounded-lg ${
                responseLength === 'detailed' 
                  ? 'bg-teal-500 text-slate-950 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chi tiết
            </button>
          </div>
        </div>

        {/* Escalation Button to actual counselor */}
        <button
          onClick={() => setShowCounselorForm(true)}
          className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 py-3.5 px-4 rounded-2xl text-xs font-bold shadow-lg transition-all flex items-center justify-center space-x-2 border border-teal-500/30 cursor-pointer hover:shadow-xl hover:scale-102 transform duration-150"
        >
          <UserPlus className="h-4 w-4" />
          <span>Gặp Cán Bộ Hỗ Trợ Trực Tiếp</span>
        </button>

        {/* Official Warnings footer widget */}
        <div className="bg-teal-950/20 p-3.5 rounded-xl border border-teal-500/20 text-[11px] text-teal-300 leading-relaxed flex items-start space-x-2">
          <ShieldAlert className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
          <div>
            <strong>Lưu ý thí sinh:</strong> Thông tin tư vấn được AI trích xuất khách quan từ Đề án tuyển sinh đã công bố của Học viện. Điểm chuẩn, chỉ tiêu chính thức sẽ căn cứ vào văn bản ký duyệt của Hội đồng Tuyển sinh.
          </div>
        </div>

      </div>

      {/* CENTER & RIGHT COLUMN (CONJOINED): ACTIVE CHAT CONSOLE */}
      <div className="lg:col-span-3 flex flex-col bg-slate-900/60 backdrop-blur-2xl rounded-3xl shadow-xl border border-white/10 overflow-hidden h-full">
        
        {/* Chat Console Header */}
        <div className="bg-slate-950/80 p-4 text-white flex items-center justify-between border-b border-white/10">
          <div className="flex items-center space-x-2">
            <div className="relative">
              <div className="bg-white/5 p-2 rounded-xl flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-teal-400 animate-spin-slow" />
              </div>
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-400 border border-slate-950"></span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-display font-semibold text-sm">Học viện Phụ nữ Việt Nam Admissions AI</h3>
                <span className="text-[9px] bg-teal-500/10 text-teal-400 font-semibold px-1.5 rounded uppercase border border-teal-500/20">Gemini 3.5</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {activeCategory === 'ug' ? 'Đang lọc dữ liệu Đại học' : activeCategory === 'pg' ? 'Đang lọc dữ liệu Sau Đại Học' : 'Tư vấn thông suốt Toàn hệ thống'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-300">
            <span className="hidden sm:inline bg-white/5 py-1 px-2.5 rounded-xl border border-white/5 text-[10px] text-slate-400">
              Tệp tri thức: Học bạ, Đề án 2025, Thạc sĩ đợt 1
            </span>
          </div>
        </div>

        {/* Chat Display Pane */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar bg-slate-950/20">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} items-start space-x-2 sm:space-x-3`}
            >
              {/* Bot Avatar */}
              {msg.sender === 'bot' && (
                <div className="h-8 w-8 rounded-xl bg-slate-950 text-white flex items-center justify-center shadow-sm shrink-0 border border-white/10 mt-1">
                  <GraduationCap className="h-4 w-4 text-teal-400" />
                </div>
              )}

              {/* Message bubble card */}
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 shadow-sm relative ${
                msg.sender === 'user'
                  ? 'bg-teal-500/10 border border-teal-500/25 text-slate-100 rounded-tr-none shadow-[0_0_15px_rgba(20,184,166,0.05)]'
                  : 'bg-slate-900 border border-white/10 text-slate-200 rounded-tl-none'
              }`}>
                {/* Meta details */}
                <div className="flex items-center justify-between space-x-4 mb-2 text-[10px] opacity-75">
                  <span className={`font-semibold uppercase tracking-wide ${msg.sender === 'user' ? 'text-teal-400' : 'text-slate-400'}`}>
                    {msg.sender === 'user' ? 'Thí sinh / Phụ huynh' : 'Ban tuyển sinh AI'}
                  </span>
                  <span className="text-slate-400">{msg.timestamp}</span>
                </div>

                {/* Content rendering */}
                <div className={msg.sender === 'user' ? 'text-sm text-slate-100 font-medium' : 'prose text-slate-200'}>
                  {msg.sender === 'user' ? msg.text : renderMessageContent(msg.text)}
                </div>

                {/* Source attribution references */}
                {msg.sender === 'bot' && msg.sourceDocs && msg.sourceDocs.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-white/5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase flex items-center space-x-1">
                      <FileText className="h-3 w-3 text-teal-400" />
                      <span>Nguồn trích dẫn:</span>
                    </span>
                    {msg.sourceDocs.map((doc, idx) => (
                      <span key={idx} className="text-[10px] bg-white/5 text-teal-300 py-1 px-2 rounded-lg border border-white/5 max-w-[200px] truncate hover:bg-white/10" title={doc}>
                        {doc.replace('.docx', '').replace('.pdf', '')}
                      </span>
                    ))}
                  </div>
                )}

                {/* Bottom tools (like feedback) */}
                {msg.sender === 'bot' && msg.id !== 'welcome' && (
                  <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-xs text-slate-400">
                    <span className="text-[10px] text-slate-500 italic">
                      Thông tin hữu ích đối với bạn?
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleFeedback(msg.id, 'up')}
                        className={`p-1 rounded hover:bg-white/5 transition-all cursor-pointer ${
                          feedbackIssued[msg.id] === 'up' ? 'text-green-500 bg-green-500/10 scale-110' : 'hover:text-slate-200 text-slate-500'
                        }`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleFeedback(msg.id, 'down')}
                        className={`p-1 rounded hover:bg-white/5 transition-all cursor-pointer ${
                          feedbackIssued[msg.id] === 'down' ? 'text-red-500 bg-red-500/10 scale-110' : 'hover:text-slate-200 text-slate-500'
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
                <div className="h-8 w-8 rounded-xl bg-teal-500 text-slate-950 flex items-center justify-center shadow-[0_0_10px_rgba(20,184,166,0.3)] shrink-0 mt-1 font-bold text-xs uppercase">
                  TS
                </div>
              )}
            </div>
          ))}

          {/* Loading Indicator for ongoing AI responses */}
          {isLoading && (
            <div className="flex justify-start items-start space-x-2 sm:space-x-3">
              <div className="h-8 w-8 rounded-xl bg-slate-950 text-white flex items-center justify-center shadow-sm shrink-0 border border-white/10 mt-1">
                <GraduationCap className="h-4 w-4 text-teal-400 animate-pulse" />
              </div>
              <div className="max-w-[75%] rounded-2xl p-4 bg-slate-900 border border-white/10 text-slate-200 rounded-tl-none shadow-sm space-y-2">
                <div className="flex space-x-1 items-center py-2">
                  <div className="h-2 w-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2 w-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2 w-2 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <p className="text-[11px] text-slate-500 italic">
                  Chuyên gia AI đang phân tích dữ liệu tuyển sinh Học viện Phụ nữ Việt Nam...
                </p>
              </div>
            </div>
          )}

          {/* Collapsible suggested subsequent questions list */}
          {!isLoading && messages.length > 0 && messages[messages.length - 1].suggestedQuestions && (
            <div className="ml-10 space-y-2 max-w-[85%] mt-2 bg-slate-950/40 p-4 rounded-2xl border border-white/5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-teal-400 flex items-center space-x-1.5 mb-2">
                <FileQuestion className="h-3.5 w-3.5 text-teal-400" />
                <span>Gợi ý câu hỏi tuyển sinh liên quan:</span>
              </div>
              <div className="flex flex-col space-y-1.5">
                {messages[messages.length - 1].suggestedQuestions?.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendMessageToBot(q.replace(/^[🏫🎓📚•\d\.\s\-]+/, ''))} // Clean icons and prefixes
                    className="text-left py-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-slate-300 font-semibold transition-colors cursor-pointer hover:border-teal-500/30 flex items-center justify-between"
                  >
                    <span>{q}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 ml-2 text-teal-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Form to ask questions */}
        <div className="p-4 border-t border-white/10 bg-slate-950/80 shadow-inner">
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
                  : 'Nhập câu hỏi tuyển sinh của bạn tại đây...'
              }
              className="flex-1 text-sm bg-slate-900 border border-white/10 rounded-2xl px-4 py-3.5 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-2xl px-5 py-3.5 flex items-center space-x-1.5 transition-all text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_0_15px_rgba(20,184,166,0.3)] h-[48px]"
            >
              <span>Gửi</span>
              <Send className="h-4 w-4" />
            </button>
          </form>
          
          {/* Quick instructions indicator */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between text-[11px] text-slate-450 gap-2">
            <div>
              💡 Ghi chú: Thí sinh nộp học bạ đợt 1 từ ngày 15/04/2025.
            </div>
            <div className="flex items-center space-x-1">
              <Globe className="h-3 w-3 text-teal-400" />
              <a href="https://hvpnvn.edu.vn" target="_blank" rel="noreferrer" className="hover:underline hover:text-teal-400 text-teal-500 font-semibold">
                Website Học viện Phụ nữ Việt Nam
              </a>
            </div>
          </div>
        </div>

      </div>

      {/* MODAL / OVERLAY: ESCALATION CONTACT FORM FOR COUNSELOR */}
      {showCounselorForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 rounded-3xl shadow-2xl border border-white/10 w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="bg-slate-950 text-white p-5 flex items-center justify-between border-b border-white/10">
              <div className="flex items-center space-x-2">
                <Phone className="h-5 w-5 text-teal-400 animate-bounce" />
                <h3 className="font-display font-bold text-base">Đăng ký Tư vấn Trực tiếp 1-1</h3>
              </div>
              <button
                onClick={() => setShowCounselorForm(false)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <XButton />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleCounselorFormSubmit} className="p-6 space-y-4">
              <div className="text-xs text-slate-450 leading-relaxed bg-white/5 p-3.5 rounded-xl border border-white/5 flex items-start space-x-2.5">
                <InfoIcon />
                <span>
                  Nếu hệ thống AI chưa thể trả lời thỏa đáng, xin vui lòng để lại thông tin liên hệ. Thầy cô phòng đào tạo hoặc các khoa thuộc Học viện Phụ nữ Việt Nam sẽ gọi điện hỗ trợ trực tiếp.
                </span>
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                  Họ và tên thí sinh / học viên *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ví dụ: Nguyễn Thị Mai"
                  className="w-full bg-slate-950 text-slate-100 text-sm border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder:text-slate-650"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                    Số điện thoại / Zalo *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Ví dụ: 0912345678"
                    className="w-full bg-slate-950 text-slate-100 text-sm border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder:text-slate-650"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                    Hộp thư Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="mail@vi-du.com"
                    className="w-full bg-slate-950 text-slate-100 text-sm border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder:text-slate-650"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                  Chương trình quan tâm *
                </label>
                <div className="flex space-x-3">
                  <label className={`flex-1 flex items-center justify-center p-3 border rounded-xl cursor-pointer text-xs font-semibold select-none transition-all ${
                    formData.level === 'ug' ? 'border-teal-550 bg-teal-500/10 text-teal-400' : 'border-white/10 text-slate-400 hover:bg-white/5'
                  }`}>
                    <input
                      type="radio"
                      name="form-level"
                      value="ug"
                      checked={formData.level === 'ug'}
                      onChange={() => setFormData({ ...formData, level: 'ug' })}
                      className="mr-2 accent-teal-500"
                    />
                    Đại học Chính quy
                  </label>
                  <label className={`flex-1 flex items-center justify-center p-3 border rounded-xl cursor-pointer text-xs font-semibold select-none transition-all ${
                    formData.level === 'pg' ? 'border-teal-550 bg-teal-500/10 text-teal-400' : 'border-white/10 text-slate-400 hover:bg-white/5'
                  }`}>
                    <input
                      type="radio"
                      name="form-level"
                      value="pg"
                      checked={formData.level === 'pg'}
                      onChange={() => setFormData({ ...formData, level: 'pg' })}
                      className="mr-2 accent-teal-500"
                    />
                    Sau Đại học / Thạc sĩ
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                  Câu hỏi cụ thể hoặc lời nhắn gửi tuyển sinh
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Em muốn hỏi thêm về chỉ tiêu ngành Công nghệ thông tin..."
                  rows={3}
                  className="w-full bg-slate-950 text-slate-100 text-sm border border-white/10 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder:text-slate-650"
                ></textarea>
              </div>

              {/* Submit button */}
              <div className="pt-3 border-t border-white/5 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCounselorForm(false)}
                  className="px-5 py-2.5 border border-white/10 rounded-xl text-xs font-semibold hover:bg-white/5 cursor-pointer text-slate-400 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={formSubmitted}
                  className="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-xl text-xs font-bold shadow-lg transition-all cursor-pointer flex items-center space-x-2"
                >
                  {formSubmitted ? (
                    <span>Đang nộp...</span>
                  ) : (
                    <>
                      <span>Đăng ký ngay</span>
                      <CheckCircle className="h-4 w-4 text-slate-950" />
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
