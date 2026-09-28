import {
  isInjectionOnlyClinicalContent,
  isNonHumanClinicalContent,
  isTrustedClinicalSourceRef,
  isUnsafeClinicalSourceRef,
} from './enrichment/trusted-clinical-sources';

type SourceRefs = Record<string, unknown>;

const CLINICAL_FIELDS = [
  'uses',
  'howToTake',
  'whenToTake',
  'sideEffects',
  'warnings',
  'substitutes',
  'storage',
] as const;

type ClinicalField = (typeof CLINICAL_FIELDS)[number];
const ENRICHMENT_STATUS_FIELDS: ClinicalField[] = [
  'uses',
  'howToTake',
  'sideEffects',
  'warnings',
  'storage',
];

const PATIENT_EXPLANATION_FIELDS = [
  'whyPrescribed',
  'howToTake',
  'sideEffects',
  'warnings',
  'storage',
] as const;

type PatientExplanationField = (typeof PATIENT_EXPLANATION_FIELDS)[number];

export class MedicineResponseSerializer {
  mapMedicine(medicine: any) {
    if (!medicine) return medicine;

    const { medicineMaster, medicinePackage, ...rawBase } = medicine;
    const base = rawBase as unknown as Record<string, unknown>;
    const dosageForm = typeof base.form === 'string' ? base.form : undefined;
    const privateStrip = medicine as unknown as {
      userStripImageUrl?: unknown;
      userStripOcrText?: unknown;
    };
    delete base.userStripOcrText;
    const master = medicineMaster
      ? this.mapMaster(medicineMaster, dosageForm)
      : null;
    const pack = medicinePackage
      ? this.mapPackage(medicinePackage)
      : (master?.packages?.[0] ?? null);

    return {
      ...base,
      stockQuantity: medicine.remainingQuantity ?? 0,
      stripReferenceReady:
        typeof privateStrip.userStripImageUrl === 'string' &&
        typeof privateStrip.userStripOcrText === 'string' &&
        privateStrip.userStripImageUrl.length > 0 &&
        privateStrip.userStripOcrText.length > 0,
      master,
      package: pack,
      enrichment: this.buildEnrichment(medicine, medicineMaster, pack),
    };
  }

  mapMaster(master: any, dosageForm?: string | null) {
    if (!master) return null;
    const masterRecord = master as unknown as Record<string, unknown>;
    const masterDosageForm =
      dosageForm ??
      (typeof masterRecord.type === 'string' ? masterRecord.type : undefined);

    const packages = (master.packages ?? [])
      .filter((pack: any) => !pack.isDemo)
      .map((pack: any) => this.mapPackage(pack));

    return {
      id: master.id,
      brandName: master.brandName,
      genericName: master.genericName,
      composition: master.composition,
      salts: master.salts,
      category: master.category,
      manufacturer: master.manufacturer,
      strength: master.strength,
      type: master.type,
      isDiscontinued: master.isDiscontinued,
      prescriptionRequired: master.prescriptionRequired,
      saltProfileId: master.saltProfileId,
      saltProfile: this.mapSaltProfile(master.saltProfile, masterDosageForm),
      packages,
    };
  }

  mapSaltProfile(profile: any, dosageForm?: string | null) {
    if (!profile) return null;
    const profileRecord = profile as unknown as Record<string, unknown>;
    const sourceRefs = (profile.sourceRefs ?? {}) as SourceRefs;
    const uses = this.safeClinicalValue(
      profile,
      sourceRefs,
      'uses',
      dosageForm,
    );
    const howToTake = this.safeClinicalValue(
      profile,
      sourceRefs,
      'howToTake',
      dosageForm,
    );
    const whenToTake = this.safeClinicalValue(
      profile,
      sourceRefs,
      'whenToTake',
    );
    const sideEffects = this.safeClinicalValue(
      profile,
      sourceRefs,
      'sideEffects',
    );
    const warnings = this.safeClinicalValue(profile, sourceRefs, 'warnings');
    const substitutes = this.safeClinicalValue(
      profile,
      sourceRefs,
      'substitutes',
    );
    const storage = this.safeClinicalValue(profile, sourceRefs, 'storage');

    return {
      id: profile.id,
      saltKey: profile.saltKey,
      displayName: profile.displayName,
      ingredients: profile.ingredients ?? [],
      uses,
      howToTake,
      whenToTake,
      sideEffects,
      warnings,
      substitutes,
      storage,
      sourceRefs,
      enrichmentStatus: this.safeEnrichmentStatus(sourceRefs),
      patientExplanations: this.mapPatientExplanations(
        Array.isArray(profileRecord.patientExplanations)
          ? profileRecord.patientExplanations
          : [],
        dosageForm,
      ),
      isVerified: profile.isVerified,
      language: profile.language,
    };
  }

