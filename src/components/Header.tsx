/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraduationCap, Settings, Phone, MessageSquare, LogOut, School, BookOpen, Award } from 'lucide-react';
import { SchoolConfig } from '../types.ts';

interface HeaderProps {
  isAdminMode: boolean;
  setIsAdminMode: (isAdmin: boolean) => void;
  onlineStatus: 'online' | 'offline';
  currentUser: { email: string; role: string; name: string } | null;
  onLogout: () => void;
  schoolConfig: SchoolConfig | null;
}

export default function Header({ 
  isAdminMode, 
  setIsAdminMode, 
  onlineStatus,
  currentUser,
  onLogout,
  schoolConfig
}: HeaderProps) {
  const renderLogoIcon = (iconName?: string) => {
    switch (iconName) {
      case 'School': return <School className="h-6 w-6 text-white" />;
      case 'BookOpen': return <BookOpen className="h-6 w-6 text-white" />;
      case 'Award': return <Award className="h-6 w-6 text-white" />;
      default: return <GraduationCap className="h-6 w-6 text-white" />;
    }
  };

  return (
    <header className="bg-white/95 backdrop-blur-xl text-slate-800 border-b border-blue-100 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo & Academy Brand */}
          <div className="flex items-center space-x-3">
            {schoolConfig?.logoUrl ? (
              <img 
                src={schoolConfig.logoUrl} 
                alt={schoolConfig.name} 
                className="w-10 h-10 object-contain rounded-lg shadow-sm shrink-0" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_2px_12px_rgba(37,99,235,0.4)] text-white shrink-0">
                {renderLogoIcon(schoolConfig?.logoIcon)}
              </div>
            )}
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-display font-bold text-sm sm:text-base leading-tight uppercase tracking-tight text-blue-900">
                  {schoolConfig?.name || "Học viện Phụ nữ Việt Nam"}
                </span>
                <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border border-blue-200">
                  {schoolConfig?.shortName || "VWA"}
                </span>
              </div>
              <p className="text-[10px] text-blue-600 uppercase tracking-widest font-sans hidden sm:block font-semibold">
                {schoolConfig?.name || "Vietnam Women's Academy"} • Admissions AI Panel
              </p>
            </div>
          </div>

          {/* Quick contact and navigation */}
          <div className="flex items-center space-x-4">
            {/* Hotline banner */}
            <div className="hidden md:flex items-center space-x-2 bg-blue-50/75 py-1.5 px-3 rounded-xl border border-blue-100 text-xs">
              <Phone className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
              <div className="text-left font-sans">
                <span className="text-slate-500 block text-[9px] uppercase font-bold tracking-wide">Hotline Tư vấn</span>
                <span className="font-bold text-blue-700">{schoolConfig?.hotline || "024.3775.1750"}</span>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-slate-100 border border-slate-205 p-1 rounded-xl">
              <button
                id="btn-user-mode"
                onClick={() => setIsAdminMode(false)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200 ${
                  !isAdminMode
                    ? 'bg-blue-600 text-white font-bold shadow-[0_2px_10px_rgba(37,99,235,0.3)]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Thí sinh</span>
              </button>
              <button
                id="btn-admin-mode"
                onClick={() => setIsAdminMode(true)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200 ${
                  isAdminMode
                    ? 'bg-blue-600 text-white font-bold shadow-[0_2px_10px_rgba(37,99,235,0.3)]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Cán bộ</span>
              </button>
            </div>
            
            {/* Logged in User Profile Info & Sign Out */}
            {isAdminMode && currentUser && (
              <div className="flex items-center space-x-2 bg-blue-50 py-1 px-2.5 rounded-xl border border-blue-100 text-xs max-w-[200px] sm:max-w-none">
                <div className="h-6 w-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center border border-white uppercase select-none shrink-0">
                  {currentUser.name.substring(0, 2)}
                </div>
                <div className="hidden lg:block text-left text-[11px] leading-tight select-none">
                  <div className="font-bold text-slate-800 line-clamp-1">{currentUser.name}</div>
                  <div className="text-[9px] text-blue-600 font-semibold">{currentUser.role === 'superadmin' ? 'Quản trị Tối cao' : 'Cán bộ'}</div>
                </div>
                <button 
                  onClick={onLogout}
                  title="Đăng xuất khỏi tài khoản"
                  className="p-1 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors ml-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Online indicator */}
            <div className="flex items-center space-x-1.5 bg-slate-50 py-1.5 px-2.5 rounded-xl border border-slate-200 text-[11px] font-mono">
              <span className={`h-2 w-2 rounded-full ${onlineStatus === 'online' ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`}></span>
              <span className="text-slate-600 hidden sm:inline capitalize font-medium">{onlineStatus}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
