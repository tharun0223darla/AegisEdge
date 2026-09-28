import { Injectable } from '@nestjs/common';
import type {
  HealthMetricQuality,
  HealthMetricType,
} from './health-metric.types';
import type { NormalizedMetricValue } from './health-observation-validator.service';

export const HEALTH_SAFETY_RULE_VERSION = 'wellness-triage-v1';

export type HealthSafetyStatus =
  | 'NORMAL'
  | 'VERIFY_READING'
  | 'RECHECK'
  | 'CONTACT_CLINICIAN'
  | 'URGENT_HELP';

export interface HealthSafetyAssessment {
  ruleVersion: string;
  status: HealthSafetyStatus;
  severity: 'INFO' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasonCode: string;
  message: string;
  requiresNotification: boolean;
  isDiagnosis: false;
}

@Injectable()
export class HealthSafetyRulesService {
  assess(
    metricType: HealthMetricType,
    value: NormalizedMetricValue,
    quality: HealthMetricQuality,
  ): HealthSafetyAssessment {
    if (quality === 'QUESTIONABLE') {
      return this.result(
        'VERIFY_READING',
        'MEDIUM',
        'UNVERIFIED_SOURCE',
        'This reading came from an unverified or simulated source. Confirm it with a supported device before acting on it.',
        false,
      );
    }

    switch (metricType) {
      case 'BLOOD_PRESSURE':
        return this.assessBloodPressure(value);
      case 'BLOOD_GLUCOSE':
        return this.assessBloodGlucose(value);
      case 'HEART_RATE':
        return this.assessHeartRate(value);
      case 'OXYGEN_SATURATION':
        return this.assessOxygenSaturation(value);
      case 'SLEEP_HOURS':
      default:
        return this.normal();
    }
  }

  private assessBloodPressure(
    value: NormalizedMetricValue,
  ): HealthSafetyAssessment {
    const systolic = Number(value.systolic);
    const diastolic = Number(value.diastolic);
    if (systolic >= 180 || diastolic >= 120) {
      return this.result(
        'URGENT_HELP',
        'CRITICAL',
        'BP_VERY_HIGH',
        'This blood-pressure reading is very high. Sit quietly and recheck correctly. Seek urgent medical help if it remains this high or you have concerning symptoms.',
        true,
      );
    }
    if (systolic >= 140 || diastolic >= 90) {
      return this.result(
        'RECHECK',
        'HIGH',
        'BP_ELEVATED',
        'This blood-pressure reading is elevated. Rest, repeat the measurement correctly, and contact your clinician if readings remain elevated.',
        true,
      );
    }
    if (systolic < 90 || diastolic < 60) {
      return this.result(
        'RECHECK',
        'MEDIUM',
        'BP_LOW',
        'This blood-pressure reading is lower than the general reference range. Recheck it and seek medical advice if you feel unwell.',
        true,
      );
    }
    return this.normal();
  }

  private assessBloodGlucose(
    value: NormalizedMetricValue,
  ): HealthSafetyAssessment {
    const glucose = Number(value.glucose);
    const mealStatus = String(value.mealStatus);
    if (glucose < 54) {
      return this.result(
        'URGENT_HELP',
        'CRITICAL',
        'GLUCOSE_VERY_LOW',
        'This glucose reading is very low. Follow your clinician-approved low-glucose plan and seek urgent help if you have severe symptoms or cannot recheck safely.',
        true,
      );
    }
    if (glucose < 70) {
      return this.result(
        'RECHECK',
        'HIGH',
        'GLUCOSE_LOW',
        'This glucose reading is low. Follow your clinician-approved plan and recheck with a reliable meter.',
        true,
      );
    }
    if (glucose >= 300) {
      return this.result(
        'CONTACT_CLINICIAN',
        'CRITICAL',
        'GLUCOSE_VERY_HIGH',
        'This glucose reading is very high. Recheck it and seek prompt medical advice, especially if you feel unwell.',
        true,
      );
    }
    if ((mealStatus === 'FASTING' && glucose >= 126) || glucose >= 200) {
      return this.result(
        'RECHECK',
        'HIGH',
        'GLUCOSE_ELEVATED',
        'This glucose reading is elevated for the recorded context. Recheck it and discuss repeated readings with your clinician.',
        true,
      );
    }
    return this.normal();
  }

  private assessHeartRate(
    value: NormalizedMetricValue,
  ): HealthSafetyAssessment {
    const heartRate = Number(value.heartRate);
    const context = String(value.context);
    if (heartRate < 40 || heartRate > 150) {
      return this.result(
        'URGENT_HELP',
        'CRITICAL',
        'HEART_RATE_EXTREME',
        'This heart-rate reading is far outside the general resting range. Recheck it and seek urgent help if you have concerning symptoms.',
        true,
      );
    }
    if (context === 'RESTING' && (heartRate < 50 || heartRate > 100)) {
      return this.result(
        'RECHECK',
        'MEDIUM',
        'RESTING_HEART_RATE_OUTSIDE_RANGE',
        'This resting heart-rate reading is outside the general reference range. Rest, recheck it, and seek advice if it persists or you feel unwell.',
        true,
      );
    }
    return this.normal();
  }

  private assessOxygenSaturation(
    value: NormalizedMetricValue,
  ): HealthSafetyAssessment {
    const oxygenSaturation = Number(value.oxygenSaturation);
    if (oxygenSaturation <= 88) {
      return this.result(
        'URGENT_HELP',
        'CRITICAL',
        'OXYGEN_SATURATION_VERY_LOW',
        'This oxygen-saturation reading is very low. Recheck with warm, still hands and seek urgent medical help if it remains low or you are short of breath.',
        true,
      );
    }
    if (oxygenSaturation <= 92) {
      return this.result(
        'CONTACT_CLINICIAN',
        'HIGH',
        'OXYGEN_SATURATION_LOW',
        'This oxygen-saturation reading is low. Recheck it carefully and contact a clinician if it remains low.',
        true,
      );
    }
    return this.normal();
  }

  private normal(): HealthSafetyAssessment {
    return this.result(
      'NORMAL',
      'INFO',
      'NO_RULE_TRIGGERED',
      'No wellness safety rule was triggered by this reading. This is not a diagnosis.',
      false,
    );
  }

  private result(
    status: HealthSafetyStatus,
    severity: HealthSafetyAssessment['severity'],
    reasonCode: string,
    message: string,
    requiresNotification: boolean,
  ): HealthSafetyAssessment {
    return {
      ruleVersion: HEALTH_SAFETY_RULE_VERSION,
      status,
      severity,
      reasonCode,
      message,
      requiresNotification,
      isDiagnosis: false,
    };
  }
}