  private mapPatientExplanations(
    explanations: any[] = [],
    dosageForm?: string | null,
  ) {
    return explanations
      .map((explanation) => this.mapPatientExplanation(explanation, dosageForm))
      .filter(Boolean);
  }

  private mapPatientExplanation(explanation: any, dosageForm?: string | null) {
    if (!explanation) return null;
    const sourceRefs = (explanation.sourceRefs ?? {}) as SourceRefs;
    const unsafeFields = new Set<string>(
      Array.isArray(explanation.unsafeOmittedFields)
        ? explanation.unsafeOmittedFields.filter(
            (field: unknown) => typeof field === 'string',
          )
        : [],
    );
    const safeValue = (field: PatientExplanationField) => {
      const value = explanation?.[field] ?? null;

      if (this.isEmpty(value)) {
        return field === 'sideEffects' ? [] : null;
      }

      if (
        this.hasSourceForPatientField(sourceRefs, field) &&
        this.isSafeClinicalContent(value, dosageForm)
      ) {
        return value;
      }

      unsafeFields.add(field);
      return field === 'sideEffects' ? [] : null;
    };

    const whyPrescribed = safeValue('whyPrescribed');
    const howToTake = safeValue('howToTake');
    const sideEffects = safeValue('sideEffects');
    const warnings = safeValue('warnings');
    const storage = safeValue('storage');
    const hasSafeText = [whyPrescribed, howToTake, warnings, storage].some(
      (value) => !this.isEmpty(value),
    );
    const hasSafeList = Array.isArray(sideEffects) && sideEffects.length > 0;

    return {
      id: explanation.id,
      language: explanation.language ?? 'en',
      status:
        hasSafeText || hasSafeList
          ? (explanation.status ?? 'GENERATED')
          : 'NEEDS_SOURCE',
      whyPrescribed,
      howToTake,
      sideEffects,
      warnings,
      storage,
      sourceRefs,
      unsafeOmittedFields: Array.from(unsafeFields),
      generatedBy: explanation.generatedBy ?? null,
      modelVersion: explanation.modelVersion ?? null,
      reviewedAt: explanation.reviewedAt ?? null,
      updatedAt: explanation.updatedAt ?? null,
      disclaimer:
        'Patient-friendly wording is for education only. Follow your doctor or pharmacist instructions.',
    };
  }

  mapPackage(pack: any) {
    if (!pack || pack.isDemo) return null;

    return {
      id: pack.id,
      medicineId: pack.medicineId,
      gtin: pack.gtin,
      barcodeType: pack.barcodeType,
      packSize: pack.packSize,
      stripImageUrl: pack.stripImageUrl,
      pillImageUrl: pack.pillImageUrl,
      mrpPrice: pack.mrpPrice?.toString?.() ?? pack.mrpPrice ?? null,
      priceCurrency: pack.priceCurrency,
      priceSource: pack.priceSource,
      priceLastSeenAt: pack.priceLastSeenAt,
      isVerified: pack.isVerified,
      verifiedAt: pack.verifiedAt,
    };
  }

