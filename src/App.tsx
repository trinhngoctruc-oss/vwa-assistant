/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Header from './components/Header.tsx';
import UserChatSection from './components/UserChatSection.tsx';
import AdminPanelSection from './components/AdminPanelSection.tsx';
import { RecruitmentDocument, FAQ, HistoryItem, RecruitmentStats, SchoolConfig } from './types.ts';
import { Shield, Sparkles, BookOpen, UserCheck, Check } from 'lucide-react';

export default function App() {
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; role: string; name: string } | null>(() => {
    try {
      const stored = localStorage.getItem('vwa_admin_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  
  const [authError, setAuthError] = useState<string>('');
  const [documents, setDocuments] = useState<RecruitmentDocument[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState<RecruitmentStats | null>(null);
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<'online' | 'offline'>('online');
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Sync data from Express API
  const fetchAllData = async () => {
    try {
      const [docsRes, faqsRes, historyRes, statsRes, configRes] = await Promise.all([
        fetch('/api/documents'),
        fetch('/api/faqs'),
        fetch('/api/history'),
        fetch('/api/stats'),
        fetch('/api/school-config')
      ]);

      const isJsonRes = (res: Response) => {
        const contentType = res.headers.get('content-type');
        return contentType && contentType.includes('application/json');
      };

      if (docsRes.ok && faqsRes.ok && historyRes.ok && statsRes.ok && configRes.ok) {
        if (
          !isJsonRes(docsRes) || 
          !isJsonRes(faqsRes) || 
          !isJsonRes(historyRes) || 
          !isJsonRes(statsRes) || 
          !isJsonRes(configRes)
        ) {
          throw new Error('Một hoặc nhiều phản hồi API từ máy chủ không thuộc định dạng JSON. Có thể máy chủ đang cài đặt khởi động.');
        }

        const [docsData, faqsData, historyData, statsData, configData] = await Promise.all([
          docsRes.json(),
          faqsRes.json(),
          historyRes.json(),
          statsRes.json(),
          configRes.json()
        ]);

        setDocuments(docsData);
        setFaqs(faqsData);
        setHistory(historyData);
        setStats(statsData);
        setSchoolConfig(configData);
        setOnlineStatus('online');
      } else {
        setOnlineStatus('offline');
      }
    } catch (err) {
      console.error('Error syncing admissions data:', err);
      setOnlineStatus('offline');
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    
    // Periodically poll server health status
    const interval = setInterval(() => {
      fetch('/api/health')
        .then(res => {
          if (res.ok) setOnlineStatus('online');
          else setOnlineStatus('offline');
        })
        .catch(() => setOnlineStatus('offline'));
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // Listen to Google Login Popup custom postMessage communication
  useEffect(() => {
    const handleLoginMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'OAUTH_AUTH_SUCCESS' && event.data.user) {
        const { email } = event.data.user;
        setAuthError('');
        
        try {
          // Verify with server backend permissions list
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await res.json();
          
          if (res.ok && data.success && data.user) {
            setCurrentUser(data.user);
            localStorage.setItem('vwa_admin_user', JSON.stringify(data.user));
          } else {
            // Show exact backend error message returned
            setAuthError(data.message || 'Tài khoản không được phê duyệt tư cách cán bộ.');
          }
        } catch (err: any) {
          setAuthError('Lỗi kết nối xác thực: ' + err.message);
        }
      }
    };

    window.addEventListener('message', handleLoginMessage);
    return () => window.removeEventListener('message', handleLoginMessage);
  }, []);

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('vwa_admin_user');
    setIsAdminMode(false);
    setAuthError('');
  };

  const handleOpenGoogleLogin = () => {
    setAuthError('');
    const width = 500;
    const height = 620;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    window.open(
      '/google-sign-in.html',
      'google_login_popup',
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
    );
  };

  return (
    <div className="min-h-screen bg-[#f3f7fa] text-slate-800 font-sans flex flex-col selection:bg-blue-200 selection:text-blue-900 antialiased relative overflow-x-hidden">
      {/* Abstract blue background glow */}
      <div className="absolute top-[-5%] right-[-5%] w-[600px] h-[600px] bg-blue-100 rounded-full blur-[140px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[10%] left-[5%] w-[500px] h-[500px] bg-sky-100/50 rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* Navbar Brand */}
      <Header 
        isAdminMode={isAdminMode} 
        setIsAdminMode={(mode) => {
          setIsAdminMode(mode);
          setAuthError('');
        }} 
        onlineStatus={onlineStatus} 
        currentUser={currentUser}
        onLogout={handleLogout}
        schoolConfig={schoolConfig}
      />

      {/* Main interactive page content */}
      <main className="flex-1 relative z-10">
        {isInitializing ? (
          <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-2xl bg-white border border-blue-200 text-blue-600 flex items-center justify-center shadow-[0_4px_15px_rgba(37,99,235,0.15)] animate-pulse">
                <Sparkles className="h-7 w-7 text-blue-600" />
              </div>
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-blue-500 border-2 border-[#f3f7fa] animate-ping"></span>
            </div>
            <div className="text-center px-4">
              <h4 className="font-display font-bold text-sm text-blue-700 uppercase tracking-widest">Đang khởi tạo Hệ thống Tuyển sinh AI...</h4>
              <p className="text-xs text-slate-400 mt-1.5 font-medium">Bản quyền thuộc về {schoolConfig?.name || "Học viện Phụ nữ Việt Nam"} © 2026</p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {!isAdminMode ? (
              <motion.div
                key="user-portal"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {/* User Portal */}
                <UserChatSection faqs={faqs} onRefreshStats={fetchAllData} schoolConfig={schoolConfig} />
              </motion.div>
            ) : (
              <motion.div
                key="admin-console"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {currentUser ? (
                  /* Authorised Admin Mode Screen */
                  <AdminPanelSection 
                    documents={documents} 
                    faqs={faqs} 
                    history={history} 
                    stats={stats} 
                    onRefreshAll={fetchAllData} 
                    currentUser={currentUser}
                    schoolConfig={schoolConfig}
                  />
                ) : (
                  /* Google OAuth Authenticator Request Screen */
                  <div className="max-w-md mx-auto my-16 px-4">
                    <div className="bg-white shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-blue-100/80 rounded-3xl p-8 text-center">
                      <div className="h-14 w-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mx-auto mb-5 border border-blue-100/50">
                        <UserCheck className="h-6 w-6 text-blue-600" />
                      </div>
                      
                      <h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight mb-2">Cổng Xác thực Cán bộ</h2>
                      <p className="text-xs text-slate-500 leading-relaxed max-w-[320px] mx-auto mb-6">
                        Yêu cầu xác nhận nhận diện cá nhân của hệ thống {schoolConfig?.name || "Học viện Phụ nữ Việt Nam"} để quản trị tri thức.
                      </p>

                      {/* Display domain authentication error banners */}
                      {authError && (
                        <div className="p-3.5 bg-rose-50 text-rose-700 border border-rose-100 rounded-2xl text-[11px] font-bold leading-normal mb-6 text-left">
                          ⚠️ {authError}
                        </div>
                      )}

                      <div className="space-y-3.5 mb-8 text-left bg-slate-50 p-4 rounded-2xl border border-slate-150 text-[11.5px] leading-relaxed text-slate-600">
                        <div className="flex items-start space-x-2">
                          <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span>Học liệu, quyết định tuyển sinh & nghị định của cơ sở đào tạo</span>
                        </div>
                        <div className="flex items-start space-x-2">
                          <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span>Quản trị hệ thống FAQ hồi trực tiếp</span>
                        </div>
                        <div className="flex items-start space-x-2">
                          <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span>Cho phép Quản trị tối cao (tructn) điều độ thêm bớt cán bộ</span>
                        </div>
                      </div>

                      <button
                        onClick={handleOpenGoogleLogin}
                        className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold py-3.5 px-4 rounded-2xl text-xs border border-slate-200 shadow-sm transition-colors cursor-pointer flex items-center justify-center space-x-2.5 active:scale-98 transform duration-100 animate-bounce"
                      >
                        <svg className="h-4.5 w-4.5 shrink-0" viewBox="0 0 24 24" fill="none">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                        </svg>
                        <span>Đăng nhập bằng tài khoản Google</span>
                      </button>

                      <p className="text-[10px] text-slate-400 mt-5 font-semibold leading-relaxed">
                        Chỉ các tài khoản được ủy quyền mới được quyền tiếp cận cơ sở dữ liệu.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Aesthetic Footer */}
      <footer className="bg-white text-slate-500 py-6 border-t border-blue-100 text-xs shadow-inner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-bold text-slate-800 uppercase">{schoolConfig?.name || "HỌC VIỆN PHỤ NỮ VIỆT NAM (VIETNAM WOMEN'S ACADEMY)"}</p>
            <p className="text-slate-400 mt-0.5 font-medium font-sans">{schoolConfig?.address ? `Địa chỉ: ${schoolConfig.address}` : "Trụ sở chính: Số 68 Nguyễn Chí Thanh, Phường Láng, Hà Nội"}</p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            AI-Engine powered by Gemini • © 2026 Bản quyền thuộc về {schoolConfig?.name || "Học viện Phụ nữ Việt Nam"}.
          </p>
        </div>
      </footer>
    </div>
  );
}
