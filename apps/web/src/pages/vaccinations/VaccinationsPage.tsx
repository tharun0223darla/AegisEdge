import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Syringe,
  ShieldCheck,
  MapPin,
  BookOpen,
  Calendar,
  Award,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Plus,
  Filter,
  Navigation,
  Phone,
  Building2,
  LocateFixed,
  RefreshCw,
  Bell,
  SlidersHorizontal,
  ChevronRight,
  ExternalLink,
  Info,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { vaccinationService } from '@/services/vaccination.service';
import type {
  VaccineCatalogItem,
  VaccinationScheduleResponse,
  VaccinationRecord,
  VaccinationCenter,
  VaccinationPassport,
  FamilyMemberProfile,
  VaccineCategory,
  VaccinationStatus,
  CenterType,
} from '@/types/vaccination';
import { VaccinationMap } from '@/components/vaccinations/VaccinationMap';
import { VaccineDetailModal } from '@/components/vaccinations/VaccineDetailModal';
import { VaccineRecordModal } from '@/components/vaccinations/VaccineRecordModal';
import { VaccinePassportModal } from '@/components/vaccinations/VaccinePassportModal';
import { VaccineAppointmentModal } from '@/components/vaccinations/VaccineAppointmentModal';
import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { staggerContainer, fadeUp } from '@/animations/variants';
import toast from 'react-hot-toast';

