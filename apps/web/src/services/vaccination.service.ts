import { api } from '@/lib/api-client';
import type {
  VaccineCatalogItem,
  VaccinationScheduleResponse,
  VaccinationRecord,
  VaccinationCenter,
  VaccineAppointment,
  VaccinationPassport,
  VaccineCategory,
  VaccinationStatus,
  CenterType,
} from '@/types/vaccination';

export const vaccinationService = {
  /**
   * Get vaccine encyclopedia catalog with search and filters
   */
  async getDirectory(params?: {
    search?: string;
    category?: VaccineCategory | 'ALL';
    isMandatoryOnly?: boolean;
    isUipFreeOnly?: boolean;
  }): Promise<VaccineCatalogItem[]> {
    const res = await api.get('/vaccinations/directory', { params });
    return res.data?.data ?? res.data;
  },

  /**
   * Get details for single vaccine
   */
  async getVaccineDetails(vaccineId: string): Promise<VaccineCatalogItem> {
    const res = await api.get(`/vaccinations/directory/${vaccineId}`);
    return res.data?.data ?? res.data;
  },

  /**
   * Get family vaccination schedule & status summaries
   */
  async getSchedule(params?: {
    memberId?: string;
    status?: VaccinationStatus | 'ALL';
  }): Promise<VaccinationScheduleResponse> {
    const res = await api.get('/vaccinations/schedule', { params });
    return res.data?.data ?? res.data;
  },

  /**
   * Record an administered vaccine dose
   */
  async recordAdministered(payload: {
    vaccineId: string;
    memberId?: string;
    memberName?: string;
    doseNumber: number;
    administeredDate: string;
    administeredBy?: string;
    clinicOrCenterName?: string;
    centerLocation?: string;
    batchNumber?: string;
    brandName?: string;
    adverseReactions?: string;
    notes?: string;
    certificateUrl?: string;
  }): Promise<VaccinationRecord> {
    const res = await api.post('/vaccinations/record', payload);
    return res.data?.data ?? res.data;
  },

  /**
   * Update existing vaccination record
   */
  async updateRecord(
    recordId: string,
    payload: {
      status?: VaccinationStatus;
      administeredDate?: string;
      administeredBy?: string;
      clinicOrCenterName?: string;
      batchNumber?: string;
      brandName?: string;
      adverseReactions?: string;
      notes?: string;
      reminderEnabled?: boolean;
      reminderDaysBefore?: number[];
    },
  ): Promise<VaccinationRecord> {
    const res = await api.put(`/vaccinations/record/${recordId}`, payload);
    return res.data?.data ?? res.data;
  },

  /**
   * Add custom vaccine record
   */
  async addCustomVaccine(payload: {
    memberId?: string;
    memberName?: string;
    vaccineName: string;
    vaccineCode?: string;
    doseNumber: number;
    totalDoses: number;
    dueDate: string;
    status?: VaccinationStatus;
    administeredDate?: string;
    administeredBy?: string;
    clinicOrCenterName?: string;
    batchNumber?: string;
    notes?: string;
  }): Promise<VaccinationRecord> {
    const res = await api.post('/vaccinations/custom', payload);
    return res.data?.data ?? res.data;
  },

  /**
   * Delete vaccination record
   */
  async deleteRecord(recordId: string): Promise<{ success: boolean; message: string }> {
    const res = await api.delete(`/vaccinations/record/${recordId}`);
    return res.data?.data ?? res.data;
  },

  /**
   * Search nearby vaccination centers and hospitals
   */
  async findNearbyCenters(params: {
    latitude: number;
    longitude: number;
    radius?: number;
    type?: CenterType | 'ALL';
    isGovtFreeOnly?: boolean;
    vaccineQuery?: string;
    searchQuery?: string;
  }): Promise<VaccinationCenter[]> {
    const res = await api.get('/vaccinations/centers', { params });
    return res.data?.data ?? res.data;
  },

  /**
   * Book vaccination appointment slot
   */
  async bookAppointment(payload: {
    memberId?: string;
    memberName: string;
    vaccineId: string;
    vaccineName: string;
    doseNumber: number;
    centerId: string;
    appointmentDate: string;
    timeSlot: string;
    notes?: string;
  }): Promise<VaccineAppointment> {
    const res = await api.post('/vaccinations/appointment', payload);
    return res.data?.data ?? res.data;
  },

  /**
   * Get verifiable digital immunization passport
   */
  async getVaccinationPassport(memberId?: string): Promise<VaccinationPassport> {
    const res = await api.get('/vaccinations/passport', {
      params: { memberId },
    });
    return res.data?.data ?? res.data;
  },

  /**
   * Trigger reminder notification for a dose
   */
  async triggerReminder(payload: {
    recordId: string;
    customMessage?: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/vaccinations/reminders/trigger', payload);
    return res.data?.data ?? res.data;
  },
};
