import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isTrustedClinicalSourceRef } from '../enrichment/trusted-clinical-sources';

type PatientExplanationField = 'whyPrescribed' | 'howToTake' | 'sideEffects' | 'warnings' | 'storage';
type SourceRefs = Record<string, unknown>;

interface PatientExplanationFields {
  whyPrescribed?: string;
  howToTake?: string;
  sideEffects?: string[];
  warnings?: string;
  storage?: string;
  sourceRefs: SourceRefs;
  unsafeOmittedFields: string[];
}

const TEXT_FIELD_LIMIT = 1100;
const LIST_LIMIT = 8;

@Injectable()
export class PatientExplanationService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForSaltProfile(
    id: string,
    options?: { dryRun?: boolean; language?: string },
  ) {
    const language = options?.language ?? 'en';
    const profile = await this.prisma.saltProfile.findUnique({ where: { id } });

    if (!profile) {
      throw new NotFoundException('Salt profile not found');
    }

    const fields = this.generateFields(profile);
    const hasContent = this.hasAnyContent(fields);
    const status = hasContent ? 'GENERATED' : 'NEEDS_SOURCE';

    if (!options?.dryRun) {
      await this.prisma.patientExplanation.upsert({
        where: { saltProfileId_language: { saltProfileId: profile.id, language } },
        create: {
          saltProfileId: profile.id,
          language,
          whyPrescribed: fields.whyPrescribed ?? null,
          howToTake: fields.howToTake ?? null,
          sideEffects: fields.sideEffects ?? [],
          warnings: fields.warnings ?? null,
          storage: fields.storage ?? null,
          sourceRefs: fields.sourceRefs as any,
          unsafeOmittedFields: fields.unsafeOmittedFields as any,
          status,
          generatedBy: 'rule-based-patient-simplifier',
          modelVersion: 'patient-explanation-rules-v1',
        },
        update: {
          whyPrescribed: fields.whyPrescribed ?? null,
          howToTake: fields.howToTake ?? null,
          sideEffects: fields.sideEffects ?? [],
          warnings: fields.warnings ?? null,
          storage: fields.storage ?? null,
          sourceRefs: fields.sourceRefs as any,
          unsafeOmittedFields: fields.unsafeOmittedFields as any,
          status,
          generatedBy: 'rule-based-patient-simplifier',
          modelVersion: 'patient-explanation-rules-v1',
        },
      });
    }

    return {
      saltProfileId: profile.id,
      saltKey: profile.saltKey,
      displayName: profile.displayName,
      language,
      status,
      fields,
      dryRun: Boolean(options?.dryRun),
    };
  }

  async generateNext(options?: { limit?: number; dryRun?: boolean; language?: string }) {
    const language = options?.language ?? 'en';
    const limit = Math.max(1, Math.min(options?.limit ?? 10, 500));
    const profiles = await this.prisma.saltProfile.findMany({
      where: {
        enrichmentStatus: { in: ['PARTIAL', 'COMPLETE'] },
        OR: [
          { patientExplanations: { none: { language } } },
          { patientExplanations: { some: { language, status: 'NEEDS_SOURCE' } } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });

    const results: any[] = [];
    for (const profile of profiles) {
      results.push(
        await this.generateForSaltProfile(profile.id, {
          dryRun: options?.dryRun,
          language,
        }),
      );
    }

    return results;
  }

  generateFields(profile: any): PatientExplanationFields {
    const clinicalRefs = (profile.sourceRefs ?? {}) as SourceRefs;
    const sourceRefs: SourceRefs = {};
    const unsafeOmittedFields: string[] = [];
    const fields: PatientExplanationFields = { sourceRefs, unsafeOmittedFields };

    if (this.hasTrustedFieldSource(clinicalRefs, 'uses') && !this.isEmpty(profile.uses)) {
      fields.whyPrescribed = this.simplifyUses(profile.displayName, String(profile.uses));
      sourceRefs.whyPrescribed = clinicalRefs.uses;
    } else if (!this.isEmpty(profile.uses)) {
      unsafeOmittedFields.push('whyPrescribed');
    }

    if (this.hasTrustedFieldSource(clinicalRefs, 'howToTake') && !this.isEmpty(profile.howToTake)) {
      fields.howToTake = this.simplifyHowToTake(String(profile.howToTake));
      sourceRefs.howToTake = clinicalRefs.howToTake;
    } else if (!this.isEmpty(profile.howToTake)) {
      unsafeOmittedFields.push('howToTake');
    }

    if (this.hasTrustedFieldSource(clinicalRefs, 'warnings') && !this.isEmpty(profile.warnings)) {
      fields.warnings = this.simplifyWarnings(String(profile.warnings));
      sourceRefs.warnings = clinicalRefs.warnings;
    } else if (!this.isEmpty(profile.warnings)) {
      unsafeOmittedFields.push('warnings');
    }

    if (this.hasTrustedFieldSource(clinicalRefs, 'sideEffects') && !this.isEmpty(profile.sideEffects)) {
      fields.sideEffects = this.simplifySideEffects(profile.sideEffects);
      sourceRefs.sideEffects = clinicalRefs.sideEffects;
    } else if (!this.isEmpty(profile.sideEffects)) {
      unsafeOmittedFields.push('sideEffects');
    }

    if (this.hasTrustedFieldSource(clinicalRefs, 'storage') && !this.isEmpty(profile.storage)) {
      fields.storage = this.simplifyStorage(String(profile.storage));
      sourceRefs.storage = clinicalRefs.storage;
    } else if (!this.isEmpty(profile.storage)) {
      unsafeOmittedFields.push('storage');
    }

    return fields;
  }

  private simplifyUses(displayName: string, sourceText: string) {
    const name = this.plainMedicineName(displayName);
    const normalized = sourceText.toLowerCase();
    const uses: string[] = [];

    if (/renal\s+homotransplantation|kidney\s+transplant|renal\s+transplant/.test(normalized)) {
      uses.push('after a kidney transplant to help prevent the body from rejecting the transplanted kidney');
    }

    if (/rheumatoid\s+arthritis|\bra\b/.test(normalized)) {
      uses.push('for active rheumatoid arthritis to help reduce symptoms');
    }

    if (uses.length) {
      return this.limitText(`${name} may be prescribed ${uses.join(' or ')}.`);
    }

    const sentence = this.firstUsefulSentence(sourceText);
    return this.limitText(`${name} may be prescribed for: ${this.simplifyMedicalTerms(sentence)}`);
  }

  private simplifyHowToTake(sourceText: string) {
    const conditionAwareSummary = this.conditionAwareHowToTakeSummary(sourceText);
    if (conditionAwareSummary) {
      return this.limitText(conditionAwareSummary);
    }

    const selectedSentences = this.sourceSummarySentences(sourceText, [
      /dose|required|recommended|administer|given|take|daily|schedule|maintenance|increase|reduce|discontinu/i,
      /food|meal|water|empty stomach|with meals|before meals|after meals/i,
      /toxicity|serious side effects|renal|kidney|liver|deficiency|monitor/i,
    ]);
    const sourceSummary = selectedSentences.length
      ? selectedSentences.map((sentence) => this.simplifyMedicalTerms(sentence)).join(' ')
      : this.simplifyMedicalTerms(this.firstUsefulSentence(sourceText));

    return this.limitText(
      `Source summary: ${sourceSummary} Use your doctor's prescription for your exact dose and schedule.`,
    );
  }

  private conditionAwareHowToTakeSummary(sourceText: string) {
    const cleaned = this.cleanSourceText(sourceText);
    const normalized = cleaned.toLowerCase();
    const parts: string[] = [];

    if (/vary with individual patients|careful management|dose required/.test(normalized)) {
      parts.push('Dose depends on the condition being treated and the individual patient.');
    }

    const transplantSection = this.sectionText(cleaned, 'Renal Homotransplantation', [
      'Rheumatoid Arthritis',
      'Patients with TPMT',
      'Homozygous',
      'Heterozygous',
      'Use in Renal',
    ]);
    const transplantInitial = this.matchPhrase(
      transplantSection,
      /initial dose is usually ([^.;]+?daily)/i,
    );
    const transplantTiming = this.matchPhrase(
      transplantSection,
      /beginning at ([^.;]+?transplant(?:ation)?)/i,
    );
    const transplantMaintenance = this.matchPhrase(
      transplantSection,
      /maintenance levels of ([^.;]+?daily)/i,
    );
    const transplantFacts = [
      transplantInitial ? `an initial dose of ${transplantInitial}` : null,
      transplantTiming ? `starting at ${transplantTiming}` : null,
      transplantMaintenance ? `maintenance levels of ${transplantMaintenance}` : null,
    ];

    if (transplantFacts.some(Boolean)) {
      parts.push(
        `For kidney transplant, the source lists ${this.joinFacts(transplantFacts)}.`,
      );
    }

    const arthritisSection = this.sectionText(cleaned, 'Rheumatoid Arthritis', [
      'Patients with TPMT',
      'Homozygous',
      'Heterozygous',
      'Use in Renal',
    ]);
    const arthritisInitial = this.matchPhrase(
      arthritisSection,
      /initial dose should be approximately ([\s\S]{1,220}?twice-daily schedule)/i,
    );
    const arthritisIncrease = this.matchPhrase(
      arthritisSection,
      /dose may be increased,? ([\s\S]{1,170}?4-week intervals)/i,
    );
    const arthritisIncrementMax = this.matchPhrase(
      arthritisSection,
      /dose increments should be ([\s\S]{1,140}?maximum dose of [\d.]+\s*mg\/kg per day)/i,
    );
    const arthritisResponse = this.matchPhrase(
      arthritisSection,
      /therapeutic response occurs ([\s\S]{1,160}?minimum of 12 weeks)/i,
    );
    const arthritisLowestDose = this.matchPhrase(
      arthritisSection,
      /maintenance therapy should be (at the lowest effective dose)/i,
    );
    const arthritisFacts = [
      arthritisInitial ? `an initial dose of ${arthritisInitial}` : null,
      arthritisIncrease ? `dose increases ${arthritisIncrease}` : null,
      arthritisIncrementMax ? `increments of ${arthritisIncrementMax}` : null,
      arthritisResponse ? `response timing: ${arthritisResponse}` : null,
      arthritisLowestDose ? `maintenance should be ${arthritisLowestDose}` : null,
    ];

    if (arthritisFacts.some(Boolean)) {
      parts.push(
        `For rheumatoid arthritis, the source lists ${this.joinFacts(arthritisFacts)}.`,
      );
    }

    if (/discontinuation may be necessary for severe hematologic or other toxicity/i.test(cleaned)) {
      parts.push('The source says stopping may be needed for severe blood-related or other serious side effects.');
    }

    if (/TPMT|NUDT15/.test(cleaned)) {
      parts.push('The source says people with TPMT or NUDT15 deficiency may need a lower dose or another treatment.');
    }

    if (/renal dysfunction|poor renal function|lower doses/i.test(cleaned)) {
      parts.push('The source says lower doses are usually used for some kidney-function problems.');
    }

    if (parts.length < 2) return null;

    return `Source summary: ${parts.join(' ')} Use your doctor's prescription for your exact dose and schedule.`;
  }

  private simplifyWarnings(sourceText: string) {
    const normalized = sourceText.toLowerCase();
    const warnings: string[] = [];

    if (/malignan|cancer|lymphoma|skin cancer/.test(normalized)) {
      warnings.push('This medicine may increase the risk of some cancers, including skin cancer or lymphoma.');
      warnings.push('Use sun protection and tell your doctor about new lumps, unusual weight loss, fever, or skin changes.');
    }

    if (/infection|immunosuppress/.test(normalized)) {
      warnings.push('Because this medicine can lower immune system activity, infections may become more serious.');
    }

    if (/hematologic|blood|bone marrow|leukopenia|thrombocytopenia/.test(normalized)) {
      warnings.push('It can sometimes cause blood-related problems, so your doctor may ask for blood tests.');
    }

    if (!warnings.length) {
      warnings.push(this.simplifyMedicalTerms(this.firstUsefulSentence(sourceText)));
    }

    return this.limitText(warnings.join(' '));
  }

  private simplifySideEffects(value: unknown) {
    const sourceItems = Array.isArray(value) ? value.map(String) : [String(value)];
    const joined = sourceItems.join(' ').toLowerCase();
    const effects = new Set<string>();

    if (/hematologic|blood|leukopenia|thrombocytopenia|anemia/.test(joined)) {
      effects.add('blood-related problems');
    }
    if (/gastrointestinal|nausea|vomiting|diarrhea|stomach/.test(joined)) {
      effects.add('stomach upset, nausea, vomiting, or diarrhea');
    }
    if (/infection/.test(joined)) {
      effects.add('higher risk of infection');
    }
    if (/malignan|cancer|neoplasia|lymphoma/.test(joined)) {
      effects.add('increased risk of some cancers');
    }

    if (effects.size > 0) {
      return Array.from(effects).slice(0, LIST_LIMIT);
    }

    for (const item of sourceItems) {
      if (effects.size >= LIST_LIMIT) break;
      const simplified = this.simplifyMedicalTerms(this.firstUsefulSentence(item));
      if (simplified && simplified.length <= 90) effects.add(simplified);
    }

    return Array.from(effects).slice(0, LIST_LIMIT);
  }

  private simplifyStorage(sourceText: string) {
    return this.limitText(this.simplifyMedicalTerms(this.firstUsefulSentence(sourceText)));
  }

  private hasTrustedFieldSource(sourceRefs: SourceRefs, field: string) {
    const value = sourceRefs[field];
    const refs = Array.isArray(value) ? value : value ? [value] : [];
    return refs.some((ref) => this.isTrustedSource(ref));
  }

  private isTrustedSource(ref: unknown) {
    return isTrustedClinicalSourceRef(ref);
  }

  private firstUsefulSentence(text: string) {
    const cleaned = this.cleanSourceText(text);
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 20)
      .filter((sentence) => !/^(indications and usage|dosage and administration|warnings|adverse reactions)\b/i.test(sentence));

    return sentences[0] ?? cleaned.slice(0, 250);
  }


  private sourceSummarySentences(text: string, priorities: RegExp[]) {
    const cleaned = this.cleanSourceText(text);
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 20)
      .filter((sentence) => !/^(indications and usage|dosage and administration|warnings|adverse reactions)\b/i.test(sentence));
    const selected: string[] = [];

    for (const pattern of priorities) {
      for (const sentence of sentences) {
        if (selected.length >= 6) break;
        if (pattern.test(sentence) && !selected.includes(sentence)) {
          selected.push(sentence);
        }
      }
      if (selected.length >= 6) break;
    }

    return selected.slice(0, 6);
  }

  private sectionText(text: string, heading: string, nextHeadings: string[]) {
    const start = text.search(new RegExp(`\\b${this.escapeRegExp(heading)}\\b`, 'i'));
    if (start < 0) return '';

    const afterHeading = text.slice(start + heading.length);
    const nextIndexes = nextHeadings
      .map((nextHeading) => afterHeading.search(new RegExp(`\\b${this.escapeRegExp(nextHeading)}\\b`, 'i')))
      .filter((index) => index >= 0);
    const end = nextIndexes.length ? Math.min(...nextIndexes) : afterHeading.length;

    return afterHeading.slice(0, end).trim();
  }

  private matchPhrase(text: string, pattern: RegExp) {
    if (!text) return null;
    const match = pattern.exec(text);
    if (!match) return null;

    return this.simplifyMedicalTerms(match[1] ?? match[0]).replace(/\.$/, '');
  }

  private joinFacts(facts: Array<string | null>) {
    const cleaned = facts.map((fact) => fact?.trim()).filter(Boolean) as string[];
    if (cleaned.length <= 1) return cleaned.join('');
    if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
    return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  private cleanSourceText(text: string) {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/â€™/g, "'")
      .replace(/\b(?:INDICATIONS\s+(?:AND|&)\s+USAGE|DOSAGE\s+(?:AND|&)\s+ADMINISTRATION|WARNINGS|ADVERSE REACTIONS)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private simplifyMedicalTerms(text: string) {
    return this.cleanSourceText(text)
      .replace(/renal homotransplantation/gi, 'kidney transplant')
      .replace(/renal transplant/gi, 'kidney transplant')
      .replace(/homograft/gi, 'transplanted organ')
      .replace(/malignancies|malignancy/gi, 'cancer')
      .replace(/hematologic/gi, 'blood-related')
      .replace(/gastrointestinal/gi, 'stomach or gut')
      .replace(/immunosuppressants|immunosuppressive drugs?/gi, 'medicines that lower immune system activity')
      .replace(/immunosuppression/gi, 'lower immune system activity')
      .replace(/lymphoproliferative disease/gi, 'lymph-related cancer')
      .replace(/neoplasia/gi, 'abnormal cell growth or cancer')
      .replace(/toxicity/gi, 'serious side effects')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private plainMedicineName(displayName: string) {
    return displayName.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/gi, '').trim() || displayName;
  }

  private limitText(text: string) {
    const cleaned = this.simplifyMedicalTerms(text);
    if (cleaned.length <= TEXT_FIELD_LIMIT) return cleaned;
    return `${cleaned.slice(0, TEXT_FIELD_LIMIT).replace(/\s+\S*$/, '')}...`;
  }

  private hasAnyContent(fields: PatientExplanationFields) {
    return Boolean(
      fields.whyPrescribed ||
        fields.howToTake ||
        fields.warnings ||
        fields.storage ||
        fields.sideEffects?.length,
    );
  }

  private isEmpty(value: unknown) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
  }
}