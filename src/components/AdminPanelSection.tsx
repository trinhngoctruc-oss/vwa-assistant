/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  FileText, Upload, Plus, Trash2, ToggleLeft, ToggleRight, CheckCircle2, 
  HelpCircle, Eye, Edit, BarChart3, Clock, AlertTriangle, RefreshCw, 
  Tag, Download, FileSpreadsheet, Check, X, BookmarkCheck, ThumbsUp, ThumbsDown,
  Users, UserPlus, ShieldAlert, KeyRound, School, Award, BookOpen, GraduationCap, Settings,
  Phone, Mail, User
} from 'lucide-react';
import { RecruitmentDocument, FAQ, HistoryItem, RecruitmentStats, SchoolConfig, ConsultationItem } from '../types.ts';

interface AdminPanelSectionProps {
  documents: RecruitmentDocument[];
  faqs: FAQ[];
  history: HistoryItem[];
  stats: RecruitmentStats | null;
  onRefreshAll: () => void;
  currentUser: { email: string; role: string; name: string; categories?: string[] } | null;
  schoolConfig: SchoolConfig | null;
}

export default function AdminPanelSection({ 
  documents, 
  faqs, 
  history, 
  stats, 
  onRefreshAll,
  currentUser,
  schoolConfig
}: AdminPanelSectionProps) {
  // Filter systems based on user permissions
  const allowedCategories = currentUser?.role === 'superadmin' 
    ? ['ug', 'pg', 'general']
    : (currentUser?.categories || ['ug', 'pg', 'general']);

  const filteredDocuments = documents.filter(doc => allowedCategories.includes(doc.category));
  const filteredFaqs = faqs.filter(faq => allowedCategories.includes(faq.category));

  // Tabs: 'docs' | 'faqs' | 'history' | 'stats' | 'admins' | 'settings' | 'systems' | 'consultations'
  const [activeTab, setActiveTab] = useState<'docs' | 'faqs' | 'history' | 'stats' | 'admins' | 'settings' | 'systems' | 'consultations'>('docs');
  
  // Consultation 1-1 list management state
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [consultationsLoading, setConsultationsLoading] = useState(false);
  const [consultationsError, setConsultationsError] = useState('');

  const fetchConsultations = async () => {
    setConsultationsLoading(true);
    setConsultationsError('');
    try {
      const res = await fetch('/api/consultations');
      const data = await res.json();
      if (res.ok) {
        setConsultations(data);
      } else {
        setConsultationsError(data.message || 'Lỗi tải danh sách đăng ký tư vấn.');
      }
    } catch (err: any) {
      setConsultationsError('Lỗi kết nối: ' + err.message);
    } finally {
      setConsultationsLoading(false);
    }
  };

  const handleUpdateConsultationStatus = async (id: string, newStatus: 'pending' | 'contacted' | 'cancelled') => {
    try {
      const res = await fetch(`/api/consultations/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setConsultations(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
      } else {
        alert('Lỗi cập nhật trạng thái');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConsultation = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa lượt đăng ký tư vấn này?')) return;
    try {
      const res = await fetch(`/api/consultations/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setConsultations(prev => prev.filter(c => c.id !== id));
      } else {
        alert('Lỗi xóa yêu cầu tư vấn');
      }
    } catch (err) {
      console.error(err);
    }
  };
  
  // Dynamic training systems management state
  const [categories, setCategories] = useState<{ id: string; name: string; description?: string; isActive: boolean }[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState('');
  const [categoriesSuccess, setCategoriesSuccess] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);

  // New Category form state
  const [newCatId, setNewCatId] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatDescription, setNewCatDescription] = useState('');
  const [newCatIsActive, setNewCatIsActive] = useState(true);

  // Edit Category form state
  const [editCatName, setEditCatName] = useState('');
  const [editCatDescription, setEditCatDescription] = useState('');
  const [editCatIsActive, setEditCatIsActive] = useState(true);

  const fetchCategories = async () => {
    setCategoriesLoading(true);
    setCategoriesError('');
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      if (res.ok && data.success) {
        setCategories(data.categories);
      } else {
        setCategoriesError(data.message || 'Lỗi tải danh sách hệ đào tạo.');
      }
    } catch (err: any) {
      setCategoriesError('Lỗi tải hệ đào tạo: ' + err.message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const getCategoryName = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    return cat ? cat.name : (catId === 'ug' ? 'Đại học Chính quy' : catId === 'pg' ? 'Thạc sĩ - Sau đại học' : 'Chung');
  };
  
  // School Profile config editor states
  const [cfgName, setCfgName] = useState('');
  const [cfgShortName, setCfgShortName] = useState('');
  const [cfgLogoUrl, setCfgLogoUrl] = useState('');
  const [cfgLogoIcon, setCfgLogoIcon] = useState('GraduationCap');
  const [cfgAddress, setCfgAddress] = useState('');
  const [cfgHotline, setCfgHotline] = useState('');
  const [cfgEmail, setCfgEmail] = useState('');
  const [cfgWebsite, setCfgWebsite] = useState('');

  // Phân hệ Cấu hình tối ưu chi phí & Định tuyến thông minh
  const [cfgAiRoutingMode, setCfgAiRoutingMode] = useState<'hybrid' | 'ai_only' | 'faq_only'>('hybrid');
  const [cfgFaqConfidenceThreshold, setCfgFaqConfidenceThreshold] = useState<number>(40);
  const [cfgDefaultModel, setCfgDefaultModel] = useState<string>('gemini-3.5-flash');
  const [cfgAiMaxTokens, setCfgAiMaxTokens] = useState<number>(4000);
  const [cfgEnableCache, setCfgEnableCache] = useState<boolean>(true);
  
  const [cfgSaveLoading, setCfgSaveLoading] = useState(false);
  const [cfgLogoUploading, setCfgLogoUploading] = useState(false);
  const [cfgError, setCfgError] = useState('');
  const [cfgSuccess, setCfgSuccess] = useState('');

  useEffect(() => {
    if (schoolConfig) {
      setCfgName(schoolConfig.name || '');
      setCfgShortName(schoolConfig.shortName || '');
      setCfgLogoUrl(schoolConfig.logoUrl || '');
      setCfgLogoIcon(schoolConfig.logoIcon || 'GraduationCap');
      setCfgAddress(schoolConfig.address || '');
      setCfgHotline(schoolConfig.hotline || '');
      setCfgEmail(schoolConfig.email || '');
      setCfgWebsite(schoolConfig.website || '');

      setCfgAiRoutingMode(schoolConfig.aiRoutingMode || 'hybrid');
      setCfgFaqConfidenceThreshold(schoolConfig.faqConfidenceThreshold !== undefined ? schoolConfig.faqConfidenceThreshold : 40);
      setCfgDefaultModel(schoolConfig.defaultModel || 'gemini-3.5-flash');
      setCfgAiMaxTokens(schoolConfig.aiMaxTokens !== undefined ? schoolConfig.aiMaxTokens : 4000);
      setCfgEnableCache(schoolConfig.enableCache !== undefined ? schoolConfig.enableCache : true);
    }
  }, [schoolConfig]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfgName.trim() || !cfgShortName.trim() || !cfgAddress.trim()) {
      setCfgError('Cán bộ vui lòng nhập đầy đủ các trường bắt buộc (Tên trường, Tên viết tắt, Địa chỉ)');
      return;
    }
    setCfgSaveLoading(true);
    setCfgError('');
    setCfgSuccess('');
    try {
      const res = await fetch('/api/school-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cfgName.trim(),
          shortName: cfgShortName.trim(),
          logoUrl: cfgLogoUrl.trim(),
          logoIcon: cfgLogoIcon,
          address: cfgAddress.trim(),
          hotline: cfgHotline.trim(),
          email: cfgEmail.trim(),
          website: cfgWebsite.trim(),
          // Gửi Cost control settings
          aiRoutingMode: cfgAiRoutingMode,
          faqConfidenceThreshold: Number(cfgFaqConfidenceThreshold),
          defaultModel: cfgDefaultModel,
          aiMaxTokens: Number(cfgAiMaxTokens),
          enableCache: cfgEnableCache
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCfgSuccess('Cấu hình và lưu thông tin thương hiệu đơn vị đào tạo thành công!');
        onRefreshAll();
      } else {
        setCfgError(data.message || 'Lỗi khi lưu cấu hình.');
      }
    } catch (err: any) {
      setCfgError('Lỗi kết nối: ' + err.message);
    } finally {
      setCfgSaveLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCfgLogoUploading(true);
    setCfgError('');
    setCfgSuccess('');

    const formData = new FormData();
    formData.append('logo', file);

    try {
      const res = await fetch('/api/school-config/logo', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCfgLogoUrl(data.logoUrl);
        setCfgSuccess('Tải logo custom biểu trưng thành công!');
        onRefreshAll();
      } else {
        setCfgError(data.message || 'Lỗi tải ảnh logo lên server.');
      }
    } catch (err: any) {
      setCfgError('Lỗi kết nối khi tải ảnh: ' + err.message);
    } finally {
      setCfgLogoUploading(false);
    }
  };
  
  // Document interaction states
  const [selectedDoc, setSelectedDoc] = useState<RecruitmentDocument | null>(null);
  const [editDocText, setEditDocText] = useState('');
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Form states for adding FAQ
  const [newFaqQuestion, setNewFaqQuestion] = useState('');
  const [newFaqAnswer, setNewFaqAnswer] = useState('');
  const [newFaqCategory, setNewFaqCategory] = useState<string>('ug');
  const [newFaqTags, setNewFaqTags] = useState('');

  // Admins management state
  const [adminsList, setAdminsList] = useState<{ email: string; categories: string[] }[]>([]);
  const [newAdminEmailInput, setNewAdminEmailInput] = useState('');
  const [newAdminCategories, setNewAdminCategories] = useState<string[]>(['ug', 'pg', 'general']);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminsError, setAdminsError] = useState('');
  const [adminsSuccess, setAdminsSuccess] = useState('');

  // Fetch approved admin accounts
  const fetchAdmins = async () => {
    if (!currentUser) return;
    setAdminsLoading(true);
    setAdminsError('');
    try {
      const res = await fetch('/api/admins', {
        headers: { 'x-user-email': currentUser.email }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdminsList(data.admins);
      } else {
        setAdminsError(data.message || 'Lỗi khi lấy danh sách cán bộ.');
      }
    } catch (err: any) {
      setAdminsError('Lỗi kết nối: ' + err.message);
    } finally {
      setAdminsLoading(false);
    }
  };

  // Add a new approved admin
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !newAdminEmailInput.trim()) return;

    if (newAdminCategories.length === 0) {
      setAdminsError('Vui lòng phân quyền quản lý tối thiểu 1 hệ đào tạo khi thêm cán bộ mới.');
      return;
    }

    setAdminsLoading(true);
    setAdminsError('');
    setAdminsSuccess('');

    try {
      const res = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorEmail: currentUser.email,
          newAdminEmail: newAdminEmailInput.trim(),
          categories: newAdminCategories
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewAdminEmailInput('');
        setNewAdminCategories(['ug', 'pg', 'general']);
        setAdminsSuccess(data.message || 'Cấp quyền cán bộ thành công!');
        setAdminsList(data.admins);
      } else {
        setAdminsError(data.message || 'Không thể cấp quyền cán bộ.');
      }
    } catch (err: any) {
      setAdminsError('Lỗi kết nối: ' + err.message);
    } finally {
      setAdminsLoading(false);
    }
  };

  // Update an approved admin's training categories
  const handleToggleAdminPermission = async (adminEmail: string, category: string, currentCats: string[]) => {
    if (!currentUser) return;
    setAdminsLoading(true);
    setAdminsError('');
    setAdminsSuccess('');

    let updatedCats = [...currentCats];
    if (updatedCats.includes(category)) {
      if (updatedCats.length <= 1) {
        setAdminsError('Mỗi cán bộ phải được phân quyền quản lý tối thiểu 1 hệ đào tạo.');
        setAdminsLoading(false);
        return;
      }
      updatedCats = updatedCats.filter(c => c !== category);
    } else {
      updatedCats.push(category);
    }

    try {
      const res = await fetch(`/api/admins/${encodeURIComponent(adminEmail)}/permissions`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': currentUser.email
        },
        body: JSON.stringify({ categories: updatedCats })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdminsSuccess(data.message || 'Cập nhật phân quyền thành công!');
        setAdminsList(data.admins);
      } else {
        setAdminsError(data.message || 'Lỗi cập nhật phân quyền.');
      }
    } catch (err: any) {
      setAdminsError('Lỗi kết nối: ' + err.message);
    } finally {
      setAdminsLoading(false);
    }
  };

  // Remove an approved admin
  const handleRemoveAdmin = async (emailToRemove: string) => {
    if (!currentUser) return;
    if (!window.confirm(`Bạn có chắc chắn muốn thu hồi quyền cán bộ quản trị của ${emailToRemove}?`)) return;

    setAdminsLoading(true);
    setAdminsError('');
    setAdminsSuccess('');

    try {
      const res = await fetch(`/api/admins/${encodeURIComponent(emailToRemove)}`, {
        method: 'DELETE',
        headers: { 'x-user-email': currentUser.email }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdminsSuccess(data.message || 'Đã thu hồi quyền cán bộ.');
        setAdminsList(data.admins);
      } else {
        setAdminsError(data.message || 'Không thể thu hồi quyền.');
      }
    } catch (err: any) {
      setAdminsError('Lỗi kết nối: ' + err.message);
    } finally {
      setAdminsLoading(false);
    }
  };

  // Fetch admins list when tab is activated
  useEffect(() => {
    if (activeTab === 'admins') {
      fetchAdmins();
    }
    if (activeTab === 'systems') {
      fetchCategories();
    }
    if (activeTab === 'consultations') {
      fetchConsultations();
    }
  }, [activeTab, currentUser]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!newCatId.trim() || !newCatName.trim()) {
      setCategoriesError('Vui lòng nhập đầy đủ Mã hệ đào tạo (ID) và Tên hệ đào tạo.');
      return;
    }

    setCategoriesLoading(true);
    setCategoriesError('');
    setCategoriesSuccess('');

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': currentUser.email
        },
        body: JSON.stringify({
          id: newCatId.trim(),
          name: newCatName.trim(),
          description: newCatDescription.trim(),
          isActive: newCatIsActive
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCategoriesSuccess(data.message || 'Thêm hệ đào tạo mới thành công!');
        setCategories(data.categories);
        setNewCatId('');
        setNewCatName('');
        setNewCatDescription('');
        setNewCatIsActive(true);
      } else {
        setCategoriesError(data.message || 'Lỗi thêm hệ đào tạo.');
      }
    } catch (err: any) {
      setCategoriesError('Lỗi kết nối: ' + err.message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!currentUser) return;
    if (!editCatName.trim()) {
      setCategoriesError('Tên hệ đào tạo không được để trống.');
      return;
    }

    setCategoriesLoading(true);
    setCategoriesError('');
    setCategoriesSuccess('');

    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': currentUser.email
        },
        body: JSON.stringify({
          name: editCatName.trim(),
          description: editCatDescription.trim(),
          isActive: editCatIsActive
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCategoriesSuccess(data.message || 'Cập nhật hệ đào tạo thành công!');
        setCategories(data.categories);
        setEditingCategory(null);
      } else {
        setCategoriesError(data.message || 'Lỗi cập nhật hệ đào tạo.');
      }
    } catch (err: any) {
      setCategoriesError('Lỗi kết nối: ' + err.message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleToggleCategoryActive = async (id: string, currentActive: boolean) => {
    if (!currentUser) return;
    setCategoriesLoading(true);
    setCategoriesError('');
    setCategoriesSuccess('');

    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': currentUser.email
        },
        body: JSON.stringify({
          isActive: !currentActive
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCategoriesSuccess(data.message || 'Cập nhật trạng thái hệ đào tạo thành công!');
        setCategories(data.categories);
      } else {
        setCategoriesError(data.message || 'Lỗi cập nhật trạng thái.');
      }
    } catch (err: any) {
      setCategoriesError('Lỗi kết nối: ' + err.message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!currentUser) return;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa hoàn toàn hệ đào tạo "${id}"? Thao tác này không thể hoàn tác!`)) {
      return;
    }

    setCategoriesLoading(true);
    setCategoriesError('');
    setCategoriesSuccess('');

    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 
          'x-user-email': currentUser.email
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCategoriesSuccess(data.message || 'Xóa hệ đào tạo thành công!');
        setCategories(data.categories);
      } else {
        setCategoriesError(data.message || 'Lỗi xóa hệ đào tạo.');
      }
    } catch (err: any) {
      setCategoriesError('Lỗi kết nối: ' + err.message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  // Form upload fields
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<string>('ug');
  const [newDocVersion, setNewDocVersion] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Auto trigger stats fetch
  useEffect(() => {
    onRefreshAll();
  }, []);

  // Set selected document's text edit field
  useEffect(() => {
    if (selectedDoc) {
      setEditDocText(selectedDoc.content);
    }
  }, [selectedDoc]);

  // File selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      // Auto-populate file name into title if empty
      if (!newDocTitle) {
        setNewDocTitle(file.name.substring(0, file.name.lastIndexOf('.')) || file.name);
      }
    }
  };

  // Upload Document
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('Vui lòng chọn một tập tin .docx, .pdf, .txt hoặc .xlsx');
      return;
    }

    setUploadProgress(true);
    setUploadError('');
    setUploadSuccess(false);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('title', newDocTitle);
    formData.append('category', newDocCategory);
    formData.append('version', newDocVersion || '2025.1');

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadSuccess(true);
        setSelectedFile(null);
        setNewDocTitle('');
        setNewDocVersion('');
        onRefreshAll();
      } else {
        setUploadError(data.message || 'Lỗi xử lý file tải lên.');
      }
    } catch (err: any) {
      setUploadError('Lỗi kết nối khi nộp tài liệu: ' + err.message);
    } finally {
      setUploadProgress(false);
    }
  };

  // Delete document
  const handleDeleteDoc = async (id: string) => {
    if (!window.confirm('Cán bộ có chắc chắn muốn xóa tài liệu này khỏi Hệ thống hỏi đáp thông minh?')) return;
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedDoc?.id === id) setSelectedDoc(null);
        onRefreshAll();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle boolean properties
  const handleToggleProp = async (id: string, prop: 'isActive' | 'isLatest') => {
    try {
      const res = await fetch(`/api/documents/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prop })
      });
      if (res.ok) {
        onRefreshAll();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Update document parsed text content
  const handleSaveDocEdit = async () => {
    if (!selectedDoc) return;
    try {
      const res = await fetch(`/api/documents/${selectedDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedDoc.title,
          content: editDocText,
          version: selectedDoc.version,
          category: selectedDoc.category,
        })
      });
      if (res.ok) {
        setIsEditingDoc(false);
        const data = await res.json();
        setSelectedDoc(data.document);
        onRefreshAll();
        alert('Cập nhật tài liệu tuyển sinh thành công!');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit FAQ
  const handleFaqSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFaqQuestion.trim() || !newFaqAnswer.trim()) return;

    try {
      const tagsArray = newFaqTags.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch('/api/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: newFaqQuestion,
          answer: newFaqAnswer,
          category: newFaqCategory,
          tags: tagsArray,
        })
      });
      if (res.ok) {
        setNewFaqQuestion('');
        setNewFaqAnswer('');
        setNewFaqTags('');
        onRefreshAll();
        alert('Đã bổ sung câu hỏi thường gặp vào Tri thức!');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Prepopulate FAQ from User Query history item
  const handlePrepopulateFAQ = (historyItem: HistoryItem) => {
    setNewFaqQuestion(historyItem.question);
    setNewFaqAnswer(historyItem.answer);
    setNewFaqCategory(historyItem.categoryMatched === 'unknown' ? 'ug' : (historyItem.categoryMatched as any));
    setNewFaqTags(historyItem.tags.join(', '));
    setActiveTab('faqs');
    // Scroll FAQ form to view
    window.scrollTo({ top: 300, behavior: 'smooth' });
  };

  // Delete FAQ
  const handleDeleteFaq = async (id: string) => {
    if (!window.confirm('Cán bộ có muốn xóa câu hỏi FAQ này không?')) return;
    try {
      const res = await fetch(`/api/faqs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRefreshAll();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* Intro Admin Banner - White/Blue styled gradient */}
      <div className="bg-gradient-to-r from-[#003366] via-blue-800 to-indigo-950 text-white p-6 rounded-3xl border border-blue-900/50 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookmarkCheck className="h-5 w-5 text-sky-400" />
            <h1 className="font-display font-bold text-xl uppercase tracking-wide">Hệ thống Quản lý Dữ liệu Tuyển sinh Học viên</h1>
          </div>
          <p className="text-xs text-blue-200 mt-1 font-medium">
            Dành cho Cán bộ phòng tuyển sinh và phòng đào tạo Học viện Phụ nữ Việt Nam quản lý tài liệu, FAQ, lịch sử và RAG.
          </p>
        </div>
        <button 
          onClick={onRefreshAll}
          className="flex items-center space-x-1.5 border border-white/20 bg-white/10 py-2 px-3.5 rounded-xl text-xs hover:bg-white/20 font-semibold text-white transition-all cursor-pointer shadow-sm"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Đồng bộ Cơ sở dữ liệu</span>
        </button>
      </div>

      {/* Admin Tabs */}
      <div className="flex border-b border-blue-100 mb-6 font-sans overflow-x-auto whitespace-nowrap">
        {( () => {
          const tabItems = [
            { id: 'docs', label: 'Tài liệu & Đề án tuyển sinh', count: filteredDocuments.length },
            { id: 'faqs', label: 'Ngân hàng FAQ tuyển sinh', count: filteredFaqs.length },
            { id: 'consultations', label: 'Đăng ký Tư vấn 1-1', count: consultations.length },
            { id: 'history', label: 'Lịch sử hỏi đáp thí sinh', count: history.length },
            { id: 'stats', label: 'Phân tích & Thống kê hỏi nóng', count: null }
          ];
          if (currentUser) {
            tabItems.push({ id: 'admins', label: 'Cấp quyền & Quản lý Cán bộ', count: null });
            tabItems.push({ id: 'systems', label: 'Quản lý Hệ đào tạo', count: categories.length });
            tabItems.push({ id: 'settings', label: 'Cấu hình Đơn vị đào tạo', count: null });
          }
          return tabItems;
        })().map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-3.5 px-4 text-xs font-bold select-none flex items-center space-x-2 border-b-2 transition-all cursor-pointer ${
              activeTab === tab.id 
                ? 'border-blue-600 text-blue-700' 
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== null && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: DOCUMENTS MANAGEMENT & PARSING */}
      {activeTab === 'docs' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Docs list and management (Span 2) */}
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-sm font-bold text-brand-blue-dark uppercase tracking-wide mb-4 flex items-center space-x-2">
                <FileText className="h-4 w-4" />
                <span>Danh sách tài liệu tri thức đang khả dụng</span>
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                      <th className="p-3">Tên tài liệu văn bản / Đề án</th>
                      <th className="p-3">Hệ Đào Tạo</th>
                      <th className="p-3">Phiên bản</th>
                      <th className="p-3">Trạng thái</th>
                      <th className="p-3 text-right">Khác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDocuments.map((doc) => (
                      <tr 
                        key={doc.id}
                        className={`hover:bg-slate-50/70 transition-colors ${selectedDoc?.id === doc.id ? 'bg-blue-50/40 font-semibold' : ''}`}
                      >
                        <td className="p-3 max-w-[280px]">
                          <div className="font-bold text-slate-800 line-clamp-1">{doc.title}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center space-x-2">
                            <span className="font-semibold uppercase text-brand-blue-light">{doc.fileType}</span>
                            <span>•</span>
                            <span>Tông số đoạn: {doc.chunksCount}</span>
                            <span>•</span>
                            <span>Nộp: {doc.uploadDate}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            doc.category === 'ug' 
                              ? 'bg-amber-100 text-amber-800' 
                              : doc.category === 'pg' 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-indigo-55 text-indigo-800 border border-indigo-100'
                          }`}>
                            {getCategoryName(doc.category)}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600 font-mono">
                          v{doc.version}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col space-y-1.5">
                            <button
                              onClick={() => handleToggleProp(doc.id, 'isActive')}
                              className="flex items-center space-x-1 text-left cursor-pointer text-slate-600 hover:text-slate-950 font-medium"
                            >
                              {doc.isActive ? (
                                <span className="flex items-center space-x-1">
                                  <ToggleRight className="h-4.5 w-4.5 text-green-500" />
                                  <span className="text-[10px] text-green-700">Hoạt động</span>
                                </span>
                              ) : (
                                <span className="flex items-center space-x-1">
                                  <ToggleLeft className="h-4.5 w-4.5 text-slate-350" />
                                  <span className="text-[10px] text-slate-400">Tạm tắt</span>
                                </span>
                              )}
                            </button>
                            
                            <button
                              onClick={() => handleToggleProp(doc.id, 'isLatest')}
                              className="text-left font-semibold text-[10px] cursor-pointer"
                            >
                              {doc.isLatest ? (
                                <span className="text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">Mới Nhất</span>
                              ) : (
                                <span className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 px-1.5 py-0.5 rounded">Bản cũ</span>
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => setSelectedDoc(doc)}
                              className="p-1 text-sky-600 hover:text-sky-900 hover:bg-sky-50 rounded cursor-pointer"
                              title="Xem chi tiết và chỉnh sửa trích xuất"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="p-1 text-red-650 hover:text-red-900 hover:bg-red-50 rounded cursor-pointer"
                              title="Xóa tài liệu khỏi hệ thống"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Editing Parsed Text of selected doc */}
            {selectedDoc && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div>
                    <h3 className="font-display font-bold text-sm text-brand-blue-dark">
                      Kiểm duyệt & Chỉnh sửa Văn bản Trích xuất tự động bằng AI
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Cập nhật thủ công nội dung RAG cho tài liệu: <span className="font-bold text-slate-600">{selectedDoc.title}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedDoc(null)}
                    className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    Đóng biên tập
                  </button>
                </div>

                {isEditingDoc ? (
                  <div className="space-y-4">
                    <textarea
                      value={editDocText}
                      onChange={(e) => setEditDocText(e.target.value)}
                      rows={12}
                      className="w-full text-xs font-mono text-slate-700 bg-slate-50 p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue-light"
                    ></textarea>
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => {
                          setIsEditingDoc(false);
                          setEditDocText(selectedDoc.content);
                        }}
                        className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        Hủy bỏ
                      </button>
                      <button
                        onClick={handleSaveDocEdit}
                        className="px-5 py-2 bg-brand-blue-dark hover:bg-blue-950 text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer"
                      >
                        Lưu Thay đổi
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 bg-slate-50/50 p-4 rounded-xl border border-dashed border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase">Xem trước văn bản thô RAG</span>
                      <button
                        onClick={() => setIsEditingDoc(true)}
                        className="flex items-center space-x-1.5 text-xs text-brand-blue-dark hover:text-blue-950 hover:underline font-bold"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        <span>Bấm vào để bắt đầu Sửa đổi</span>
                      </button>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-xs font-sans text-slate-600 max-h-[300px] overflow-y-auto whitespace-pre-line border border-slate-200 custom-scrollbar">
                      {selectedDoc.content}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Upload new doc form (Span 1) */}
          <div className="xl:col-span-1 space-y-6">
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 sticky top-24 shadow-2xl text-slate-100">
              <h2 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center space-x-2">
                <Upload className="h-4 w-4 animate-bounce" />
                <span>Tải tài liệu tuyển sinh mới</span>
              </h2>

              <form onSubmit={handleUploadSubmit} className="space-y-4">
                
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                    Hệ đào tạo tuyển sinh *
                  </label>
                  <select
                    value={newDocCategory}
                    onChange={(e) => setNewDocCategory(e.target.value)}
                    className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-teal-500 transition-all font-medium"
                  >
                    {categories.filter(c => c.isActive).map(c => (
                      <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
                    ))}
                    {categories.length === 0 && (
                      <>
                        <option value="ug" className="bg-slate-900">Đại Học Chính Quy (Undergraduate)</option>
                        <option value="pg" className="bg-slate-900">Thạc Sĩ / Sau Đại Học (Postgraduate)</option>
                        <option value="general" className="bg-slate-900">Khác / Tổng Quan Chung</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                    Tên đặt tiêu đề tài liệu *
                  </label>
                  <input
                    type="text"
                    required
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    placeholder="Ví dụ: Đề án Tuyển sinh Đại học 2025"
                    className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 placeholder:text-slate-650 outline-none focus:ring-1 focus:ring-teal-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                    Số phiên bản nộp tài liệu
                  </label>
                  <input
                    type="text"
                    value={newDocVersion}
                    onChange={(e) => setNewDocVersion(e.target.value)}
                    placeholder="Mặc định: 1.0"
                    className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 placeholder:text-slate-650 outline-none focus:ring-1 focus:ring-teal-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                    Chọn tệp tuyển sinh (.docx, .pdf, .xlsx, .txt) *
                  </label>
                  <div className="border-2 border-dashed border-white/10 hover:border-teal-500 rounded-2xl p-5 text-center cursor-pointer hover:bg-white/5 transition-all relative">
                    <input
                      type="file"
                      required
                      accept=".docx,.pdf,.xlsx,.csv,.txt"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <FileSpreadsheet className="mx-auto h-8 w-8 text-teal-500/85 mb-2" />
                    <p className="text-xs font-semibold text-slate-200">
                      {selectedFile ? selectedFile.name : 'Kéo thả hoặc Click chọn file'}
                    </p>
                    <p className="text-[9px] text-teal-400 font-semibold mt-2.5 leading-relaxed bg-teal-500/10 border border-teal-500/20 p-2 rounded-lg">
                      ⚡ Đã nâng cấp RAG: Tự động nhân bản các ô gộp (colspan/rowspan) phức tạp và phân rã hàng thành văn xuôi chuẩn xác.
                    </p>
                  </div>
                </div>

                {uploadError && (
                  <div className="bg-red-950/40 p-3 rounded-xl border border-red-500/20 text-[11px] text-red-400 leading-normal flex items-start space-x-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadSuccess && (
                  <div className="bg-teal-950/40 p-3 rounded-xl border border-teal-500/20 text-[11px] text-teal-400 leading-normal flex items-start space-x-1.5 animate-pulse">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-teal-500" />
                    <span>Nộp tài liệu thành công! Robot RAG đã phân đoạn trích xuất dữ liệu tự động.</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={uploadProgress || !selectedFile}
                  className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 px-4 rounded-xl text-xs shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploadProgress ? (
                    <>
                      <LoaderIcon className="animate-spin text-slate-950" />
                      <span>Đang trích xuất xử lý AI RAG ...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      <span>Xử lý & Khai thác Tri thức</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: BAN NGÂN HÀNG FAQ */}
      {activeTab === 'faqs' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* List existing FAQs */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-sm font-bold text-brand-blue-dark uppercase tracking-wide mb-4 flex items-center space-x-2">
                <HelpCircle className="h-4 w-4" />
                <span>Danh sách câu hỏi thường gặp đã xuất bản</span>
              </h2>

              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredFaqs.map((faq) => (
                  <div 
                    key={faq.id}
                    className="p-4 bg-slate-50/50 rounded-xl border border-slate-150 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center space-x-2.5 flex-wrap gap-1.5">
                          <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase ${
                            faq.category === 'ug' 
                              ? 'bg-amber-100 text-amber-800' 
                              : faq.category === 'pg' 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
                          }`}>
                            {getCategoryName(faq.category)}
                          </span>
                          
                          {faq.tags.map((tag, i) => (
                            <span key={i} className="text-[10px] bg-slate-200/60 text-slate-600 px-1.5 py-0.5 rounded flex items-center space-x-1 font-sans">
                              <Tag className="h-2.5 w-2.5 text-slate-400" />
                              <span>{tag}</span>
                            </span>
                          ))}
                        </div>
                        <h4 className="font-bold text-slate-800 text-xs mt-2.5">
                          Hỏi: {faq.question}
                        </h4>
                        <p className="text-xs text-slate-600 mt-2.5 whitespace-pre-line leading-relaxed pl-3 border-l-2 border-brand-orange">
                          {faq.answer}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteFaq(faq.id)}
                        className="p-1.5 text-slate-400 hover:text-red-550 hover:bg-red-50 rounded"
                        title="Xóa FAQ khỏi danh sách"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Form to add FAQ */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sticky top-24">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4 flex items-center space-x-1.5">
                <Plus className="h-4.5 w-4.5 text-brand-orange animate-pulse" />
                <span>Thêm câu hỏi FAQ mẫu mới</span>
              </h2>

              <form onSubmit={handleFaqSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Hệ đào tạo tuyển sinh *
                  </label>
                  <select
                    value={newFaqCategory}
                    onChange={(e) => setNewFaqCategory(e.target.value)}
                    className="w-full text-slate-800 text-xs border border-slate-200 rounded-lg p-2.5 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-brand-blue-light"
                  >
                    {categories.filter(c => c.isActive).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {categories.length === 0 && (
                      <>
                        <option value="ug">Đại Học Chính Quy</option>
                        <option value="pg">Thạc Sĩ / Tiến Sĩ</option>
                        <option value="general">Phân hệ Tổng Quan Chung</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Nhập câu hỏi mẫu *
                  </label>
                  <input
                    type="text"
                    required
                    value={newFaqQuestion}
                    onChange={(e) => setNewFaqQuestion(e.target.value)}
                    placeholder="Ví dụ: Cách thức đăng ký xét tuyển học bạ bằng Zalo?"
                    className="w-full text-slate-800 text-xs border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-brand-blue-light font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Nhập câu trả lời chi tiết *
                  </label>
                  <textarea
                    required
                    value={newFaqAnswer}
                    onChange={(e) => setNewFaqAnswer(e.target.value)}
                    placeholder="Nhập nội dung thông tin trả lời..."
                    rows={4}
                    className="w-full text-slate-800 text-xs border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-brand-blue-light"
                  ></textarea>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Gắn từ khóa tìm kiếm (Gần nhau ngăn cách bằng dấu phẩy)
                  </label>
                  <input
                    type="text"
                    value={newFaqTags}
                    onChange={(e) => setNewFaqTags(e.target.value)}
                    placeholder="Ví dụ: đăng ký, học bạ, điện thoại"
                    className="w-full text-slate-805 text-xs border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-brand-blue-light"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Sẽ giúp chatbot liên kết tìm kiếm ngữ nghĩa nhanh hơn đợt tới.
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full bg-brand-blue-dark hover:bg-blue-950 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Lưu vào FAQ chung</span>
                </button>
              </form>
            </div>
          </div>

        </div>
      )}

      {/* TAB 3: USER INQUIRIES HISTORY */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-100 pb-3 mb-4 gap-2">
            <div>
              <h2 className="text-sm font-bold text-brand-blue-dark uppercase tracking-wide flex items-center space-x-2">
                <Clock className="h-4 w-4" />
                <span>Nhật ký & Lịch sử người dùng đặt câu hỏi thực tế</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Theo dõi sát nhu cầu học sinh/học viên tìm hiểu, giúp cán bộ bổ sung câu trả lời mẫu nhanh chóng.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="p-3">Thời gian</th>
                  <th className="p-3">Phân hệ</th>
                  <th className="p-3">Câu hỏi đặt ra</th>
                  <th className="p-3">Gắn nhãn tuyển sinh</th>
                  <th className="p-3">Đánh giá</th>
                  <th className="p-3 text-right">Khác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {new Date(item.timestamp).toLocaleString('vi-VN', { 
                        month: '2-digit', 
                        day: '2-digit', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase ${
                        item.categoryMatched === 'ug' 
                          ? 'bg-amber-100 text-amber-800' 
                          : item.categoryMatched === 'pg' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
                      }`}>
                        {getCategoryName(item.categoryMatched)}
                      </span>
                    </td>
                    <td className="p-3 max-w-[320px]">
                      <div className="font-bold text-slate-800" title={item.question}>{item.question}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1 mt-1 font-sans font-medium whitespace-pre-wrap">{item.answer.substring(0, 150)}...</div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {item.tags.map((tag, i) => (
                          <span key={i} className="text-[9px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-medium border border-sky-100">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {item.feedback === 'up' && (
                        <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-bold flex items-center space-x-1 w-max">
                          <ThumbsUp className="h-3 w-3" />
                          <span className="text-[10px]">Cực hữu ích</span>
                        </span>
                      )}
                      {item.feedback === 'down' && (
                        <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-bold flex items-center space-x-1 w-max">
                          <ThumbsDown className="h-3 w-3" />
                          <span className="text-[10px]">Cần tối ưu</span>
                        </span>
                      )}
                      {item.feedback === null && (
                        <span className="text-slate-400 text-[10px]">-</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handlePrepopulateFAQ(item)}
                        className="py-1 px-2.5 bg-brand-orange text-brand-blue-dark text-[10px] font-bold rounded-lg hover:shadow cursor-pointer transition-all"
                        title="Sao chép nội dung này thành FAQ mẫu mới của trường"
                      >
                        Bổ sung làm mẫu
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: REAL-TIME ANALYTICS STATS */}
      {activeTab === 'stats' && stats && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Top Numeric KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-3xl border border-slate-200 flex items-center space-x-4 shadow-sm">
              <div className="bg-blue-50 text-brand-blue-dark p-3 rounded-2xl">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-slate-400 font-bold uppercase text-[9px] tracking-wider">Tổng câu hỏi nhận được</span>
                <span className="text-2xl font-bold font-display text-slate-800">{stats.totalQuestions}</span>
              </div>
            </div>
            <div className="bg-white p-5 rounded-3xl border border-slate-200 flex items-center space-x-4 shadow-sm">
              <div className="bg-emerald-50 text-emerald-700 p-3 rounded-2xl">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-slate-400 font-bold uppercase text-[9px] tracking-wider">Tài liệu RAG văn bản cập nhật</span>
                <span className="text-2xl font-bold font-display text-slate-800">{stats.totalDocs}</span>
              </div>
            </div>
            <div className="bg-white p-5 rounded-3xl border border-slate-200 flex items-center space-x-4 shadow-sm">
              <div className="bg-amber-50 text-amber-700 p-3 rounded-2xl">
                <HelpCircle className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-slate-400 font-bold uppercase text-[9px] tracking-wider">Tổng FAQ mẫu khả dụng</span>
                <span className="text-2xl font-bold font-display text-slate-800">{stats.totalFaqs}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Tag / Topic counts */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="font-display font-semibold text-sm text-slate-800 mb-4 flex items-center space-x-2">
                <Tag className="h-4.5 w-4.5 text-brand-orange" />
                <span>Xếp hạng Chủ Đề được Thí sinh Hỏi nhiều Nhất đợt này</span>
              </h3>
              
              <div className="space-y-3.5">
                {stats.tagStats.length > 0 ? (
                  stats.tagStats.map((tagObj, idx) => {
                    const maxVal = Math.max(...stats.tagStats.map(t => t.count)) || 1;
                    const percent = Math.round((tagObj.count / maxVal) * 100);
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700 uppercase tracking-tight">#{idx + 1} {tagObj.tag}</span>
                          <span className="font-bold text-slate-500">{tagObj.count} lượt</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="bg-brand-blue-light h-full rounded-full transition-all"
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 italic">Chưa phát tích đủ lượt hỏi đáp.</p>
                )}
              </div>
            </div>

            {/* Category split */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="font-display font-semibold text-sm text-slate-800 mb-4 flex items-center space-x-2">
                <FileText className="h-4.5 w-4.5 text-sky-600" />
                <span>Cơ cấu mối quan tâm Hệ Đào Tạo</span>
              </h3>

              <div className="space-y-5">
                {stats.categoryStats.map((catObj, idx) => {
                  const sumVal = stats.categoryStats.reduce((acc, curr) => acc + curr.count, 0) || 1;
                  const ratio = Math.round((catObj.count / sumVal) * 100);
                  return (
                    <div key={idx} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <span className="h-3 w-3 rounded-full bg-slate-200 border border-slate-350" style={{
                          backgroundColor: idx === 0 ? '#4a90e2' : idx === 1 ? '#003366' : idx === 2 ? '#f5a623' : '#94a3b8'
                        }}></span>
                        <span className="text-xs font-semibold text-slate-700">{catObj.category}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-800 block">{catObj.count} câu hỏi</span>
                        <span className="text-[10px] text-slate-400 block font-bold">{ratio}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Advice box for managers */}
              <div className="mt-8 bg-blue-50/75 p-3.5 rounded-xl border border-blue-100 text-[11px] text-blue-800 leading-normal flex items-start space-x-2">
                <HelpCircle className="h-4 w-4 shrink-0 text-brand-blue-light mt-0.5" />
                <div>
                  <strong>💡 Gợi ý tổ chức chiến dịch:</strong> Dựa trên dữ liệu hỏi nóng, chủ đề <strong>học phí</strong> và <strong>ngành ứng tuyển</strong> đang chiếm tỉ trọng cao nhất. Học viện nên tập trung xây dựng các video ngắn giới thiệu sâu về chương trình và học bổng đợt tới.
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 5: STAFF PERMISSIONS MANAGEMENT */}
      {activeTab === 'admins' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4 mb-6">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 uppercase">Danh sách cán bộ được phân quyền quản trị</h2>
                  <p className="text-xs text-slate-400 font-medium">Danh mục các tài khoản có thẩm quyền quản trị hệ thống tri thức tuyển sinh</p>
                </div>
              </div>
              <button 
                onClick={fetchAdmins}
                className="mt-3 md:mt-0 flex items-center space-x-1 border border-slate-200 hover:bg-slate-50 py-1.5 px-3 rounded-xl text-xs font-semibold text-slate-600 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Nạp lại dữ liệu</span>
              </button>
            </div>

            {adminsError && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-xs font-medium mb-5">
                {adminsError}
              </div>
            )}
            {adminsSuccess && (
              <div className="p-4 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 text-xs font-medium mb-5">
                {adminsSuccess}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Add New Admin Section (Span 1) */}
              <div className="lg:col-span-1 bg-slate-50/75 p-5 rounded-2xl border border-slate-150">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center space-x-1.5">
                  <UserPlus className="h-4 w-4 text-blue-600" />
                  <span>Cấp quyền Cán bộ Mới</span>
                </h3>
                
                {currentUser?.email === 'tructn@vwa.edu.vn' ? (
                  <form onSubmit={handleAddAdmin} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1.5">Địa chỉ email học viện</label>
                      <input 
                        type="email"
                        placeholder="vi-du: cán-bo-abc@vwa.edu.vn"
                        required
                        value={newAdminEmailInput}
                        onChange={(e) => setNewAdminEmailInput(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>

                    <div className="space-y-2 mt-3">
                      <label className="block text-[11px] font-bold text-slate-600 uppercase">Phân quyền Hệ đào tạo quản lý</label>
                      <div className="grid grid-cols-1 gap-2 bg-white p-3 rounded-xl border border-slate-200">
                        <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={newAdminCategories.includes('ug')}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewAdminCategories([...newAdminCategories, 'ug']);
                              } else {
                                setNewAdminCategories(newAdminCategories.filter(c => c !== 'ug'));
                              }
                            }}
                            className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                          />
                          <span>Đại học Chính quy (ug)</span>
                        </label>
                        <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={newAdminCategories.includes('pg')}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewAdminCategories([...newAdminCategories, 'pg']);
                              } else {
                                setNewAdminCategories(newAdminCategories.filter(c => c !== 'pg'));
                              }
                            }}
                            className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                          />
                          <span>Thạc sĩ / Tiến sĩ / Sau đại học (pg)</span>
                        </label>
                        <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={newAdminCategories.includes('general')}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewAdminCategories([...newAdminCategories, 'general']);
                              } else {
                                setNewAdminCategories(newAdminCategories.filter(c => c !== 'general'));
                              }
                            }}
                            className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                          />
                          <span>Tổng quan chung (general)</span>
                        </label>
                      </div>
                    </div>
                    
                    <div className="p-3 bg-blue-50/50 text-blue-800 text-[11.5px] rounded-lg border border-blue-100 flex items-start space-x-1.5">
                      <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                      <span>Cán bộ mới bắt buộc nhập đúng địa chỉ email có đuôi <strong>@vwa.edu.vn</strong> để có thể đăng nhập khớp tên miền.</span>
                    </div>

                    <button
                      type="submit"
                      disabled={adminsLoading}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-2 px-4 rounded-xl text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center space-x-1"
                    >
                      <span>Cấp quyền & Gán Phân hệ</span>
                    </button>
                  </form>
                ) : (
                  <div className="p-4 bg-orange-50 text-orange-850 text-xs rounded-xl border border-orange-100 flex items-start space-x-2">
                    <ShieldAlert className="h-4.5 w-4.5 text-orange-500 shrink-0 mt-0.5" />
                    <div>
                      <strong>Quyền hạn hạn chế:</strong> Chỉ có Quản trị tối cao <strong>tructn@vwa.edu.vn</strong> mới có quyền cấp phép hoặc bãi miễn tài khoản quản trị khác.
                    </div>
                  </div>
                )}
              </div>

              {/* Admins List Table (Span 2) */}
              <div className="lg:col-span-2">
                <div className="overflow-x-auto border border-slate-150 rounded-2xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase tracking-wider font-semibold">
                        <th className="p-3">Tài khoản Email</th>
                        <th className="p-3">Hệ đào tạo được quản lý</th>
                        <th className="p-3">Trạng thái duyệt</th>
                        <th className="p-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* Superadmin always on top */}
                      <tr className="bg-blue-50/15">
                        <td className="p-3 font-mono font-bold text-slate-900">tructn@vwa.edu.vn</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#003366] text-white">Đại học</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#003366] text-white">Sau đại học</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#003366] text-white">Tổng quan</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center space-x-1.5 text-emerald-600 font-bold">
                            <Check className="h-3.5 w-3.5" />
                            <span>Quản trị Tối cao</span>
                          </div>
                        </td>
                        <td className="p-3 text-right text-slate-400 italic text-[11px]">Không thể thu hồi</td>
                      </tr>

                      {/* Other Admins */}
                      {adminsList.filter(item => item.email.toLowerCase() !== 'tructn@vwa.edu.vn').map((item) => (
                        <tr key={item.email} className="hover:bg-slate-50">
                          <td className="p-3 font-mono text-slate-700">{item.email}</td>
                          <td className="p-3">
                            {currentUser?.email === 'tructn@vwa.edu.vn' ? (
                              <div className="flex flex-col space-y-1.5 min-w-[200px] bg-white p-2 rounded-xl border border-slate-100 shadow-sm">
                                <label className="flex items-center space-x-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={item.categories.includes('ug')}
                                    onChange={() => handleToggleAdminPermission(item.email, 'ug', item.categories)}
                                    disabled={adminsLoading}
                                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                                  />
                                  <span>Đại học Chính quy (ug)</span>
                                </label>
                                <label className="flex items-center space-x-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={item.categories.includes('pg')}
                                    onChange={() => handleToggleAdminPermission(item.email, 'pg', item.categories)}
                                    disabled={adminsLoading}
                                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                                  />
                                  <span>Thạc sĩ / Sau đ.học (pg)</span>
                                </label>
                                <label className="flex items-center space-x-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={item.categories.includes('general')}
                                    onChange={() => handleToggleAdminPermission(item.email, 'general', item.categories)}
                                    disabled={adminsLoading}
                                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                                  />
                                  <span>Tổng quan chung (general)</span>
                                </label>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {item.categories.includes('ug') && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Đại học</span>
                                )}
                                {item.categories.includes('pg') && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Sau đại học</span>
                                )}
                                {item.categories.includes('general') && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">Chung</span>
                                )}
                                {item.categories.length === 0 && (
                                  <span className="text-slate-400 italic text-[10px]">Không có quyền</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center space-x-1.5 text-emerald-500 font-bold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Được cấp phép</span>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {currentUser?.email === 'tructn@vwa.edu.vn' ? (
                              <button
                                onClick={() => handleRemoveAdmin(item.email)}
                                title="Thu hồi quyền quản trị"
                                className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        </tr>
                      ))}

                      {adminsList.filter(item => item.email.toLowerCase() !== 'tructn@vwa.edu.vn').length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-slate-400 italic">Chưa có tài khoản cán bộ bổ sung nào được cấp quyền quản trị.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 7: QUẢN LÝ CÁC HỆ / PHÂN HỆ ĐÀO TẠO */}
      {activeTab === 'systems' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Main layout: list on left (xl:col-span-2), form on right (xl:col-span-1) */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Left Col: Systems List */}
            <div className="xl:col-span-2 bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-5 shrink-0">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-800 uppercase">Danh sách Hệ đào tạo hiện có</h2>
                    <p className="text-xs text-slate-400 font-medium">Kích hoạt, điều chỉnh hoặc cơ cấu lại các phân hệ tuyển sinh trong hệ thống</p>
                  </div>
                </div>
                <button
                  onClick={fetchCategories}
                  disabled={categoriesLoading}
                  className="p-1 px-3 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 hover:text-slate-800 transition-all text-xs font-semibold flex items-center space-x-1 border border-slate-200 cursor-pointer shadow-xs"
                  title="Tải lại dữ liệu"
                >
                  <RefreshCw className={`h-3 w-3 ${categoriesLoading ? 'animate-spin' : ''}`} />
                  <span>Tải lại</span>
                </button>
              </div>

              {categoriesError && (
                <div className="mb-4 p-4 bg-red-50 text-red-700 text-xs font-semibold rounded-2xl flex items-center space-x-2 border border-red-100 animate-slide-up shrink-0">
                  <ShieldAlert className="h-4.5 w-4.5 text-red-500" />
                  <span>{categoriesError}</span>
                </div>
              )}

              {categoriesSuccess && (
                <div className="mb-4 p-4 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-2xl flex items-center space-x-2 border border-emerald-100 animate-slide-up shrink-0">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                  <span>{categoriesSuccess}</span>
                </div>
              )}

              {/* Table / Grid list */}
              <div className="overflow-x-auto min-h-[300px]">
                {categoriesLoading && categories.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-3">
                    <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
                    <span className="text-slate-400 text-xs font-medium">Đang tìm dữ liệu phân hệ đào tạo...</span>
                  </div>
                ) : categories.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400">
                    <AlertTriangle className="h-10 w-10 text-slate-300" />
                    <span className="text-sm font-semibold">Chưa có phân hệ đào tạo nào được tạo.</span>
                    <p className="text-xs">Sử dụng form bên phải để kích hoạt hệ đào tạo đầu tiên.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 pb-2 bg-slate-50/50 rounded-lg text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <th className="p-3">Mã phân hệ (ID)</th>
                        <th className="p-3">Tên hệ đào tạo</th>
                        <th className="p-3">Mô tả chi tiết</th>
                        <th className="p-3 text-center">Trạng thái</th>
                        <th className="p-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-600">
                      {categories.map((cat) => {
                        const isOriginalCat = cat.id === 'ug' || cat.id === 'pg' || cat.id === 'general';
                        const isEditingThis = editingCategory === cat.id;

                        return (
                          <tr key={cat.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-3">
                              <span className="font-mono bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded text-[11px] select-all">
                                {cat.id}
                              </span>
                            </td>
                            
                            <td className="p-3">
                              {isEditingThis ? (
                                <input
                                  type="text"
                                  value={editCatName}
                                  onChange={(e) => setEditCatName(e.target.value)}
                                  className="w-full text-slate-800 text-xs border border-blue-200 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                  required
                                />
                              ) : (
                                <span className="font-bold text-slate-800">{cat.name}</span>
                              )}
                            </td>

                            <td className="p-3 max-w-[220px]">
                              {isEditingThis ? (
                                <textarea
                                  value={editCatDescription}
                                  onChange={(e) => setEditCatDescription(e.target.value)}
                                  className="w-full text-slate-800 text-xs border border-blue-200 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                  rows={2}
                                />
                              ) : (
                                <span className="text-slate-400 text-[11px] line-clamp-2" title={cat.description}>
                                  {cat.description || 'Chưa có thông tin mô tả.'}
                                </span>
                              )}
                            </td>

                            <td className="p-3 text-center">
                              {isEditingThis ? (
                                <div className="flex items-center justify-center space-x-1">
                                  <input
                                    type="checkbox"
                                    id={`edit-active-${cat.id}`}
                                    checked={editCatIsActive}
                                    onChange={(e) => setEditCatIsActive(e.target.checked)}
                                    className="h-4 w-4 rounded text-blue-600"
                                  />
                                  <label htmlFor={`edit-active-${cat.id}`} className="text-[11px] cursor-pointer">Hoạt động</label>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleToggleCategoryActive(cat.id, cat.isActive)}
                                  className="mx-auto flex items-center justify-center text-left cursor-pointer border-none bg-transparent"
                                  title={cat.isActive ? 'Nhấn để tắt kích hoạt' : 'Nhấn để kích hoạt hoạt động'}
                                >
                                  {cat.isActive ? (
                                    <span className="inline-flex items-center space-x-1 text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                                      <Check className="h-3 w-3" />
                                      <span>Đang bật</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center space-x-1 text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                                      <X className="h-2.5 w-2.5" />
                                      <span>Vô hiệu</span>
                                    </span>
                                  )}
                                </button>
                              )}
                            </td>

                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end space-x-2">
                                {isEditingThis ? (
                                  <>
                                    <button
                                      onClick={() => handleUpdateCategory(cat.id)}
                                      className="p-1 px-2.5 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700 transition-all cursor-pointer flex items-center space-x-1"
                                      title="Lưu các nội dung đã thay đổi"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      <span>Lưu</span>
                                    </button>
                                    <button
                                      onClick={() => setEditingCategory(null)}
                                      className="p-1 px-2 text-slate-500 hover:bg-slate-100 rounded text-[11px] transition-all cursor-pointer"
                                      title="Cancel"
                                    >
                                      Hủy
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                        setEditingCategory(cat.id);
                                        setEditCatName(cat.name);
                                        setEditCatDescription(cat.description || '');
                                        setEditCatIsActive(cat.isActive);
                                      }}
                                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-all cursor-pointer"
                                      title="Sửa tên hoặc mô tả phân hệ"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </button>
                                    {!isOriginalCat && (
                                      <button
                                        onClick={() => handleDeleteCategory(cat.id)}
                                        className="p-1 text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer"
                                        title="Xóa hoàn toàn hệ đào tạo này"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right Col: Add New System Form */}
            <div className="xl:col-span-1 space-y-6">
              <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 sticky top-24 shadow-2xl text-slate-100">
                <h2 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center space-x-2">
                  <Plus className="h-4 w-4 animate-bounce" />
                  <span>Khai sinh / Thêm Hệ đào tạo mới</span>
                </h2>

                <form onSubmit={handleCreateCategory} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                      Mã phân hệ viết tắt (ID) *
                    </label>
                    <input
                      type="text"
                      required
                      value={newCatId}
                      onChange={(e) => setNewCatId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                      placeholder="vd: ug, pg, sc, lh..."
                      className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-teal-500 transition-all font-medium font-mono"
                    />
                    <span className="text-[10px] text-slate-500 block mt-1">Chỉ sử dụng chữ thường không dấu, số, hoặc dấu ngạch ngang.</span>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                      Tên Hệ đào tạo chính thức *
                    </label>
                    <input
                      type="text"
                      required
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="Ví dụ: Đại Học liên thông, Cao đẳng,..."
                      className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-teal-500 transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1.5">
                      Mô tả / Ghi chú cho Hệ đào tạo
                    </label>
                    <textarea
                      value={newCatDescription}
                      onChange={(e) => setNewCatDescription(e.target.value)}
                      placeholder="Ví dụ: Dành riêng cho hệ liên thông ngành cử nhân Luật học đợt thu Đông..."
                      rows={3}
                      className="w-full text-slate-100 bg-slate-950 text-xs border border-white/10 rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-teal-500 transition-all font-medium"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="newCatIsActive"
                      checked={newCatIsActive}
                      onChange={(e) => setNewCatIsActive(e.target.checked)}
                      className="h-4.5 w-4.5 rounded border-white/10 text-teal-500 focus:ring-teal-500 bg-slate-950"
                    />
                    <label htmlFor="newCatIsActive" className="text-xs text-slate-300 font-semibold cursor-pointer">
                      Đưa vào hoạt động và kích hoạt ngay
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={categoriesLoading}
                    className="w-full mt-4 py-3 bg-gradient-to-r from-teal-500 to-emerald-600 text-teal-950 text-xs font-bold rounded-xl hover:shadow-[0_4px_20px_rgba(20,184,166,0.3)] hover:scale-[1.01] transition-all duration-300 cursor-pointer flex items-center justify-center space-x-2 isDisabled:opacity-50 border-none"
                  >
                    {categoriesLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span>Thêm Phân Hệ Mới</span>
                  </button>
                </form>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB: 1-1 CONSULTATIONS */}
      {activeTab === 'consultations' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4 mb-6">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-pink-50 text-pink-600 rounded-xl">
                  <Phone className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 uppercase">Danh sách đăng ký tư vấn 1-1</h2>
                  <p className="text-xs text-slate-400 font-medium font-sans">Danh sách các em thí sinh / phụ huynh đăng ký gọi lại tư vấn hỗ trợ trực tiếp</p>
                </div>
              </div>
              
              <button 
                onClick={fetchConsultations}
                disabled={consultationsLoading}
                className="flex items-center space-x-1.5 border border-slate-200 bg-slate-50 py-2 px-3.5 rounded-xl text-xs hover:bg-slate-100 font-semibold text-slate-605 transition-all cursor-pointer shadow-sm ml-auto md:ml-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${consultationsLoading ? 'animate-spin' : ''}`} />
                <span>Nạp lại danh sách</span>
              </button>
            </div>

            {consultationsError && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 text-xs font-semibold">
                {consultationsError}
              </div>
            )}

            {consultationsLoading && consultations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
                <span className="text-xs font-medium">Đang tải danh sách đăng ký tư vấn...</span>
              </div>
            ) : consultations.length === 0 ? (
              <div className="text-center py-16 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200/80 p-6">
                <Phone className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-700 font-display">Chưa có lượt đăng ký nào</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">Khi thí sinh hay phụ huynh điền mẫu “Kết nối Tư vấn 1-1” từ ô trò chuyện, thông tin đăng ký tư vấn sẽ tập hợp lưu trữ đầy đủ tại đây.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
                <table className="min-w-full border-collapse divide-y divide-slate-100 text-left">
                  <thead className="bg-slate-50/75">
                    <tr>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Thông tin Thí sinh</th>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Hệ đào tạo quan tâm</th>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider max-w-[280px]">Nội dung lời nhắn</th>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Thời gian đăng ký</th>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái liên hệ</th>
                      <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-xs font-sans">
                    {consultations.slice().reverse().map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-bold text-sm text-slate-800 flex items-center space-x-1.5">
                            <span className="p-1 bg-sky-50 text-sky-600 rounded-md">
                              <User className="h-3.5 w-3.5" />
                            </span>
                            <span>{item.name}</span>
                          </div>
                          <div className="mt-1.5 space-y-1 text-xs text-slate-500 font-medium">
                            <div className="flex items-center space-x-1">
                              <Phone className="h-3 w-3 text-slate-400" />
                              <a href={`tel:${item.phone}`} className="hover:underline hover:text-blue-600 font-mono font-bold text-slate-600">{item.phone}</a>
                            </div>
                            {item.email && (
                              <div className="flex items-center space-x-1">
                                <Mail className="h-3 w-3 text-slate-400" />
                                <a href={`mailto:${item.email}`} className="hover:underline hover:text-blue-600">{item.email}</a>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            item.level === 'pg' 
                              ? 'bg-rose-50 text-rose-700 border border-rose-100/60' 
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-100/60'
                          }`}>
                            {item.level === 'pg' ? 'Thạc sĩ - SĐH' : 'Đại học Chính quy'}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-600 align-middle font-medium max-w-[280px] break-words whitespace-pre-line leading-relaxed">
                          {item.notes || <span className="text-slate-350 italic">Không có lời nhắn bổ sung</span>}
                        </td>
                        <td className="px-5 py-4 text-slate-500 align-middle font-mono font-medium">
                          {new Date(item.createdAt).toLocaleString('vi-VN')}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className={`px-2.5 py-1 border rounded-full text-[10px] font-bold ${
                            item.status === 'contacted'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : item.status === 'cancelled'
                              ? 'bg-slate-100 text-slate-500 border-slate-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200 animate-pulse'
                          }`}>
                            {item.status === 'contacted' 
                              ? 'Đã tư vấn xong' 
                              : item.status === 'cancelled' 
                              ? 'Đã hủy' 
                              : 'Đợi gọi lại tư vấn'}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right align-middle space-x-1.5 whitespace-nowrap">
                          {item.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateConsultationStatus(item.id, 'contacted')}
                              className="px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer transition-colors"
                              title="Xác nhận đã gọi tư vấn thành công"
                            >
                              Xác nhận gọi thành công
                            </button>
                          )}
                          {item.status === 'contacted' && (
                            <button
                              onClick={() => handleUpdateConsultationStatus(item.id, 'pending')}
                              className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer transition-all border border-slate-200"
                              title="Chuyển về trạng thái chờ duyệt gọi lại"
                            >
                              Đánh dấu lại là đợi gọi
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteConsultation(item.id)}
                            className="p-1 px-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors inline-block"
                            title="Xóa thông tin tuyển sinh này"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: TRAINING UNIT / SCHOOL PROFILE SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4 mb-6">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 uppercase">Cấu hình Đơn vị Đào tạo & Thương hiệu</h2>
                  <p className="text-xs text-slate-400 font-medium">Thay đổi thông tin nhận diện cơ sở giáo dục, hotline, địa chỉ, website, và logo biểu trưng</p>
                </div>
              </div>
            </div>

            {cfgError && (
              <div className="p-4 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl text-xs font-semibold mb-5 flex items-start space-x-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{cfgError}</span>
              </div>
            )}
            
            {cfgSuccess && (
              <div className="p-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-xs font-semibold mb-5 flex items-start space-x-2">
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{cfgSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Profile Config Form */}
              <form onSubmit={handleSaveSettings} className="lg:col-span-2 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Tên Cơ sở đào tạo (Tiếng Việt) <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      value={cfgName}
                      onChange={(e) => setCfgName(e.target.value)}
                      placeholder="Ví dụ: Học viện Phụ nữ Việt Nam"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Tên viết tắt (Thương hiệu) <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      value={cfgShortName}
                      onChange={(e) => setCfgShortName(e.target.value)}
                      placeholder="Ví dụ: VWA"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Địa chỉ Trụ sở chính / Cơ sở <span className="text-rose-500">*</span></label>
                  <textarea 
                    value={cfgAddress}
                    onChange={(e) => setCfgAddress(e.target.value)}
                    placeholder="Nhập địa chỉ đầy đủ để hiển thị ở chân trang"
                    rows={2}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Hotline Tư vấn tuyển sinh</label>
                    <input 
                      type="text" 
                      value={cfgHotline}
                      onChange={(e) => setCfgHotline(e.target.value)}
                      placeholder="Ví dụ: 024.3775.1750"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Email liên hệ tuyển sinh</label>
                    <input 
                      type="email" 
                      value={cfgEmail}
                      onChange={(e) => setCfgEmail(e.target.value)}
                      placeholder="Ví dụ: tuyensinh@vwa.edu.vn"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Website chính quy (URL)</label>
                    <input 
                      type="url" 
                      value={cfgWebsite}
                      onChange={(e) => setCfgWebsite(e.target.value)}
                      placeholder="Ví dụ: https://hvpnvn.edu.vn"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800"
                    />
                  </div>
                </div>

                {/* Logo & Symbol Selection */}
                <div className="border border-slate-150 p-4 rounded-2xl bg-slate-50 space-y-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase">Cấu hình biểu tượng & Biểu trưng thương hiệu</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Chọn Logo Biểu tượng (Nếu không tải ảnh lên)</label>
                      <select
                        value={cfgLogoIcon}
                        onChange={(e) => setCfgLogoIcon(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs outline-none text-slate-700 font-semibold focus:border-blue-500"
                      >
                        <option value="GraduationCap">🎓 Mũ Cử nhân (Graduation Cap)</option>
                        <option value="School">🏫 Trường học (School)</option>
                        <option value="BookOpen">📖 Sách mở (Book Open)</option>
                        <option value="Award">🏆 Cúp học thuật (Award)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Đường dẫn tệp Logo tùy chỉnh (Tùy chọn)</label>
                      <input 
                        type="text" 
                        value={cfgLogoUrl}
                        onChange={(e) => setCfgLogoUrl(e.target.value)}
                        placeholder="Có thể dán link ảnh logo hoặc tải ở bên phải"
                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:border-blue-500 outline-none text-slate-750"
                      />
                    </div>
                  </div>
                </div>

                {/* PHÂN HỆ QUẢN LÝ ĐỊNH TUYẾN AI & TỐI ƯU CHI PHÍ */}
                <div className="border border-indigo-100 p-5 rounded-2xl bg-gradient-to-br from-indigo-50/45 to-slate-50/70 space-y-4">
                  <div className="flex items-center space-x-2 border-b border-indigo-100 pb-2.5">
                    <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-indigo-900 uppercase">Phân hệ Quản lý Định tuyến & Tối ưu chi phí AI</h4>
                      <p className="text-[10px] text-indigo-600 font-medium">Bổ sung cơ chế giảm thiểu token, định tuyến cục bộ, bộ nhớ đệm và lọc lặp để tiết kiệm tối đa ngân sách vận hành</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {/* Routing Mode */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Chế độ định tuyến câu hỏi (Query Router)</label>
                      <select
                        value={cfgAiRoutingMode}
                        onChange={(e) => setCfgAiRoutingMode(e.target.value as any)}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs outline-none text-slate-700 font-semibold focus:border-indigo-500"
                      >
                        <option value="hybrid">🔄 Định tuyến kết hợp thông minh (Quét FAQ trước, AI sau - Tiết kiệm Token)</option>
                        <option value="ai_only">✨ Hoàn toàn bằng AI (Luôn gọi Gemini để trả lời phong phú nhất)</option>
                        <option value="faq_only">📴 Chỉ dùng Luật & FAQ nội bộ (Offline hoàn toàn - Không phát sinh chi phí API)</option>
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        {cfgAiRoutingMode === 'hybrid' && "💡 Hệ thống sẽ tự động đối chiếu câu hỏi của học sinh với cơ sở dữ liệu câu hỏi thường gặp FAQ. Nếu khớp với độ tương đồng thích hợp, câu hỏi sẽ được giải đáp ngay bằng câu trả lời soạn sẵn, giúp tốc độ phản hồi < 0.1s và tốn 0đ phí API."}
                        {cfgAiRoutingMode === 'ai_only' && "⚠️ Thích hợp khi muốn chatbot có giọng điệu biến chuyển linh hoạt. Mọi câu hỏi đều gọi trực tiếp lên máy chủ AI của Google."}
                        {cfgAiRoutingMode === 'faq_only' && "✅ Tránh tuyệt đối hóa đơn AI. Chatbot chỉ tìm kiếm thông tin từ tài liệu PDF/Docx của trường và FAQ cục bộ để sinh phản hồi."}
                      </p>
                    </div>

                    {/* FAQ Confidence Threshold - Only shown when hybrid is active */}
                    {(cfgAiRoutingMode === 'hybrid') && (
                      <div className="bg-white p-3.5 rounded-xl border border-slate-150 space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-[11px] font-bold text-slate-600 uppercase">Ngưỡng khớp FAQ thông minh (Confidence Threshold): <span className="text-indigo-600 font-bold">{cfgFaqConfidenceThreshold}%</span></label>
                          <span className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-bold">{cfgFaqConfidenceThreshold >= 50 ? 'Khắt khe' : cfgFaqConfidenceThreshold >= 30 ? 'Cân bằng' : 'Rộng rãi'}</span>
                        </div>
                        <input 
                          type="range" 
                          min="15" 
                          max="85" 
                          step="5"
                          value={cfgFaqConfidenceThreshold}
                          onChange={(e) => setCfgFaqConfidenceThreshold(Number(e.target.value))}
                          className="w-full accent-indigo-600 cursor-pointer"
                        />
                        <p className="text-[10px] text-slate-400 leading-normal">
                          Độ nhạy khớp từ khóa từ câu hỏi người dùng lên câu hỏi FAQ. Ngưỡng thấp hơn giúp tăng tỉ lệ bỏ cuộc gọi API (tiết kiệm tiền), nhưng ngưỡng quá thấp có thể trả về câu trả lời FAQ chưa hoàn toàn chính xác. Khuyên dùng: <strong className="text-slate-600">35% - 45%</strong>.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Select Model */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Mô hình AI mặc định</label>
                        <select
                          value={cfgDefaultModel}
                          onChange={(e) => setCfgDefaultModel(e.target.value)}
                          disabled={cfgAiRoutingMode === 'faq_only'}
                          className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs outline-none text-slate-700 font-semibold focus:border-indigo-500 disabled:opacity-50"
                        >
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash (Tối ưu phản hồi & Tốc độ)</option>
                          <option value="gemini-1.5-flash">Gemini 1.5 Flash (Chi phí hợp lý, ổn định)</option>
                          <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Hạn ngạch miễn phí cực lớn)</option>
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">Lựa chọn phiên bản mô hình xử lý khi không có FAQ khớp.</p>
                      </div>

                      {/* AI Max Tokens */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Giới hạn số từ AI sinh ra tối đa</label>
                        <select
                          value={cfgAiMaxTokens}
                          onChange={(e) => setCfgAiMaxTokens(Number(e.target.value))}
                          disabled={cfgAiRoutingMode === 'faq_only'}
                          className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs outline-none text-slate-700 font-semibold focus:border-indigo-500 disabled:opacity-50"
                        >
                          <option value={1000}>1000 Tokens (~600 từ - Tiết kiệm chi phí)</option>
                          <option value={1500}>1500 Tokens (~900 từ - Tiêu chuẩn đầy đủ)</option>
                          <option value={2000}>2000 Tokens (~1200 từ - Trả lời chi tiết)</option>
                          <option value={2500}>2500 Tokens (~1500 từ - Tối ưu)</option>
                          <option value={3000}>3000 Tokens (~1800 từ - Chi tiết nâng cao)</option>
                          <option value={4000}>4000 Tokens (~2400 từ - Thông tin Đầy Đủ Nhất - Khuyên dùng)</option>
                          <option value={8000}>8000 Tokens (~4800 từ - Siêu chi tiết chuyên sâu)</option>
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">Giới hạn đầu ra từ AI giúp tiết kiệm chi phí phát sinh theo lượng chữ.</p>
                      </div>
                    </div>

                    {/* Enable Fast-Cache */}
                    <div className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl">
                      <div className="space-y-0.5 max-w-[80%]">
                        <label className="block text-xs font-bold text-slate-700 uppercase">Kích hoạt bộ nhớ đệm thông minh (Response Fast Cache)</label>
                        <p className="text-[10px] text-slate-400 leading-normal">
                          Khi học sinh hỏi các câu hỏi hoàn toàn trùng khớp hoặc tương đương trong vòng 12 tiếng, hệ thống sẽ hồi đáp ngay nội dung từ cache lần trước. Tiêu hao <strong className="text-emerald-600 font-semibold">0đ Token</strong> và tải lập tức.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCfgEnableCache(!cfgEnableCache)}
                        className={`p-1 rounded-xl transition-all ${cfgEnableCache ? 'text-indigo-600' : 'text-slate-300'}`}
                      >
                        {cfgEnableCache ? (
                          <ToggleRight className="h-9 w-9 text-indigo-600 cursor-pointer" />
                        ) : (
                          <ToggleLeft className="h-9 w-9 text-slate-400 cursor-pointer" />
                        )}
                      </button>
                    </div>

                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={cfgSaveLoading}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-6 py-3.5 rounded-2xl cursor-pointer shadow-md hover:shadow-blue-550/20 transition-all flex items-center space-x-2 disabled:opacity-50"
                  >
                    {cfgSaveLoading && <LoaderIcon />}
                    <span>Lưu cấu hình hệ thống</span>
                  </button>
                </div>
              </form>

              {/* Logo Upload Box & Preview Card */}
              <div className="space-y-5">
                <div className="bg-slate-50 border border-slate-150 rounded-2xl p-5 text-center flex flex-col items-center">
                  <h4 className="text-xs font-bold text-slate-700 uppercase mb-4 w-full text-left">Biểu trưng & Preview Logo</h4>
                  
                  <div className="w-24 h-24 bg-white border border-slate-150 rounded-2xl flex items-center justify-center p-2 shadow-sm mb-4">
                    {cfgLogoUrl ? (
                      <img 
                        src={cfgLogoUrl} 
                        alt="Logo Preview" 
                        className="w-full h-full object-contain rounded-xl"
                        onError={(e) => {
                          // Fallback to error
                          (e.target as any).src = 'https://placehold.co/96x96?text=Invalid';
                        }}
                      />
                    ) : (
                      <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                        {cfgLogoIcon === 'School' && <School className="h-8 w-8" />}
                        {cfgLogoIcon === 'BookOpen' && <BookOpen className="h-8 w-8" />}
                        {cfgLogoIcon === 'Award' && <Award className="h-8 w-8" />}
                        {cfgLogoIcon === 'GraduationCap' && <GraduationCap className="h-8 w-8" />}
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">Thẩm định Hiện tại</span>
                  <div className="bg-white border border-slate-200 rounded-xl p-3 w-full text-left text-xs font-semibold text-slate-700 space-y-1">
                    <div className="text-[10px] text-slate-400">Tên hiển thị:</div>
                    <div className="font-bold text-blue-900 border-b border-slate-50 pb-1">{cfgName || 'Chưa nhập'}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Viết tắt:</div>
                    <div className="font-bold text-slate-800">{cfgShortName || 'Chưa nhập'}</div>
                  </div>
                </div>

                {/* Upload New Logo Widget */}
                <div className="bg-white border text-center border-slate-200 rounded-2xl p-5 space-y-3.5 relative">
                  <div className="h-10 w-10 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600 mx-auto border border-pink-100">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-800 uppercase">Tải tệp tin Logo mới</h5>
                    <p className="text-[10px] text-slate-400 leading-normal mt-0.5">Dành cho tập tin .png, .jpg hoặc .svg. Dung lượng cho phép tối đa 1.5MB.</p>
                  </div>
                  
                  <div className="relative border-2 border-dashed border-slate-200 hover:border-pink-500 rounded-2xl p-6 transition-all bg-slate-50/50 cursor-pointer">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleLogoUpload}
                      disabled={cfgLogoUploading}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <div className="text-xs text-slate-500 font-medium">Click chọn hoặc thả logo của bạn vào đây</div>
                  </div>

                  {cfgLogoUploading && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center backdrop-blur-xs font-bold text-slate-700 text-xs rounded-2xl">
                      <div className="flex items-center space-x-2 bg-slate-800 text-white px-3 py-1.5 rounded-lg">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Đang xử lý tải lên...</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

function LoaderIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" {...props}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}
