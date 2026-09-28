import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { CandidateMention } from './interfaces/candidate-generation.interface';
import { createHash } from 'crypto';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

export interface DictionaryMetadata {
  userMeds: {
    name: string;
    brandName?: string | null;
    genericName?: string | null;
    strength?: string | null;
  }[];
  masterMeds: {
    brandName: string;
    genericName?: string | null;
    strength?: string | null;
    category?: string | null;
    composition?: string | null;
  }[];
  saltProfiles?: {
    displayName: string;
    ingredients: unknown;
  }[];
  corrections: { rawExtractedName: string; correctedName: string }[];
}

@Injectable()
export class DictionaryCandidateGenerator {
  private readonly logger = new Logger(DictionaryCandidateGenerator.name);

  // Static alias knowledge
  public static readonly ALIAS_KNOWLEDGE = [
    'QDol PT4',
    'QDol',
    'HAPIRAB-D',
    'Hapirab',
    'PREGAMAX-M',
    'Pregamax',
    'PROVANOL-SR',
    'Provanol',
    'Paracetamol',
    'Ibuprofen',
    'Propranolol',
    'Pregabalin',
    'Atorvastatin',
    'Metformin',
    'Amoxicillin',
    'Aspirin',
    'Omeprazole',
    'Losartan',
    'Gabapentin',
    'Levothyroxine',
    'Sertraline',
    'Lisinopril',
    'Simvastatin',
    'Metoprolol',
    'Albuterol',
    'Amoxycillin',
    'Pantoprazole',
    'Rabeprazole',
    'Domperidone',
    'Montelukast',
    'Levocetirizine',
    'Azithromycin',
    'Clopidogrel',
    'Telmisartan',
    'Amlodipine',
    'Rosuvastatin',
    'Metronidazole',
    'Ciprofloxacin',
    'Ofloxacin',
    'Cefixime',
    'Cefpodoxime',
    'Thyroxine',
    'Glimepiride',
    'Vildagliptin',
    'Sitagliptin',
    'Teneligliptin',
    'Cetirizine',
    'Loratadine',
    'Fexofenadine',
    'Ranitidine',
    'Famotidine',
    'Diclofenac',
    'Aceclofenac',
    'Tramadol',
    'Ketorolac',
    'Mefenamic Acid',
    'Dicyclomine',
    'Hyoscine',
    'Ondansetron',
    'Domperidone',
    'Metoclopramide',
    'Loperamide',
    'Bismuth',
    'Sucralfate',
    'Spironolactone',
    'Furosemide',
    'Torsemide',
    'Hydrochlorothiazide',
    'Chlorthalidone',
    'Indapamide',
    'Ramipril',
    'Enalapril',
    'Perindopril',
    'Fosinopril',
    'Trandolapril',
    'Valsartan',
    'Candesartan',
    'Irbesartan',
    'Olmesartan',
    'Telmisartan',
    'Carvedilol',
    'Nebivolol',
    'Atenolol',
    'Bisoprolol',
    'Metoprolol',
    'Diltiazem',
    'Verapamil',
    'Nifedipine',
    'Felodipine',
    'Amlodipine',
    'Atorvastatin',
    'Rosuvastatin',
    'Simvastatin',
    'Pravastatin',
    'Fluvastatin',
    'Fenofibrate',
    'Gemfibrozil',
    'Ezetimibe',
    'Niacin',
    'Omega-3',
    'Insulin',
    'Metformin',
    'Glipizide',
    'Glyburide',
    'Gliclazide',
    'Pioglitazone',
    'Rosiglitazone',
    'Acarbose',
    'Miglitol',
    'Voglibose',
    'Sitagliptin',
    'Saxagliptin',
    'Linagliptin',
    'Alogliptin',
    'Vildagliptin',
    'Canagliflozin',
    'Dapagliflozin',
    'Empagliflozin',
    'Ertugliflozin',
    'Liraglutide',
    'Semaglutide',
    'Dulaglutide',
    'Exenatide',
    'Lixisenatide',
    'Levothyroxine',
    'Liothyronine',
    'Methimazole',
    'Propylthiouracil',
    'Prednisolone',
    'Methylprednisolone',
    'Dexamethasone',
    'Betamethasone',
    'Hydrocortisone',
    'Fludrocortisone',
    'Deflazacort',
    'Triamcinolone',
    'Amoxicillin',
    'Ampicillin',
    'Cloxacillin',
    'Piperacillin',
    'Tazobactam',
    'Cefadroxil',
    'Cephalexin',
    'Cefazolin',
    'Cefuroxime',
    'Cefaclor',
    'Cefotaxime',
    'Ceftriaxone',
    'Ceftazidime',
    'Cefepime',
    'Cefpirome',
    'Meropenem',
    'Imipenem',
    'Cilastatin',
    'Ertapenem',
    'Doripenem',
    'Azithromycin',
    'Erythromycin',
    'Clarithromycin',
    'Roxithromycin',
    'Doxycycline',
    'Minocycline',
    'Tetracycline',
    'Oxytetracycline',
    'Ciprofloxacin',
    'Levofloxacin',
    'Moxifloxacin',
    'Norfloxacin',
    'Gentamicin',
    'Amikacin',
    'Tobramycin',
    'Neomycin',
    'Streptomycin',
    'Linezolid',
    'Tedizolid',
    'Clindamycin',
    'Metronidazole',
    'Tinidazole',
    'Fluconazole',
    'Itraconazole',
    'Ketoconazole',
    'Voriconazole',
    'Posaconazole',
    'Terbinafine',
    'Griseofulvin',
    'Nystatin',
    'Amphotericin B',
    'Caspofungin',
    'Acyclovir',
    'Valacyclovir',
    'Famciclovir',
    'Ganciclovir',
    'Valganciclovir',
    'Oseltamivir',
    'Zanamivir',
    'Ribavirin',
    'Remdesivir',
    'Favipiravir',
    'Chloroquine',
    'Hydroxychloroquine',
    'Artemether',
    'Lumefantrine',
    'Artesunate',
    'Mefloquine',
    'Primaquine',
    'Quinine',
    'Pyrimethamine',
    'Albendazole',
    'Mebendazole',
    'Ivermectin',
    'Diethylcarbamazine',
    'Sertraline',
    'Fluoxetine',
    'Paroxetine',
    'Citalopram',
    'Escitalopram',
    'Fluvoxamine',
    'Duloxetine',
    'Venlafaxine',
    'Desvenlafaxine',
    'Milnacipran',
    'Amitriptyline',
    'Imipramine',
    'Nortriptyline',
    'Clomipramine',
    'Mirtazapine',
    'Bupropion',
    'Trazodone',
    'Vortioxetine',
    'Vilazodone',
    'Diazepam',
    'Lorazepam',
    'Alprazolam',
    'Clonazepam',
    'Clobazam',
    'Chlordiazepoxide',
    'Midazolam',
    'Zolpidem',
    'Zopiclone',
    'Eszopiclone',
    'Haloperidol',
    'Risperidone',
    'Olanzapine',
    'Quetiapine',
    'Aripiprazole',
    'Ziprasidone',
    'Lurasidone',
    'Amisulpride',
    'Clozapine',
    'Pimozide',
    'Phenytoin',
    'Carbamazepine',
    'Oxcarbazepine',
    'Valproate',
    'Divalproex',
    'Gabapentin',
    'Pregabalin',
    'Topiramate',
    'Levetiracetam',
    'Lamotrigine',
    'Zonisamide',
    'Lacosamide',
    'Brivaracetam',
    'Phenobarbital',
    'Primidone',
    'Cocaine',
    'Cocaine Hydrochloride',
    'Adrenaline',
    'Epinephrine',
    'Saline',
    'Normal Saline',
    'Sodium Chloride',
  ];

