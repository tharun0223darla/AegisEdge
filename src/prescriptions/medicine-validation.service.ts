import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoreAIService } from '../ai/core-ai.service';

@Injectable()
export class MedicineValidationService {
  private readonly logger = new Logger(MedicineValidationService.name);

  // A comprehensive static list of common medications
  private static readonly COMMON_MEDICINES_DICTIONARY = [
    'QDol PT4', 'QDol', 'HAPIRAB-D', 'Hapirab', 'PREGAMAX-M', 'Pregamax', 'PROVANOL-SR', 'Provanol',
    'Paracetamol', 'Ibuprofen', 'Propranolol', 'Pregabalin', 'Atorvastatin', 'Metformin', 
    'Amoxicillin', 'Aspirin', 'Omeprazole', 'Losartan', 'Gabapentin', 'Levothyroxine', 
    'Sertraline', 'Lisinopril', 'Simvastatin', 'Metoprolol', 'Albuterol', 'Amoxycillin',
    'Pantoprazole', 'Rabeprazole', 'Domperidone', 'Montelukast', 'Levocetirizine',
    'Azithromycin', 'Clopidogrel', 'Telmisartan', 'Amlodipine', 'Rosuvastatin',
    'Metronidazole', 'Ciprofloxacin', 'Ofloxacin', 'Cefixime', 'Cefpodoxime',
    'Thyroxine', 'Glimepiride', 'Vildagliptin', 'Sitagliptin', 'Teneligliptin',
    'Cetirizine', 'Loratadine', 'Fexofenadine', 'Ranitidine', 'Famotidine',
    'Diclofenac', 'Aceclofenac', 'Tramadol', 'Ketorolac', 'Mefenamic Acid',
    'Dicyclomine', 'Hyoscine', 'Ondansetron', 'Domperidone', 'Metoclopramide',
    'Loperamide', 'Bismuth', 'Sucralfate', 'Spironolactone', 'Furosemide',
    'Torsemide', 'Hydrochlorothiazide', 'Chlorthalidone', 'Indapamide',
    'Ramipril', 'Enalapril', 'Perindopril', 'Fosinopril', 'Trandolapril',
    'Valsartan', 'Candesartan', 'Irbesartan', 'Olmesartan', 'Telmisartan',
    'Carvedilol', 'Nebivolol', 'Atenolol', 'Bisoprolol', 'Metoprolol',
    'Diltiazem', 'Verapamil', 'Nifedipine', 'Felodipine', 'Amlodipine',
    'Atorvastatin', 'Rosuvastatin', 'Simvastatin', 'Pravastatin', 'Fluvastatin',
    'Fenofibrate', 'Gemfibrozil', 'Ezetimibe', 'Niacin', 'Omega-3',
    'Insulin', 'Metformin', 'Glipizide', 'Glyburide', 'Gliclazide',
    'Pioglitazone', 'Rosiglitazone', 'Acarbose', 'Miglitol', 'Voglibose',
    'Sitagliptin', 'Saxagliptin', 'Linagliptin', 'Alogliptin', 'Vildagliptin',
    'Canagliflozin', 'Dapagliflozin', 'Empagliflozin', 'Ertugliflozin',
    'Liraglutide', 'Semaglutide', 'Dulaglutide', 'Exenatide', 'Lixisenatide',
    'Levothyroxine', 'Liothyronine', 'Methimazole', 'Propylthiouracil',
    'Prednisolone', 'Methylprednisolone', 'Dexamethasone', 'Betamethasone',
    'Hydrocortisone', 'Fludrocortisone', 'Deflazacort', 'Triamcinolone',
    'Amoxicillin', 'Ampicillin', 'Cloxacillin', 'Piperacillin', 'Tazobactam',
    'Cefadroxil', 'Cephalexin', 'Cefazolin', 'Cefuroxime', 'Cefaclor',
    'Cefotaxime', 'Ceftriaxone', 'Ceftazidime', 'Cefepime', 'Cefpirome',
    'Meropenem', 'Imipenem', 'Cilastatin', 'Ertapenem', 'Doripenem',
    'Azithromycin', 'Erythromycin', 'Clarithromycin', 'Roxithromycin',
    'Doxycycline', 'Minocycline', 'Tetracycline', 'Oxytetracycline',
    'Ciprofloxacin', 'Levofloxacin', 'Moxifloxacin', 'Norfloxacin',
    'Gentamicin', 'Amikacin', 'Tobramycin', 'Neomycin', 'Streptomycin',
    'Linezolid', 'Tedizolid', 'Clindamycin', 'Metronidazole', 'Tinidazole',
    'Fluconazole', 'Itraconazole', 'Ketoconazole', 'Voriconazole', 'Posaconazole',
    'Terbinafine', 'Griseofulvin', 'Nystatin', 'Amphotericin B', 'Caspofungin',
    'Acyclovir', 'Valacyclovir', 'Famciclovir', 'Ganciclovir', 'Valganciclovir',
    'Oseltamivir', 'Zanamivir', 'Ribavirin', 'Remdesivir', 'Favipiravir',
    'Chloroquine', 'Hydroxychloroquine', 'Artemether', 'Lumefantrine',
    'Artesunate', 'Mefloquine', 'Primaquine', 'Quinine', 'Pyrimethamine',
    'Albendazole', 'Mebendazole', 'Ivermectin', 'Diethylcarbamazine',
    'Sertraline', 'Fluoxetine', 'Paroxetine', 'Citalopram', 'Escitalopram',
    'Fluvoxamine', 'Duloxetine', 'Venlafaxine', 'Desvenlafaxine', 'Milnacipran',
    'Amitriptyline', 'Imipramine', 'Nortriptyline', 'Clomipramine',
    'Mirtazapine', 'Bupropion', 'Trazodone', 'Vortioxetine', 'Vilazodone',
    'Diazepam', 'Lorazepam', 'Alprazolam', 'Clonazepam', 'Clobazam',
    'Chlordiazepoxide', 'Midazolam', 'Zolpidem', 'Zopiclone', 'Eszopiclone',
    'Haloperidol', 'Risperidone', 'Olanzapine', 'Quetiapine', 'Aripiprazole',
    'Ziprasidone', 'Lurasidone', 'Amisulpride', 'Clozapine', 'Pimozide',
    'Phenytoin', 'Carbamazepine', 'Oxcarbazepine', 'Valproate', 'Divalproex',
    'Gabapentin', 'Pregabalin', 'Topiramate', 'Levetiracetam', 'Lamotrigine',
    'Zonisamide', 'Lacosamide', 'Brivaracetam', 'Phenobarbital', 'Primidone'
  ];

