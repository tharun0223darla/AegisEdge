import { Injectable } from '@nestjs/common';

export interface NEWS2VitalsInput {
  respiratoryRate?: number; // breaths/min (default 16)
  oxygenSaturation?: number; // SpO2 %
  supplementalOxygen?: boolean; // default false
  systolicBP?: number; // mmHg
  heartRate?: number; // bpm
  consciousness?: 'ALERT' | 'CONFUSION' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE'; // default ALERT
  temperature?: number; // Celsius (default 36.8)
}

export interface NEWS2ParameterScore {
  name: string;
  value: string | number;
  score: number;
  rating: 'NORMAL' | 'MILD_ANOMALY' | 'MODERATE_ANOMALY' | 'SEVERE_ANOMALY';
}

export interface NEWS2AssessmentResult {
  totalScore: number;
  clinicalRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  responseLevel:
    | 'ROUTINE_MONITORING'
    | 'URGENT_PHYSICIAN_REVIEW'
    | 'EMERGENCY_CRITICAL_RESPONSE';
  headline: string;
  actionSummary: string;
  predictiveDecompensationWindow: string | null;
  parameterBreakdown: NEWS2ParameterScore[];
  assessedAt: string;
}

@Injectable()
export class News2ScorerService {
  /**
   * Score an individual parameter based on Royal College of Physicians NEWS2 standard.
   */
  scoreRespiratoryRate(rate = 16): NEWS2ParameterScore {
    let score = 0;
    let rating: NEWS2ParameterScore['rating'] = 'NORMAL';

    if (rate <= 8) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    } else if (rate >= 9 && rate <= 11) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (rate >= 12 && rate <= 20) {
      score = 0;
      rating = 'NORMAL';
    } else if (rate >= 21 && rate <= 24) {
      score = 2;
      rating = 'MODERATE_ANOMALY';
    } else if (rate >= 25) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    }

    return { name: 'Respiration Rate', value: `${rate} breaths/min`, score, rating };
  }

  scoreOxygenSaturation(spo2 = 98): NEWS2ParameterScore {
    let score = 0;
    let rating: NEWS2ParameterScore['rating'] = 'NORMAL';

    if (spo2 <= 91) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    } else if (spo2 >= 92 && spo2 <= 93) {
      score = 2;
      rating = 'MODERATE_ANOMALY';
    } else if (spo2 >= 94 && spo2 <= 95) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else {
      score = 0;
      rating = 'NORMAL';
    }

    return { name: 'Oxygen Saturation (SpO2)', value: `${spo2}%`, score, rating };
  }

  scoreSupplementalOxygen(onOxygen = false): NEWS2ParameterScore {
    return {
      name: 'Supplemental Oxygen',
      value: onOxygen ? 'Yes (Oxygen Therapy)' : 'No (Room Air)',
      score: onOxygen ? 2 : 0,
      rating: onOxygen ? 'MODERATE_ANOMALY' : 'NORMAL',
    };
  }

  scoreSystolicBP(systolic = 122): NEWS2ParameterScore {
    let score = 0;
    let rating: NEWS2ParameterScore['rating'] = 'NORMAL';

    if (systolic <= 90) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    } else if (systolic >= 91 && systolic <= 100) {
      score = 2;
      rating = 'MODERATE_ANOMALY';
    } else if (systolic >= 101 && systolic <= 110) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (systolic >= 111 && systolic <= 219) {
      score = 0;
      rating = 'NORMAL';
    } else if (systolic >= 220) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    }

    return { name: 'Systolic Blood Pressure', value: `${systolic} mmHg`, score, rating };
  }

  scoreHeartRate(hr = 74): NEWS2ParameterScore {
    let score = 0;
    let rating: NEWS2ParameterScore['rating'] = 'NORMAL';

    if (hr <= 40) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    } else if (hr >= 41 && hr <= 50) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (hr >= 51 && hr <= 90) {
      score = 0;
      rating = 'NORMAL';
    } else if (hr >= 91 && hr <= 110) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (hr >= 111 && hr <= 130) {
      score = 2;
      rating = 'MODERATE_ANOMALY';
    } else if (hr >= 131) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    }

    return { name: 'Heart Rate (Pulse)', value: `${hr} bpm`, score, rating };
  }

  scoreConsciousness(avpu: NEWS2VitalsInput['consciousness'] = 'ALERT'): NEWS2ParameterScore {
    const isAlert = avpu === 'ALERT';
    return {
      name: 'Consciousness / Alertness',
      value: avpu,
      score: isAlert ? 0 : 3,
      rating: isAlert ? 'NORMAL' : 'SEVERE_ANOMALY',
    };
  }

  scoreTemperature(temp = 36.8): NEWS2ParameterScore {
    let score = 0;
    let rating: NEWS2ParameterScore['rating'] = 'NORMAL';

    if (temp <= 35.0) {
      score = 3;
      rating = 'SEVERE_ANOMALY';
    } else if (temp >= 35.1 && temp <= 36.0) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (temp >= 36.1 && temp <= 38.0) {
      score = 0;
      rating = 'NORMAL';
    } else if (temp >= 38.1 && temp <= 39.0) {
      score = 1;
      rating = 'MILD_ANOMALY';
    } else if (temp >= 39.1) {
      score = 2;
      rating = 'MODERATE_ANOMALY';
    }

    return { name: 'Body Temperature', value: `${temp}°C`, score, rating };
  }

  /**
   * Compute comprehensive NEWS2 score and clinical deterioration risk.
   */
  assess(input: NEWS2VitalsInput): NEWS2AssessmentResult {
    const breakdown: NEWS2ParameterScore[] = [
      this.scoreRespiratoryRate(input.respiratoryRate),
      this.scoreOxygenSaturation(input.oxygenSaturation),
      this.scoreSupplementalOxygen(input.supplementalOxygen),
      this.scoreSystolicBP(input.systolicBP),
      this.scoreHeartRate(input.heartRate),
      this.scoreConsciousness(input.consciousness),
      this.scoreTemperature(input.temperature),
    ];

    const totalScore = breakdown.reduce((acc, curr) => acc + curr.score, 0);
    const hasExtremeSingleParameter = breakdown.some((p) => p.score === 3);

    let clinicalRisk: NEWS2AssessmentResult['clinicalRisk'] = 'LOW';
    let responseLevel: NEWS2AssessmentResult['responseLevel'] = 'ROUTINE_MONITORING';
    let headline = 'Physiological Baseline Stable (Low Risk)';
    let actionSummary =
      'Routine remote monitoring. Biomarkers are within normal physiological bounds.';
    let predictiveDecompensationWindow: string | null = null;

    if (totalScore >= 7) {
      clinicalRisk = 'HIGH';
      responseLevel = 'EMERGENCY_CRITICAL_RESPONSE';
      headline = '🚨 CRITICAL CLINICAL RISK (NEWS2 >= 7): Impending Emergency';
      actionSummary =
        'Immediate emergency clinical response required. Continuous multi-parameter monitoring, physician bedside/tele-ICU intervention, or 108 emergency escalation.';
      predictiveDecompensationWindow =
        'Immediate acute decompensation in progress (< 1 hour window).';
    } else if (totalScore >= 5 || hasExtremeSingleParameter) {
      clinicalRisk = 'MEDIUM';
      responseLevel = 'URGENT_PHYSICIAN_REVIEW';
      headline = '⚠️ MEDIUM CLINICAL RISK (NEWS2 5-6 or Single Red Parameter)';
      actionSummary =
        'Urgent physician assessment required. Adjust medication regimen and recheck biomarkers within 1-2 hours.';
      predictiveDecompensationWindow =
        'Impending physiological decompensation detected in 6 to 12 hour window if unaddressed.';
    } else if (totalScore >= 1) {
      clinicalRisk = 'LOW';
      responseLevel = 'ROUTINE_MONITORING';
      headline = 'Mild Physiological Variation (NEWS2 1-4)';
      actionSummary =
        'Mild single-parameter deviation. Continue standard scheduled doses and re-measure at next scheduled interval.';
      predictiveDecompensationWindow =
        'Physiological trajectory stable. No acute deterioration forecasted.';
    }

    return {
      totalScore,
      clinicalRisk,
      responseLevel,
      headline,
      actionSummary,
      predictiveDecompensationWindow,
      parameterBreakdown: breakdown,
      assessedAt: new Date().toISOString(),
    };
  }
}