  constructor(private prisma: PrismaService) {}

  async loadDictionaryMetadata(userId: string): Promise<DictionaryMetadata> {
    this.logger.log(`Loading dictionary metadata once for userId ${userId}`);
    const [userMeds, masterMeds, saltProfiles, corrections] = await Promise.all(
      [
        this.prisma.medicine.findMany({
          where: { userId },
          select: {
            name: true,
            brandName: true,
            genericName: true,
            strength: true,
          },
        }),
        this.prisma.medicineMaster.findMany({
          select: {
            brandName: true,
            genericName: true,
            strength: true,
            category: true,
            composition: true,
          },
        }),
        this.prisma.saltProfile.findMany({
          select: {
            displayName: true,
            ingredients: true,
          },
        }),
        this.prisma.medicineCorrection.findMany({
          where: { userId },
          select: { rawExtractedName: true, correctedName: true },
        }),
      ],
    );

    return { userMeds, masterMeds, saltProfiles, corrections };
  }

  generateCandidates(
    evidenceList: OcrEvidence[],
    metadata: DictionaryMetadata,
  ): CandidateMention[] {
    type Entry = {
      lookupName: string;
      canonicalName: string;
      source: string;
      strength?: string | null;
    };

    const entries: Entry[] = [];
    for (const correction of metadata.corrections) {
      entries.push({
        lookupName: correction.rawExtractedName,
        canonicalName: correction.correctedName,
        source: 'USER_CORRECTION',
      });
    }
    for (const master of metadata.masterMeds) {
      entries.push({
        lookupName: master.brandName,
        canonicalName: master.brandName,
        source: 'MEDICINE_MASTER',
        strength: master.strength,
      });
      if (master.genericName) {
        entries.push({
          lookupName: master.genericName,
          canonicalName: master.genericName,
          source: 'MEDICINE_MASTER_GENERIC',
          strength: master.strength,
        });
      }
    }
    for (const profile of metadata.saltProfiles ?? []) {
      for (const ingredient of this.readSaltIngredients(profile.ingredients)) {
        entries.push({
          lookupName: ingredient.name,
          canonicalName: ingredient.name,
          source: 'SALT_PROFILE',
          strength: ingredient.strength,
        });
      }
    }
    for (const medicine of metadata.userMeds) {
      entries.push({
        lookupName: medicine.name,
        canonicalName: medicine.name,
        source: 'PREVIOUS_MEDICINES',
        strength: medicine.strength,
      });
      if (medicine.brandName) {
        entries.push({
          lookupName: medicine.brandName,
          canonicalName: medicine.brandName,
          source: 'PREVIOUS_MEDICINES',
          strength: medicine.strength,
        });
      }
    }
    for (const alias of DictionaryCandidateGenerator.ALIAS_KNOWLEDGE) {
      entries.push({
        lookupName: alias,
        canonicalName: alias,
        source: 'STATIC_KNOWLEDGE',
      });
    }

    const exactIndex = new Map<string, Entry[]>();
    const prefixIndex = new Map<string, Entry[]>();
    const lengthIndex = new Map<number, Entry[]>();
    for (const entry of entries) {
      const normalized = this.normalizeName(entry.lookupName);
      if (!normalized) continue;
      this.addToIndex(exactIndex, normalized, entry);
      this.addToIndex(
        prefixIndex,
        normalized.slice(0, Math.min(4, normalized.length)),
        entry,
      );
      this.addToIndex(lengthIndex, normalized.length, entry);
    }

    const mentions: CandidateMention[] = [];
    const emitted = new Set<string>();

    for (const rawEvidence of evidenceList) {
      const evidence = ensureOcrEvidenceId(rawEvidence);
      const line = normalizeOcrText(evidence.text);
      if (!line) continue;

      const tokens = line
        .replace(/[^\p{L}\p{N}+\-\/\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

      for (let size = 1; size <= Math.min(4, tokens.length); size++) {
        for (let start = 0; start <= tokens.length - size; start++) {
          const rawNgram = tokens.slice(start, start + size).join(' ');
          if (!this.isEligibleNgram(rawNgram)) continue;

          const normalizedNgram = this.normalizeName(rawNgram);
          const candidateEntries = new Set<Entry>(
            exactIndex.get(normalizedNgram) || [],
          );
          const prefixKey = normalizedNgram.slice(
            0,
            Math.min(4, normalizedNgram.length),
          );
          for (const entry of prefixIndex.get(prefixKey) || [])
            candidateEntries.add(entry);
          for (
            let len = normalizedNgram.length - 2;
            len <= normalizedNgram.length + 2;
            len++
          ) {
            for (const entry of lengthIndex.get(len) || [])
              candidateEntries.add(entry);
          }

          for (const entry of candidateEntries) {
            const match = this.matchEntry(
              normalizedNgram,
              entry.lookupName,
              entry.source,
            );
            if (!match) continue;

            const emissionKey = `${evidence.id}|${this.normalizeName(entry.canonicalName)}|${entry.source}|${normalizedNgram}`;
            if (emitted.has(emissionKey)) continue;
            emitted.add(emissionKey);

            const lowerLine = line.toLocaleLowerCase();
            const lowerNgram = rawNgram.toLocaleLowerCase();
            const charStart = lowerLine.indexOf(lowerNgram);
            const dosage = this.extractStrength(line) || entry.strength || null;
            const frequency = this.extractFrequency(line);
            const durationDays = this.extractDurationDays(line);
            const quantity = this.extractQuantity(line);
            const confidence = this.calculateConfidence(
              match.similarity,
              evidence.confidence,
              entry.source,
            );

            const mentionId = createHash('sha256')
              .update(
                [
                  'dictionary',
                  evidence.id,
                  this.normalizeName(entry.canonicalName),
                  normalizedNgram,
                  entry.source,
                  dosage || '',
                  frequency || '',
                ].join('|'),
              )
              .digest('hex');

            mentions.push({
              id: mentionId,
              rawText: rawNgram,
              canonicalName: entry.canonicalName,
              normalized: this.normalizeName(entry.canonicalName),
              sourceGenerator: 'dictionary',
              traceabilityStatus: charStart >= 0 ? 'RESOLVED' : 'UNRESOLVED',
              confidence,
              variantName: evidence.variant || 'ORIGINAL',
              dosage,
              frequency,
              timesOfDay: [],
              durationDays,
              quantity,
              instructions: this.extractInstructions(line),
              evidenceRef: {
                evidenceId: evidence.id!,
                lineNumber: evidence.lineNumber,
                text: evidence.text,
                charStart: charStart >= 0 ? charStart : undefined,
                charEnd:
                  charStart >= 0 ? charStart + rawNgram.length : undefined,
                bbox: evidence.bbox,
                normalizedBbox: evidence.normalizedBbox,
                polygon: evidence.polygon,
                pageIndex: evidence.pageIndex ?? 0,
                engine: evidence.engine,
                variant: evidence.variant,
              },
              matchDetails: {
                source: entry.source,
                method: match.method,
                matchedValue: entry.canonicalName,
                similarity: match.similarity,
                editDistance: match.editDistance,
              },
            });
          }
        }
      }
    }

    return mentions;
  }

  private addToIndex<K>(index: Map<K, any[]>, key: K, value: any): void {
    const values = index.get(key) || [];
    values.push(value);
    index.set(key, values);
  }

  private readSaltIngredients(
    value: unknown,
  ): Array<{ name: string; strength?: string | null }> {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const record = item as Record<string, unknown>;
        const rawName = record.name ?? record.ingredient;
        const rawStrength = record.strength;
        if (typeof rawName !== 'string' || rawName.trim().length < 3) {
          return null;
        }
        return {
          name: rawName.trim(),
          strength: typeof rawStrength === 'string' ? rawStrength.trim() : null,
        };
      })
      .filter(
        (
          item,
        ): item is {
          name: string;
          strength: string | null;
        } => item !== null,
      );
  }