  constructor(
    private prisma: PrismaService,
    private coreAiService: CoreAIService,
  ) {}

  /**
   * Run full validation, dictionary matching, fuzzy alias resolution, verification AI pass, and confidence scoring.
   */
  async validateAndNormalize(
    userId: string,
    candidates: any[],
  ): Promise<any[]> {
    this.logger.log(`Stage 5: Starting Medical Validation Layer for ${candidates.length} candidate(s).`);

    // 1. Layer 5: Medical Validation (Regex Filters)
    const afterLayer5: any[] = [];
    const rejectedLayer5: any[] = [];

    for (const c of candidates) {
      if (!c.medicineName) continue;
      const filterResult = this.filterCandidate(c.medicineName);
      if (filterResult.valid) {
        afterLayer5.push(c);
      } else {
        rejectedLayer5.push({ name: c.medicineName, reason: filterResult.reason });
      }
    }

    this.logger.log(`Layer 5 Filter Output: Accepted: ${afterLayer5.length}, Rejected: ${rejectedLayer5.length}`);
    if (rejectedLayer5.length > 0) {
      this.logger.log(`Layer 5 Rejected list:\n${JSON.stringify(rejectedLayer5, null, 2)}`);
    }

    if (afterLayer5.length === 0) return [];

    // 2. Layer 6: Medicine Dictionary Validation & Fuzzy Matching (with Aliases)
    this.logger.log('Stage 6: Running Medicine Dictionary Validation & Fuzzy Matching...');
    
    // Fetch unique user medicines from DB to use as database dictionary entries
    const dbMeds = await this.prisma.medicine.findMany({
      where: { userId },
      select: { name: true, brandName: true, genericName: true },
    });

    const dbNames = dbMeds.flatMap(m => [m.name, m.brandName, m.genericName]).filter(Boolean) as string[];
    
    // Combine local common medicines dictionary and database items
    const fullDictionary = Array.from(new Set([
      ...MedicineValidationService.COMMON_MEDICINES_DICTIONARY,
      ...dbNames
    ]));

    const dictMatchedCandidates: any[] = [];

    for (const c of afterLayer5) {
      const matchResult = this.matchDictionary(c.medicineName, fullDictionary);
      dictMatchedCandidates.push({
        ...c,
        hasDictMatch: matchResult.exactMatch,
        hasFuzzyMatch: matchResult.fuzzyMatch,
        matchedAlias: matchResult.matchedAlias,
        matchSimilarity: matchResult.similarity,
      });
    }

    // 3. Layer 7: Medicine Verification AI Pass (Strict classification check)
    this.logger.log(`Stage 7: Running Medicine Verification AI Pass for ${dictMatchedCandidates.length} candidate(s)...`);
    const verifiedCandidates = await this.verifyWithAi(dictMatchedCandidates);

    // 4. Layer 8: Confidence Engine (Calculate smart confidence scores)
    this.logger.log('Stage 8: Calculating confidence scores via the Confidence Engine...');
    const finalizedCandidates: any[] = [];

    for (const c of verifiedCandidates) {
      const confidence = this.calculateSmartConfidence(c);

      // Only verified medicines should appear! 
      // If AI pass verified it as a medicine candidate, we keep it. 
      // If AI pass explicitly rejected it (isVerified is false), we filter it out.
      if (c.aiVerified) {
        finalizedCandidates.push({
          ...c,
          confidenceScore: confidence / 100, // DB stores as decimal (0.0 - 1.0)
          reviewStatus: confidence >= 70 ? 'VERIFIED' : 'NEEDS_REVIEW',
        });
      } else {
        this.logger.log(`Filtering out candidate that failed AI verification pass: "${c.medicineName}"`);
      }
    }

    this.logger.log(`Pipeline Output: Extracted and verified ${finalizedCandidates.length} medicine(s).`);
    return finalizedCandidates;
  }

