import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CandidateResult {
  candidate: string;
  similarity: number; // 0.0 to 1.0
  source: string;
  brandName?: string | null;
  genericName?: string | null;
  strength?: string | null;
  category?: string | null;
  composition?: string | null;
}

@Injectable()
export class CandidateGeneratorService {
  private readonly logger = new Logger(CandidateGeneratorService.name);

  // Fallback static knowledge for common medicines
  public static readonly ALIAS_KNOWLEDGE = [
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

  constructor(private prisma: PrismaService) {}

  async generateCandidates(
    rawOcr: string,
    normalizedOcr: string,
    userId: string,
    aiScore = 0.0,
  ): Promise<CandidateResult[]> {
    this.logger.log(`Candidate matching for raw OCR: "${rawOcr}"`);

    const tokens = Array.from(new Set([
      ...this.tokenize(rawOcr),
      ...this.tokenize(normalizedOcr),
      ...(rawOcr && rawOcr.trim().length >= 3 ? [rawOcr.trim()] : []),
      ...(normalizedOcr && normalizedOcr.trim().length >= 3 ? [normalizedOcr.trim()] : []),
    ]));

    if (tokens.length === 0) return [];

    // Fetch master DB entries, history, corrections
    const userMeds = await this.prisma.medicine.findMany({
      where: { userId },
      select: { name: true, brandName: true, genericName: true, strength: true },
    });

    const masterMeds = await this.prisma.medicineMaster.findMany({
      select: { brandName: true, genericName: true, strength: true, category: true, composition: true },
    });

    const corrections = await this.prisma.medicineCorrection.findMany({
      select: { rawExtractedName: true, correctedName: true },
    });

    const candidatesMap = new Map<string, CandidateResult>();

    const evaluateMatch = (
      token: string,
      candName: string | null | undefined,
      source: string,
      details?: Partial<CandidateResult>
    ) => {
      if (!candName) return;

      const t = token.toLowerCase().trim();
      const c = candName.toLowerCase().trim();

      const cleanT = t.replace(/\s+/g, '');
      const cleanC = c.replace(/\s+/g, '');

      // 1. Prefix Match (starts-with check on space-stripped names)
      let prefixVal = 0;
      if (cleanT.length >= 3 && (cleanC.startsWith(cleanT) || cleanT.startsWith(cleanC))) {
        prefixVal = 1.0;
      } else if (c.startsWith(t) || t.startsWith(c)) {
        prefixVal = Math.min(t.length, c.length) / Math.max(t.length, c.length);
      }

      // 2. Edit Match (Levenshtein distance on space-stripped names)
      const cleanDistance = this.levenshtein(cleanT, cleanC);
      const maxLength = Math.max(cleanT.length, cleanC.length);
      const editVal = maxLength > 0 ? (1 - cleanDistance / maxLength) : 0;

      // 3. Token Match (supports prefix overlaps in sub-tokens)
      const tTokens = t.split(/\s+/);
      const cTokens = c.split(/\s+/);
      let matchCount = 0;
      for (const tt of tTokens) {
        if (cTokens.some(ct => ct.includes(tt) || tt.includes(ct))) {
          matchCount++;
        }
      }
      const tokenVal = tTokens.length > 0 ? (matchCount / Math.max(tTokens.length, cTokens.length)) : 0;

      // 4. AI Verification Match
      const aiVal = aiScore;

      // 5. History Match
      const isHistory =
        userMeds.some(m => m.name.toLowerCase() === c || m.brandName?.toLowerCase() === c) ||
        corrections.some(corr => corr.correctedName.toLowerCase() === c);
      const historyVal = isHistory ? 1.0 : 0.0;

      // Weighted Formula: final = 0.30 prefix + 0.20 edit + 0.20 token + 0.15 AI + 0.15 history
      const finalScore = (0.30 * prefixVal) + (0.20 * editVal) + (0.20 * tokenVal) + (0.15 * aiVal) + (0.15 * historyVal);

      // Filter and accept >= 0.55
      if (finalScore >= 0.55) {
        const key = c;
        const existing = candidatesMap.get(key);
        if (!existing || existing.similarity < finalScore) {
          candidatesMap.set(key, {
            candidate: candName,
            similarity: finalScore,
            source,
            brandName: details?.brandName || candName,
            genericName: details?.genericName || null,
            strength: details?.strength || null,
            category: details?.category || null,
            composition: details?.composition || null,
          });
        }
      }
    };

    // Evaluate tokens
    for (const token of tokens) {
      if (token.length < 3) continue;

      // Match corrections
      for (const corr of corrections) {
        evaluateMatch(token, corr.correctedName, 'USER_CORRECTION', { brandName: corr.correctedName });
      }

      // Match master DB
      for (const master of masterMeds) {
        evaluateMatch(token, master.brandName, 'MEDICINE_MASTER', {
          brandName: master.brandName,
          genericName: master.genericName,
          strength: master.strength,
          category: master.category,
          composition: master.composition || master.genericName,
        });
        evaluateMatch(token, master.genericName, 'MEDICINE_MASTER', {
          brandName: master.brandName,
          genericName: master.genericName,
          strength: master.strength,
          category: master.category,
          composition: master.composition || master.genericName,
        });
      }

      // Match user medicine history
      for (const med of userMeds) {
        evaluateMatch(token, med.name, 'PREVIOUS_MEDICINES', {
          brandName: med.brandName,
          genericName: med.genericName,
          strength: med.strength,
        });
      }

      // Match static aliases fallback
      for (const alias of CandidateGeneratorService.ALIAS_KNOWLEDGE) {
        evaluateMatch(token, alias, 'STATIC_KNOWLEDGE');
      }

      // Phonetic matching (Soundex fallback)
      const tokenSoundex = this.soundex(token);
      for (const master of masterMeds) {
        if (this.soundex(master.brandName) === tokenSoundex) {
          evaluateMatch(token, master.brandName, 'PHONETIC_MATCH', {
            brandName: master.brandName,
            genericName: master.genericName,
            strength: master.strength,
            category: master.category,
          });
        }
      }
    }

    return Array.from(candidatesMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .split(/[^a-zA-Z0-9]/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);
  }

  private levenshtein(s1: string, s2: string): number {
    const track = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= s2.length; j += 1) {
      for (let i = 1; i <= s1.length; i += 1) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator,
        );
      }
    }
    return track[s2.length][s1.length];
  }

  private soundex(str: string): string {
    const a = str.toLowerCase().split('');
    if (a.length === 0) return '0000';
    const first = a[0];
    const codes = {
      b: 1, f: 1, p: 1, v: 1,
      c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2,
      d: 3, t: 3,
      l: 4,
      m: 5, n: 5,
      r: 6
    };
    const r = [first.toUpperCase()];
    for (let i = 1; i < a.length; i++) {
      const code = codes[a[i] as keyof typeof codes];
      if (code) {
        if (String(code) !== r[r.length - 1]) {
          r.push(String(code));
        }
      } else {
        r.push('0');
      }
    }
    return r.filter((x) => x !== '0').slice(0, 4).join('').padEnd(4, '0');
  }
}