  private matchEntry(
    normalizedInput: string,
    dictionaryName: string,
    source: string,
  ): {
    method: 'exact' | 'prefix' | 'fuzzy' | 'alias';
    similarity: number;
    editDistance: number;
  } | null {
    const normalizedDictionary = this.normalizeName(dictionaryName);
    if (!normalizedDictionary) return null;

    if (normalizedInput === normalizedDictionary) {
      return {
        method: source === 'USER_CORRECTION' ? 'alias' : 'exact',
        similarity: 1,
        editDistance: 0,
      };
    }

    const minimumLength = Math.min(
      normalizedInput.length,
      normalizedDictionary.length,
    );
    const maximumLength = Math.max(
      normalizedInput.length,
      normalizedDictionary.length,
    );
    const prefixSimilarity = minimumLength / maximumLength;
    if (
      minimumLength >= 4 &&
      prefixSimilarity >= 0.75 &&
      (normalizedDictionary.startsWith(normalizedInput) ||
        normalizedInput.startsWith(normalizedDictionary))
    ) {
      return {
        method: 'prefix',
        similarity: prefixSimilarity,
        editDistance: maximumLength - minimumLength,
      };
    }

    if (
      normalizedInput.length < 4 ||
      Math.abs(normalizedInput.length - normalizedDictionary.length) > 2
    ) {
      return null;
    }

    const maxDistance = normalizedInput.length <= 6 ? 1 : 2;
    const distance = this.levenshtein(normalizedInput, normalizedDictionary);
    const similarity = 1 - distance / maximumLength;
    if (distance <= maxDistance && similarity >= 0.75) {
      return { method: 'fuzzy', similarity, editDistance: distance };
    }
    return null;
  }