export default function VaccinationsPage() {
  // ── Active Navigation Tab ───────────────────────────────────
  const [activeTab, setActiveTab] = useState<'tracker' | 'directory' | 'locator' | 'passport'>('tracker');

  // ── Family Profile & Schedule States ────────────────────────
  const [scheduleData, setScheduleData] = useState<VaccinationScheduleResponse | null>(null);
  const [activeMemberId, setActiveMemberId] = useState<string>('mem-child');
  const [statusFilter, setStatusFilter] = useState<VaccinationStatus | 'ALL'>('ALL');
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(true);

  // ── Directory Catalog States ────────────────────────────────
  const [directory, setDirectory] = useState<VaccineCatalogItem[]>([]);
  const [dirSearch, setDirSearch] = useState<string>('');
  const [dirCategory, setDirCategory] = useState<VaccineCategory | 'ALL'>('ALL');
  const [dirMandatoryOnly, setDirMandatoryOnly] = useState<boolean>(false);
  const [dirUipOnly, setDirUipOnly] = useState<boolean>(false);
  const [dirLoading, setDirLoading] = useState<boolean>(false);

  // ── Locator States (Default to Bengaluru / Central coords) ───
  const [latitude, setLatitude] = useState<number>(12.9716);
  const [longitude, setLongitude] = useState<number>(77.5946);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationName, setLocationName] = useState<string>('Detecting location…');
  const [centers, setCenters] = useState<VaccinationCenter[]>([]);
  const [selectedCenter, setSelectedCenter] = useState<VaccinationCenter | null>(null);
  const [centerTypeFilter, setCenterTypeFilter] = useState<CenterType | 'ALL'>('ALL');
  const [centerGovtOnly, setCenterGovtOnly] = useState<boolean>(false);
  const [centerSearch, setCenterSearch] = useState<string>('');
  const [centerRadiusKm, setCenterRadiusKm] = useState<number>(25);
  const [centerViewMode, setCenterViewMode] = useState<'split' | 'map' | 'list'>('split');
  const [centersLoading, setCentersLoading] = useState<boolean>(false);

  // ── Passport State ──────────────────────────────────────────
  const [passportData, setPassportData] = useState<VaccinationPassport | null>(null);
  const [passportLoading, setPassportLoading] = useState<boolean>(false);

  // ── Modal States ────────────────────────────────────────────
  const [selectedVaccineDetail, setSelectedVaccineDetail] = useState<VaccineCatalogItem | null>(null);
  const [recordModalOpen, setRecordModalOpen] = useState<boolean>(false);
  const [activeRecordForEdit, setActiveRecordForEdit] = useState<VaccinationRecord | null>(null);
  const [activeVaccineForRecord, setActiveVaccineForRecord] = useState<VaccineCatalogItem | null>(null);
  const [passportModalOpen, setPassportModalOpen] = useState<boolean>(false);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState<boolean>(false);
  const [activeCenterForBooking, setActiveCenterForBooking] = useState<VaccinationCenter | null>(null);

  // ── 1. Fetch Schedule Data ──────────────────────────────────
  const fetchSchedule = async (memberId = activeMemberId, status = statusFilter) => {
    setScheduleLoading(true);
    try {
      const data = await vaccinationService.getSchedule({
        memberId: memberId === 'ALL' ? undefined : memberId,
        status: status === 'ALL' ? undefined : status,
      });
      setScheduleData(data);
      if (data.familyProfiles.length > 0 && !memberId) {
        setActiveMemberId(data.familyProfiles[0].id);
      }
    } catch (err) {
      console.error('Failed to load schedule', err);
      toast.error('Failed to load vaccination schedule');
    } finally {
      setScheduleLoading(false);
    }
  };

  // ── 2. Fetch Directory ──────────────────────────────────────
  const fetchDirectory = async () => {
    setDirLoading(true);
    try {
      const list = await vaccinationService.getDirectory({
        search: dirSearch,
        category: dirCategory,
        isMandatoryOnly: dirMandatoryOnly || undefined,
        isUipFreeOnly: dirUipOnly || undefined,
      });
      setDirectory(list);
    } catch (err) {
      console.error('Failed to load vaccine directory', err);
    } finally {
      setDirLoading(false);
    }
  };

  // ── 3. Detect User GPS Location ─────────────────────────────
  const detectLocation = () => {
    setIsLocating(true);
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      setIsLocating(false);
      setLocationName('Bengaluru (Default)');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        setIsLocating(false);
        setLocationName(`Current GPS (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
        toast.success('Location detected');
      },
      (err) => {
        setIsLocating(false);
        setLocationName('Bengaluru (Default)');
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  // ── 4. Fetch Nearby Centers ─────────────────────────────────
  const fetchCenters = async () => {
    setCentersLoading(true);
    try {
      const list = await vaccinationService.findNearbyCenters({
        latitude,
        longitude,
        radius: centerRadiusKm * 1000,
        type: centerTypeFilter,
        isGovtFreeOnly: centerGovtOnly || undefined,
        searchQuery: centerSearch,
      });
      setCenters(list);
      if (list.length > 0 && !selectedCenter) {
        setSelectedCenter(list[0]);
      }
    } catch (err) {
      console.error('Failed to fetch centers', err);
    } finally {
      setCentersLoading(false);
    }
  };

  // ── 5. Fetch Passport ───────────────────────────────────────
  const fetchPassport = async (memberId = activeMemberId) => {
    setPassportLoading(true);
    try {
      const data = await vaccinationService.getVaccinationPassport(memberId);
      setPassportData(data);
    } catch (err) {
      console.error('Failed to load passport', err);
    } finally {
      setPassportLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule(activeMemberId, statusFilter);
    fetchDirectory();
    detectLocation();
  }, []);

  useEffect(() => {
    fetchCenters();
  }, [latitude, longitude, centerTypeFilter, centerGovtOnly, centerRadiusKm]);

  useEffect(() => {
    if (activeTab === 'passport') {
      fetchPassport(activeMemberId);
    }
  }, [activeTab, activeMemberId]);

  // Active family member profile object
  const activeProfile = useMemo(() => {
    return scheduleData?.familyProfiles.find((p) => p.id === activeMemberId) || scheduleData?.familyProfiles[0];
  }, [scheduleData, activeMemberId]);

  // Handlers
  const handleMemberChange = (id: string) => {
    setActiveMemberId(id);
    fetchSchedule(id, statusFilter);
    if (activeTab === 'passport') {
      fetchPassport(id);
    }
  };

  const handleRecordSubmit = async (payload: any) => {
    if (activeRecordForEdit) {
      await vaccinationService.updateRecord(activeRecordForEdit.id, payload);
    } else {
      await vaccinationService.recordAdministered(payload);
    }
    fetchSchedule(activeMemberId, statusFilter);
    if (passportModalOpen || activeTab === 'passport') {
      fetchPassport(activeMemberId);
    }
  };

  const handleBookingSubmit = async (payload: any) => {
    const res = await vaccinationService.bookAppointment(payload);
    return res;
  };

  const handleTriggerReminder = async (recordId: string) => {
    try {
      await vaccinationService.triggerReminder({ recordId });
      toast.success('Vaccination alert reminder scheduled!');
    } catch {
      toast.error('Failed to trigger reminder');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Vaccination Passport & Management"
        description="Comprehensive immunization tracking, clinical directory, and nearby vaccination centers."
      />

      {/* Top Navigation Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-1 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('tracker')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
              activeTab === 'tracker'
                ? 'bg-brand-500 text-white shadow-glow'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Calendar className="w-4 h-4" /> Schedule & Tracker
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
              activeTab === 'directory'
                ? 'bg-brand-500 text-white shadow-glow'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <BookOpen className="w-4 h-4" /> Vaccine Encyclopedia
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('locator')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
              activeTab === 'locator'
                ? 'bg-brand-500 text-white shadow-glow'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <MapPin className="w-4 h-4" /> Find Nearby Centers
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('passport');
              fetchPassport(activeMemberId);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
              activeTab === 'passport'
                ? 'bg-brand-500 text-white shadow-glow'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Award className="w-4 h-4" /> Digital Passport
          </button>
        </div>

        {/* Quick Passport Modal Trigger */}
        <button
          type="button"
          onClick={() => {
            fetchPassport(activeMemberId);
            setPassportModalOpen(true);
          }}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-brand-500/30 bg-brand-500/10 text-xs font-bold text-brand-400 hover:bg-brand-500/20 transition"
        >
          <ShieldCheck className="w-3.5 h-3.5" /> View Official Certificate
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────
          TAB 1: IMMUNIZATION SCHEDULE & TRACKER
      ────────────────────────────────────────────────────────── */}
      {activeTab === 'tracker' && (
        <div className="space-y-6">
          {/* Family Profiles Switcher & Completion Banner */}
          <div className="rounded-3xl border border-border bg-gradient-to-r from-brand-950/30 via-surface to-surface p-6 shadow-xl">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              {/* Profile Chips */}
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Family Health Graph • Select Patient
                </span>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {scheduleData?.familyProfiles.map((p) => {
                    const isSelected = p.id === activeMemberId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleMemberChange(p.id)}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-2xl text-xs font-bold border transition-all ${
                          isSelected
                            ? 'bg-brand-500/15 border-brand-500 text-brand-400 shadow-md scale-105'
                            : 'bg-surface-elevated border-border text-text-secondary hover:border-brand-500/40 hover:text-text-primary'
                        }`}
                      >
                        <span className="h-6 w-6 rounded-full bg-brand-500/20 flex items-center justify-center text-[10px]">
                          {p.name.charAt(0)}
                        </span>
                        <span>{p.name}</span>
                        <span className="text-[10px] text-text-muted">({p.relationship})</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleMemberChange('ALL')}
                    className={`px-3 py-2 rounded-2xl text-xs font-bold border transition-all ${
                      activeMemberId === 'ALL'
                        ? 'bg-brand-500/15 border-brand-500 text-brand-400'
                        : 'bg-surface-elevated border-border text-text-secondary'
                    }`}
                  >
                    All Members
                  </button>
                </div>
              </div>

              {/* Progress Summary Metric */}
              <div className="flex items-center gap-6 bg-surface-elevated/70 border border-border p-4 rounded-2xl shrink-0 w-full lg:w-auto justify-between lg:justify-start">
                <div>
                  <span className="text-xs text-text-muted block font-medium">Immunization Progress</span>
                  <span className="text-2xl font-black text-brand-400">
                    {scheduleData?.summary.completionPercentage ?? 0}%
                  </span>
                  <span className="text-[11px] text-text-secondary block mt-0.5">
                    {scheduleData?.summary.completedCount ?? 0} of {scheduleData?.summary.totalScheduled ?? 0} doses completed
                  </span>
                </div>

                {/* Status Badges */}
                <div className="flex items-center gap-2 text-xs">
                  {scheduleData?.summary.dueSoonCount ? (
                    <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {scheduleData.summary.dueSoonCount} Due Soon
                    </span>
                  ) : null}
                  {scheduleData?.summary.overdueCount ? (
                    <span className="px-2.5 py-1 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {scheduleData.summary.overdueCount} Overdue
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Action Bar & Status Filter */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-text-muted flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" /> Filter Status:
              </span>
              {(['ALL', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'UPCOMING'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStatusFilter(st);
                    fetchSchedule(activeMemberId, st);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                    statusFilter === st
                      ? 'bg-brand-500/20 border-brand-500 text-brand-400'
                      : 'bg-surface border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveRecordForEdit(null);
                setActiveVaccineForRecord(null);
                setRecordModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition"
            >
              <Plus className="w-4 h-4" /> + Log Administered Vaccine
            </button>
          </div>

          {/* Schedule Records Timeline Cards */}
          {scheduleLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          ) : scheduleData?.records.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-12 text-center text-text-muted">
              <Syringe className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-semibold">No vaccination records matching this filter.</p>
            </div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {scheduleData?.records.map((record) => {
                const isDone = record.status === 'COMPLETED';
                const isDue = record.status === 'DUE_SOON';
                const isOverdue = record.status === 'OVERDUE';

                const catalogItem = directory.find((v) => v.id === record.vaccineId || v.code === record.vaccineCode);

                return (
                  <motion.div key={record.id} variants={fadeUp}>
                    <Card
                      interactive
                      className={`relative overflow-hidden transition-all border ${
                        isDone
                          ? 'border-emerald-500/30 bg-emerald-950/10'
                          : isDue
                            ? 'border-amber-500/40 bg-amber-950/10'
                            : isOverdue
                              ? 'border-rose-500/40 bg-rose-950/10'
                              : 'border-border bg-surface'
                      }`}
                    >
                      <CardContent className="p-5 space-y-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                                isDone
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                  : isDue
                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                                    : isOverdue
                                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                      : 'bg-brand-500/20 text-brand-400 border-brand-500/40'
                              }`}
                            >
                              <Syringe className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-text-primary leading-tight">
                                {record.vaccineName}
                              </h4>
                              <p className="text-[11px] text-text-secondary mt-0.5">
                                For <span className="font-semibold text-text-primary">{record.memberName}</span> • Dose {record.doseNumber} of {record.totalDoses}
                              </p>
                            </div>
                          </div>

                          {/* Status Pill */}
                          <span
                            className={`shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                              isDone
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                : isDue
                                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                  : isOverdue
                                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                    : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                            }`}
                          >
                            {record.status.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Administered / Due Dates Details */}
                        <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/60">
                          <div>
                            <span className="text-[10px] text-text-muted block">
                              {isDone ? 'Administered On' : 'Target Due Date'}
                            </span>
                            <span className="font-bold text-text-primary flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3 text-brand-400" />
                              {isDone ? record.administeredDate : record.dueDate}
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] text-text-muted block">
                              {isDone ? 'Clinic / Provider' : 'Recommended Location'}
                            </span>
                            <span className="font-semibold text-text-secondary truncate block mt-0.5">
                              {record.clinicOrCenterName || 'Primary Health Center'}
                            </span>
                          </div>
                        </div>

                        {/* Batch Number & Notes if any */}
                        {isDone && record.batchNumber && (
                          <div className="flex items-center justify-between text-[11px] text-text-muted bg-surface-elevated/60 px-2.5 py-1.5 rounded-xl font-mono">
                            <span>Batch: {record.batchNumber}</span>
                            {record.administeredBy && <span>By: {record.administeredBy}</span>}
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="pt-2 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (catalogItem) {
                                setSelectedVaccineDetail(catalogItem);
                              } else {
                                toast('Clinical details for custom vaccine.', { icon: 'ℹ️' });
                              }
                            }}
                            className="text-[11px] font-bold text-brand-400 hover:text-brand-300 flex items-center gap-1"
                          >
                            <Info className="w-3.5 h-3.5" /> Details
                          </button>

                          <div className="flex items-center gap-2">
                            {!isDone && (
                              <button
                                type="button"
                                onClick={() => handleTriggerReminder(record.id)}
                                className="p-1.5 rounded-lg border border-border text-text-muted hover:text-amber-400 hover:border-amber-500/40 transition"
                                title="Set/Trigger Dose Reminder"
                              >
                                <Bell className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {!isDone && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab('locator');
                                  setCenterSearch(record.vaccineCode);
                                }}
                                className="px-2.5 py-1 rounded-lg border border-border text-[11px] font-semibold text-text-secondary hover:bg-surface-hover transition"
                              >
                                Find PHC
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setActiveRecordForEdit(record);
                                setRecordModalOpen(true);
                              }}
                              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                                isDone
                                  ? 'border border-border text-text-secondary hover:bg-surface-hover'
                                  : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
                              }`}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {isDone ? 'Edit Record' : 'Mark Administered'}
                            </button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          TAB 2: VACCINE CLINICAL ENCYCLOPEDIA
      ────────────────────────────────────────────────────────── */}
      {activeTab === 'directory' && (
        <div className="space-y-6">
          {/* Search & Category Filter Bar */}
          <div className="rounded-3xl border border-border bg-surface p-6 space-y-4 shadow-xl">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search vaccines, diseases, codes (e.g. MMR, HPV, BCG)..."
                  value={dirSearch}
                  onChange={(e) => {
                    setDirSearch(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchDirectory();
                  }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-border bg-surface-elevated text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={dirUipOnly}
                    onChange={(e) => {
                      setDirUipOnly(e.target.checked);
                    }}
                    className="rounded border-border text-brand-500"
                  />
                  Govt Free UIP Only
                </label>

                <button
                  type="button"
                  onClick={fetchDirectory}
                  className="px-4 py-2.5 rounded-xl bg-brand-500 text-xs font-bold text-white shadow-glow hover:bg-brand-600 transition"
                >
                  Search
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-border/60">
              {(
                [
                  { key: 'ALL', label: 'All Categories' },
                  { key: 'INFANT', label: 'Infant (0-12m)' },
                  { key: 'CHILD', label: 'Child (1-6y)' },
                  { key: 'ADOLESCENT', label: 'Adolescent (7-18y)' },
                  { key: 'ADULT', label: 'Adults (19-49y)' },
                  { key: 'SENIOR', label: 'Seniors (50+)' },
                  { key: 'SPECIAL_TRAVEL', label: 'Travel & High Risk' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => {
                    setDirCategory(cat.key);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition ${
                    dirCategory === cat.key
                      ? 'bg-brand-500/20 border border-brand-500 text-brand-400 font-bold'
                      : 'bg-surface-elevated border border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Directory Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {directory
              .filter((v) => (dirCategory === 'ALL' ? true : v.category === dirCategory))
              .filter((v) => (dirUipOnly ? v.isUipGovernmentFree : true))
              .filter((v) => {
                if (!dirSearch.trim()) return true;
                const q = dirSearch.toLowerCase().trim();
                return (
                  v.name.toLowerCase().includes(q) ||
                  v.code.toLowerCase().includes(q) ||
                  v.diseasePrevented.some((d) => d.toLowerCase().includes(q))
                );
              })
              .map((vac) => (
                <Card
                  key={vac.id}
                  interactive
                  onClick={() => setSelectedVaccineDetail(vac)}
                  className="hover:border-brand-500/40 transition-all flex flex-col justify-between"
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 shrink-0">
                          <Syringe className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-xs text-text-primary leading-tight">
                            {vac.name}
                          </h4>
                          <span className="text-[10px] font-mono text-brand-400 font-bold">
                            {vac.code}
                          </span>
                        </div>
                      </div>

                      {vac.isUipGovernmentFree ? (
                        <span className="shrink-0 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                          Free UIP
                        </span>
                      ) : (
                        <span className="shrink-0 bg-surface-elevated border border-border text-text-muted text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                          Private
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-text-secondary line-clamp-2">
                      {vac.shortDescription}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      {vac.diseasePrevented.slice(0, 2).map((d, i) => (
                        <span
                          key={i}
                          className="bg-brand-500/10 text-brand-300 text-[10px] px-2 py-0.5 rounded-md font-medium"
                        >
                          {d}
                        </span>
                      ))}
                      {vac.diseasePrevented.length > 2 && (
                        <span className="text-[10px] text-text-muted">
                          +{vac.diseasePrevented.length - 2} more
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
                      <span>{vac.targetAgeDescription}</span>
                      <span className="text-brand-400 font-bold flex items-center gap-0.5">
                        Read Guide <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          TAB 3: FIND NEARBY VACCINATION CENTERS & HOSPITALS
      ────────────────────────────────────────────────────────── */}
      {activeTab === 'locator' && (
        <div className="space-y-6">
          {/* Geolocation & Filter Header */}
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                  <MapPin className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text-primary">
                    Find Immunization Centers & PHCs
                  </h3>
                  <p className="text-xs text-text-secondary flex items-center gap-1.5 mt-0.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {locationName}
                  </p>
                </div>
              </div>

              {/* Live Geolocation Button */}
              <button
                type="button"
                onClick={detectLocation}
                disabled={isLocating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-500/10 border border-brand-500/30 text-xs font-bold text-brand-400 hover:bg-brand-500/20 transition"
              >
                <LocateFixed className="w-4 h-4" />
                {isLocating ? 'Detecting GPS...' : 'Use My GPS'}
              </button>
            </div>

            {/* Filters Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-3 border-t border-border">
              <div>
                <label className="text-[11px] font-bold text-text-muted block mb-1">Center Type</label>
                <select
                  value={centerTypeFilter}
                  onChange={(e) => setCenterTypeFilter(e.target.value as any)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                >
                  <option value="ALL">All Types</option>
                  <option value="GOVERNMENT_PHC">Government PHCs (Free)</option>
                  <option value="PEDIATRIC_CLINIC">Pediatric Clinics</option>
                  <option value="PRIVATE_HOSPITAL">Private Hospitals</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-muted block mb-1">Search Vaccine or Center</label>
                <input
                  type="text"
                  placeholder="e.g. MMR, Rainbow, BBMP"
                  value={centerSearch}
                  onChange={(e) => setCenterSearch(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-muted block mb-1">Search Radius</label>
                <select
                  value={centerRadiusKm}
                  onChange={(e) => setCenterRadiusKm(parseInt(e.target.value))}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                >
                  <option value={10}>Within 10 km</option>
                  <option value={25}>Within 25 km</option>
                  <option value={50}>Within 50 km</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={fetchCenters}
                  className="w-full py-2 rounded-xl bg-brand-500 text-xs font-bold text-white shadow-glow hover:bg-brand-600 transition flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${centersLoading ? 'animate-spin' : ''}`} /> Refresh Centers
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Map & Center Cards Split Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Map View */}
            <div className="lg:col-span-7">
              <VaccinationMap
                userLocation={[latitude, longitude]}
                centers={centers}
                selectedCenter={selectedCenter}
                onSelectCenter={(c) => setSelectedCenter(c)}
                onBookCenter={(c) => {
                  setActiveCenterForBooking(c);
                  setAppointmentModalOpen(true);
                }}
                radiusMeters={centerRadiusKm * 1000}
              />
            </div>

            {/* Centers List View */}
            <div className="lg:col-span-5 space-y-3.5 max-h-[520px] overflow-y-auto pr-1">
              <span className="text-xs font-bold uppercase tracking-wider text-text-muted block">
                {centers.length} Vaccination Facilities Found
              </span>

              {centersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-28 rounded-2xl" />
                  ))}
                </div>
              ) : (
                centers.map((c) => {
                  const isSelected = selectedCenter?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCenter(c)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-brand-500 bg-brand-500/10 shadow-lg'
                          : 'border-border bg-surface hover:border-brand-500/40 hover:bg-surface-elevated'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-xs text-text-primary leading-tight">
                            {c.name}
                          </h4>
                          <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-1">
                            {c.address}
                          </p>
                        </div>
                        {c.isGovtFreeUip ? (
                          <span className="shrink-0 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                            Govt Free
                          </span>
                        ) : (
                          <span className="shrink-0 bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                            Private
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between text-xs text-text-muted">
                        <span className="font-bold text-brand-400 flex items-center gap-1">
                          <Navigation className="w-3.5 h-3.5" /> {c.distanceText || `${c.distanceKm} km`}
                        </span>
                        <span>⭐ {c.rating.toFixed(1)} ({c.reviewsCount})</span>
                      </div>

                      <div className="mt-3 pt-2 border-t border-border flex items-center gap-2">
                        <a
                          href={c.directionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary transition"
                        >
                          <Navigation className="w-3 h-3 text-brand-400" /> Directions
                        </a>

                        <a
                          href={`tel:${c.contactPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-semibold text-text-secondary hover:text-text-primary transition"
                        >
                          <Phone className="w-3 h-3" />
                        </a>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCenterForBooking(c);
                            setAppointmentModalOpen(true);
                          }}
                          className="flex-1 rounded-xl bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-glow hover:bg-brand-500 transition"
                        >
                          Book Slot
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          TAB 4: DIGITAL IMMUNIZATION PASSPORT EMBED
      ────────────────────────────────────────────────────────── */}
      {activeTab === 'passport' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border">
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  Verifiable Digital Immunization Passport
                </h3>
                <p className="text-xs text-text-secondary">
                  Digitally signed proof of immunization record for school admissions, international travel, and routine health checks.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPassportModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition flex items-center gap-1.5"
              >
                <Award className="w-4 h-4" /> Open Fullscreen Certificate
              </button>
            </div>

            {passportLoading ? (
              <div className="p-8 text-center">
                <Skeleton className="h-64 rounded-2xl w-full" />
              </div>
            ) : passportData ? (
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl border border-border bg-surface-elevated text-xs">
                  <div>
                    <span className="text-text-muted block text-[11px]">Patient Name</span>
                    <span className="font-bold text-text-primary text-sm">
                      {passportData.patient.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted block text-[11px]">Date of Birth</span>
                    <span className="font-bold text-text-primary">
                      {passportData.patient.dateOfBirth} ({passportData.patient.ageYears}y)
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted block text-[11px]">Passport Number</span>
                    <span className="font-mono text-brand-400 font-bold">
                      {passportData.passportNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted block text-[11px]">Completion Rate</span>
                    <span className="font-black text-emerald-400">
                      {passportData.summary.completionPercentage}% Complete
                    </span>
                  </div>
                </div>

                {/* Table */}
                <div className="rounded-2xl border border-border overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-surface-elevated text-text-muted font-bold uppercase text-[10px]">
                        <th className="py-3 px-4">Vaccine</th>
                        <th className="py-3 px-3">Dose Sequence</th>
                        <th className="py-3 px-3">Date Given</th>
                        <th className="py-3 px-3">Administering Center</th>
                        <th className="py-3 px-3 text-right">Verification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {passportData.immunizationHistory.map((item, idx) => (
                        <tr key={idx} className="hover:bg-surface-elevated/40 transition">
                          <td className="py-3 px-4 font-bold text-text-primary">
                            {item.vaccineName}
                          </td>
                          <td className="py-3 px-3 text-text-secondary">
                            Dose {item.doseNumber} of {item.totalDoses}
                          </td>
                          <td className="py-3 px-3 text-text-primary font-medium">
                            {item.administeredDate}
                          </td>
                          <td className="py-3 px-3 text-text-secondary">
                            {item.centerName || 'Primary Health Center'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          MODALS
      ────────────────────────────────────────────────────────── */}

      {/* 1. Vaccine Detail Modal */}
      <VaccineDetailModal
        vaccine={selectedVaccineDetail}
        isOpen={!!selectedVaccineDetail}
        onClose={() => setSelectedVaccineDetail(null)}
        onRecordAdministered={(v) => {
          setActiveRecordForEdit(null);
          setActiveVaccineForRecord(v);
          setRecordModalOpen(true);
        }}
        onFindCenters={(v) => {
          setActiveTab('locator');
          setCenterSearch(v.code);
        }}
      />

      {/* 2. Vaccine Record Modal */}
      <VaccineRecordModal
        vaccine={activeVaccineForRecord}
        record={activeRecordForEdit}
        familyProfiles={scheduleData?.familyProfiles || []}
        activeMemberId={activeMemberId}
        isOpen={recordModalOpen}
        onClose={() => {
          setRecordModalOpen(false);
          setActiveRecordForEdit(null);
          setActiveVaccineForRecord(null);
        }}
        onSubmit={handleRecordSubmit}
      />

      {/* 3. Official Verifiable Digital Passport Modal */}
      <VaccinePassportModal
        passport={passportData}
        isOpen={passportModalOpen}
        onClose={() => setPassportModalOpen(false)}
      />

      {/* 4. Vaccine Appointment Booking Modal */}
      <VaccineAppointmentModal
        center={activeCenterForBooking}
        vaccine={null}
        familyProfiles={scheduleData?.familyProfiles || []}
        activeMemberId={activeMemberId}
        isOpen={appointmentModalOpen}
        onClose={() => {
          setAppointmentModalOpen(false);
          setActiveCenterForBooking(null);
        }}
        onSubmit={handleBookingSubmit}
      />
    </div>
  );
}