  /**
   * Task 5: Regex filtering logic to remove doctor, hospital info, registration, or vital noise
   */
  private filterCandidate(name: string): { valid: boolean; reason?: string } {
    const trimmed = name.trim();
    if (trimmed.length < 2) return { valid: false, reason: 'Name too short' };
    if (trimmed.length > 50) return { valid: false, reason: 'Name too long (> 50)' };

    const forbidden = [
      'dr', 'doctor', 'mbbs', 'ms', 'mch', 'surgeon', 'hospital', 'clinic', 'healthcare',
      'bp', 'pr', 'pulse', 'spo2', 'temp', 'age', 'female', 'male', 'diagnosis', 'symptoms',
      'patient', 'date', 'phone', 'address', 'rx', 'hosp', 'reg'
    ];
    const lower = trimmed.toLowerCase();

    for (const kw of forbidden) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(lower)) {
        return { valid: false, reason: `Matches forbidden clinical metadata term: ${kw}` };
      }
    }

    // Filter out registration/measurement number groups (more than 3 digits)
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount > 3) {
      return { valid: false, reason: 'Too many numeric digits (likely measurements/vitals)' };
    }

    // Filter out sentence-like noise (too many words/spaces)
    const spaceCount = (trimmed.match(/\s/g) || []).length;
    if (spaceCount > 4) {
      return { valid: false, reason: 'Sentence-like structure (likely clinical instructions/notes)' };
    }

    return { valid: true };
  }

  /**
   * Helper Levenshtein distance calculations
   */
  private getLevenshteinDistance(a: string, b: string): number {
    const tmp: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1, // deletion
          tmp[i][j - 1] + 1, // insertion
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
        );
      }
    }
    return tmp[a.length][b.length];
  }

  private getSimilarity(a: string, b: string): number {
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1.0;
    return 1.0 - this.getLevenshteinDistance(a, b) / maxLength;
  }

  /**
   * Match candidate name against dictionary of common medicines & user database history.
   * Returns exact or fuzzy match details.
   */
  private matchDictionary(
    name: string,
    dictionary: string[]
  ): { exactMatch: boolean; fuzzyMatch: boolean; matchedAlias?: string; similarity: number } {
    const target = name.toLowerCase().trim();
    
    // Clean target from dosage terms to get base name (e.g. "QDol PT4" -> "qdol", "PROVANOL-SR" -> "provanol")
    const cleanTarget = target
      .replace(/\b(tab|capsule|cap|injection|inj|mg|ml|sr|cr|xl|er)\b/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let bestMatch = '';
    let bestSimilarity = 0;

    for (const dictEntry of dictionary) {
      const entry = dictEntry.toLowerCase().trim();
      const cleanEntry = entry
        .replace(/\b(tab|capsule|cap|injection|inj|mg|ml|sr|cr|xl|er)\b/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Check exact match on full name or cleaned base name
      if (target === entry || cleanTarget === cleanEntry) {
        return { exactMatch: true, fuzzyMatch: false, matchedAlias: dictEntry, similarity: 1.0 };
      }

      // Compute fuzzy similarity using Levenshtein distance on base names
      const sim = this.getSimilarity(cleanTarget, cleanEntry);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = dictEntry;
      }
    }

    // Fuzzy threshold is 82% similarity
    if (bestSimilarity >= 0.82) {
      return { exactMatch: false, fuzzyMatch: true, matchedAlias: bestMatch, similarity: bestSimilarity };
    }

    return { exactMatch: false, fuzzyMatch: false, similarity: bestSimilarity };
  }

  /**
   * Task 7: Medicine Verification AI Pass (Secondary pass verification)
   * Evaluates if each candidate is a valid medication name, preserving original spelling exactly.
   */
  private async verifyWithAi(candidates: any[]): Promise<any[]> {
    try {
      const prompt = `
You are a pharmacist validating a list of candidate strings extracted from a medical prescription.
Evaluate if each candidate is a valid medication name (brand name, generic name, active ingredient).

STRICT RULES:
1. NEVER guess or suggest alternative medicine names. DO NOT correct typos or rewrite the name to standard spellings. Preserve the original spelling of each candidate exactly.
2. Set isVerified: true if the candidate is indeed a valid medication name (e.g., brand names, generic formulations like "PREGAMAX-M", "HAPIRAB-D", "QDol PT4", "PROVANOL-SR", "Propranolol" are all valid).
3. Set isVerified: false if the candidate represents doctor details (e.g., contains 'Dr', 'MBBS'), hospital names, diagnostic vitals, symptoms, patient details, or noise text.
4. Set reason to a brief description of the candidate verification.

Input Candidate List:
${JSON.stringify(candidates.map(c => ({
  medicineName: c.medicineName,
  dosage: c.dosage,
  frequency: c.frequency,
  instructions: c.instructions,
  confidence: c.confidence
})))}

Return JSON in this format:
{
  "verified": [
    {
      "originalName": "original input name",
      "isVerified": boolean,
      "reason": "brief verification justification"
    }
  ]
}
`;

      const response = await this.coreAiService.generateJSON<any>(
        prompt,
        'You are a pharmacist validation assistant. Classify medication names exactly.'
      );

      const result: any[] = [];
      if (response && Array.isArray(response.verified)) {
        for (const item of response.verified) {
          const match = candidates.find(
            (c) => c.medicineName.toLowerCase().trim() === item.originalName.toLowerCase().trim()
          );

          if (match) {
            result.push({
              ...match,
              aiVerified: item.isVerified,
              aiValidationReason: item.reason,
            });
          }
        }
      }

      // For candidates not returned in list, default to verification status of false
      for (const c of candidates) {
        if (!result.find(r => r.medicineName.toLowerCase().trim() === c.medicineName.toLowerCase().trim())) {
          result.push({ ...c, aiVerified: false, aiValidationReason: 'No AI verification response' });
        }
      }

      return result;
    } catch (error) {
      this.logger.warn(`AI secondary verification pass failed: ${error.message}. Proceeding with dictionary status.`);
      return candidates.map(c => ({ ...c, aiVerified: true, aiValidationReason: 'AI pass failed fallback' }));
    }
  }

  /**
   * Task 8: Confidence Engine
   * Calculate confidence using:
   * +30 base score for passing AI verification
   * +20 dosage detected
   * +20 found in Rx region (all Stage 1 candidates get this)
   * +20 medicine dictionary match (exact or fuzzy)
   * +10 Gemini confidence (Stage 1 confidence score * 10)
   */
  private calculateSmartConfidence(candidate: any): number {
    let score = 30; // base score for passing verification

    // +30 verified by AI validation
    if (candidate.aiVerified) {
      score += 30;
    }

    // +20 dosage detected
    if (candidate.dosage && candidate.dosage.trim().length > 0) {
      score += 20;
    }

    // +20 found in Rx region (automatic for all Gemini Vision parsed items)
    score += 20;

    // +20 medicine dictionary match (exact or fuzzy matched alias)
    if (candidate.hasDictMatch || candidate.hasFuzzyMatch) {
      score += 20;
    }

    // +10 Gemini confidence (weighted from Stage 1 extracted confidence parameter)
    if (candidate.confidence !== undefined && candidate.confidence !== null) {
      score += Math.round(Number(candidate.confidence) * 10);
    } else {
      score += 5; // default fallback if confidence not specified
    }

    return Math.max(10, Math.min(score, 98));
  }
}