  private isEligibleNgram(value: string): boolean {
    const normalized = this.normalizeName(value);
    if (normalized.length < 3 || /^\d+$/.test(normalized)) return false;
    const stopWords = new Set([
      'take',
      'daily',
      'morning',
      'evening',
      'night',
      'food',
      'meal',
      'days',
      'weeks',
      'months',
      'tablet',
      'tablets',
      'capsule',
      'capsules',
      'syrup',
      'patient',
      'doctor',
      'date',
      'prescription',
      'hospital',
      'empty',
      'crop',
    ]);
    return !stopWords.has(value.toLowerCase());
  }

  private normalizeName(value: string): string {
    return (value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  private extractStrength(text: string): string | null {
    const match =
      /\b(\d+(?:\.\d+)?(?:\s*[\/+\-]\s*\d+(?:\.\d+)?)?)\s*(mcg|µg|ug|mg|g|ml|iu|units?)\b/i.exec(
        text,
      );
    return match
      ? `${match[1].replace(/\s+/g, '')}${match[2].toLowerCase()}`
      : null;
  }

  private extractFrequency(text: string): string | null {
    const patterns: Array<[RegExp, string]> = [
      [/\b(?:four\s+times\s+(?:a\s+)?day|qid)\b/i, 'FOUR_TIMES_DAILY'],
      [/\b(?:three\s+times\s+(?:a\s+)?day|tds|tid)\b/i, 'THREE_TIMES_DAILY'],
      [/\b(?:twice\s+daily|twice\s+(?:a\s+)?day|bd|bid)\b/i, 'TWICE_DAILY'],
      [/\b(?:once\s+daily|once\s+(?:a\s+)?day|daily|od)\b/i, 'DAILY'],
      [/\b(?:once\s+weekly|weekly)\b/i, 'WEEKLY'],
      [/\b(?:as\s+needed|sos|prn)\b/i, 'AS_NEEDED'],
    ];
    return patterns.find(([pattern]) => pattern.test(text))?.[1] || null;
  }

  private extractDurationDays(text: string): number | null {
    const match =
      /\b(?:for\s+|x\s*)?(\d+)\s*(day|days|week|weeks|month|months)\b/i.exec(
        text,
      );
    if (!match) return null;
    const value = Number(match[1]);
    if (match[2].toLowerCase().startsWith('week')) return value * 7;
    if (match[2].toLowerCase().startsWith('month')) return value * 30;
    return value;
  }

  private extractQuantity(text: string): number | null {
    const match =
      /(?:#|qty\s*[:\-]?\s*)(\d+)|\b(\d+)\s*(?:tablets?|tabs?|capsules?|caps?|pills?)\b/i.exec(
        text,
      );
    return match ? Number(match[1] ?? match[2]) : null;
  }

  private extractInstructions(text: string): string | null {
    if (/\bbefore\s+(?:food|meal|breakfast|lunch|dinner)\b/i.test(text))
      return 'BEFORE_FOOD';
    if (/\bafter\s+(?:food|meal|breakfast|lunch|dinner)\b/i.test(text))
      return 'AFTER_FOOD';
    if (/\bwith\s+food\b/i.test(text)) return 'WITH_FOOD';
    return null;
  }

  private calculateConfidence(
    similarity: number,
    ocrConfidence: number,
    source: string,
  ): number {
    const normalizedOcr =
      ocrConfidence > 1 ? ocrConfidence / 100 : ocrConfidence;
    const sourceWeight =
      source === 'PREVIOUS_MEDICINES'
        ? 0.7
        : source === 'STATIC_KNOWLEDGE'
          ? 0.78
          : 0.88;
    return Math.max(
      0,
      Math.min(1, similarity * sourceWeight * Math.max(0.25, normalizedOcr)),
    );
  }

  private levenshtein(s1: string, s2: string): number {
    if (s1 === s2) return 0;
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;

    let prevRow = Array(s2.length + 1);
    let currRow = Array(s2.length + 1);

    for (let j = 0; j <= s2.length; j++) {
      prevRow[j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      currRow[0] = i;
      for (let j = 1; j <= s2.length; j++) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        currRow[j] = Math.min(
          currRow[j - 1] + 1,
          prevRow[j] + 1,
          prevRow[j - 1] + indicator,
        );
      }
      const temp = prevRow;
      prevRow = currRow;
      currRow = temp;
    }
    return prevRow[s2.length];
  }
}