  private buildEnrichment(medicine: any, master: any, pack: any) {
    const profile = master?.saltProfile;
    const sourceRefs = (profile?.sourceRefs ?? {}) as SourceRefs;
    const unsafeFields: string[] = [];
    const medicineRecord = medicine as unknown as Record<string, unknown>;
    const masterRecord = master as unknown as Record<string, unknown> | null;
    const dosageForm =
      typeof medicineRecord.form === 'string'
        ? medicineRecord.form
        : typeof masterRecord?.type === 'string'
          ? masterRecord.type
          : undefined;

    const safeValue = (field: ClinicalField) => {
      const value = profile?.[field] ?? null;

      if (this.isEmpty(value)) {
        return field === 'sideEffects' || field === 'substitutes' ? [] : null;
      }

      if (
        this.hasSourceForField(sourceRefs, field) &&
        this.isSafeClinicalContent(value, dosageForm)
      ) {
        return value;
      }

      unsafeFields.push(field);
      return field === 'sideEffects' || field === 'substitutes' ? [] : null;
    };

    const uses = safeValue('uses');
    const howToTake = safeValue('howToTake');
    const whenToTake = safeValue('whenToTake');
    const sideEffects = safeValue('sideEffects');
    const warnings = safeValue('warnings');
    const substitutes = safeValue('substitutes');
    const storage = safeValue('storage');
    const patientExplanation = this.preferredPatientExplanation(
      profile,
      'en',
      dosageForm,
    );
    const safeClinicalFields = [
      uses,
      howToTake,
      whenToTake,
      warnings,
      storage,
    ].filter((value) => !this.isEmpty(value)).length;
    const hasSafeLists =
      (Array.isArray(sideEffects) && sideEffects.length > 0) ||
      (Array.isArray(substitutes) && substitutes.length > 0);
    const hasAnySafeClinicalData = safeClinicalFields > 0 || hasSafeLists;
    const status = hasAnySafeClinicalData ? 'AVAILABLE' : 'NEEDS_SOURCE';
    const enrichmentStatus =
      unsafeFields.length > 0
        ? 'NEEDS_SOURCE'
        : (profile?.enrichmentStatus ?? 'NEEDS_SOURCE');

    return {
      status,
      enrichmentStatus,
      saltProfileId: profile?.id ?? null,
      composition:
        profile?.displayName ??
        master?.composition ??
        medicine.genericName ??
        medicine.name,
      uses,
      howToTake,
      whenToTake,
      sideEffects,
      warnings,
      substitutes,
      storage,
      patientExplanation,
      stripImageUrl: pack?.stripImageUrl ?? null,
      pillImageUrl: pack?.pillImageUrl ?? null,
      sourceRefs,
      unsafeOmittedFields: unsafeFields,
      disclaimer:
        'Information is for education only and is not medical advice. Follow your doctor or pharmacist instructions.',
    };
  }

  private preferredPatientExplanation(
    profile: any,
    language = 'en',
    dosageForm?: string | null,
  ) {
    const explanations = this.mapPatientExplanations(
      profile?.patientExplanations ?? [],
      dosageForm,
    );
    const preferred = explanations.find(
      (explanation: any) =>
        explanation.language === language &&
        this.hasAnyPatientExplanationText(explanation),
    );

    return (
      preferred ??
      explanations.find((explanation: any) =>
        this.hasAnyPatientExplanationText(explanation),
      ) ??
      null
    );
  }

  private hasAnyPatientExplanationText(explanation: any) {
    return Boolean(
      explanation?.whyPrescribed ||
      explanation?.howToTake ||
      explanation?.warnings ||
      explanation?.storage ||
      explanation?.sideEffects?.length,
    );
  }

  private hasSourceForPatientField(
    sourceRefs: SourceRefs,
    field: PatientExplanationField,
  ) {
    const value = sourceRefs?.[field];
    const refs = Array.isArray(value) ? value : value ? [value] : [];

    return (
      refs.length > 0 &&
      !refs.some((ref) => isUnsafeClinicalSourceRef(ref)) &&
      refs.some((ref) => this.isTrustedClinicalSource(ref))
    );
  }

  private hasSourceForField(sourceRefs: SourceRefs, field: ClinicalField) {
    const value = sourceRefs?.[field];
    const refs = Array.isArray(value) ? value : value ? [value] : [];

    return (
      refs.length > 0 &&
      !refs.some((ref) => isUnsafeClinicalSourceRef(ref)) &&
      refs.some((ref) => this.isTrustedClinicalSource(ref))
    );
  }

  private safeClinicalValue(
    profile: any,
    sourceRefs: SourceRefs,
    field: ClinicalField,
    dosageForm?: string | null,
  ) {
    const value = profile?.[field] ?? null;

    if (
      this.isEmpty(value) ||
      !this.hasSourceForField(sourceRefs, field) ||
      !this.isSafeClinicalContent(value, dosageForm)
    ) {
      return field === 'sideEffects' || field === 'substitutes' ? [] : null;
    }

    return value;
  }

  private isSafeClinicalContent(value: unknown, dosageForm?: string | null) {
    if (isNonHumanClinicalContent(value)) return false;
    const isInjection = /inject|infusion|intravenous|intramuscular/i.test(
      String(dosageForm ?? ''),
    );
    return isInjection || !isInjectionOnlyClinicalContent(value);
  }

  private safeEnrichmentStatus(sourceRefs: SourceRefs) {
    const sourcedCount = ENRICHMENT_STATUS_FIELDS.filter((field) =>
      this.hasSourceForField(sourceRefs, field),
    ).length;

    if (sourcedCount === ENRICHMENT_STATUS_FIELDS.length) return 'COMPLETE';
    if (sourcedCount > 0) return 'PARTIAL';
    return 'NEEDS_SOURCE';
  }

  private isTrustedClinicalSource(value: unknown) {
    return isTrustedClinicalSourceRef(value);
  }

  private isEmpty(value: unknown) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
  }
}
