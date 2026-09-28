import { PrismaClient, UserRole, MedicineForm, ScheduleFrequency, DoseStatus, DoseBarrierReason, DoseActionSource, MetricType, MetricSource, MetricQuality, CarePermission, CareRelationshipStatus, AllergyCategory, AllergyCriticality, AllergyClinicalStatus, SafetyVerificationStatus, SafetyRecordSource, MedicationSafetyRule, MedicationSafetySeverity, MedicationSafetyFindingStatus, DoctorReportSection } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding industry-ready Remote Patient Monitoring (RPM) clinical demo dataset...');

  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Upsert Demo Patient: Ramesh Sharma (68y, Chronic Care RPM Patient)
  const patientEmail = 'ramesh.sharma@meditrack.ai';
  const patient = await prisma.user.upsert({
    where: { email: patientEmail },
    update: {
      isActive: true,
      isVerified: true,
      role: UserRole.PATIENT,
      passwordHash,
    },
    create: {
      email: patientEmail,
      phone: '+919876543210',
      passwordHash,
      role: UserRole.PATIENT,
      isActive: true,
      isVerified: true,
    },
  });

  await prisma.patientProfile.upsert({
    where: { userId: patient.id },
    update: {
      firstName: 'Ramesh',
      lastName: 'Sharma',
      dateOfBirth: new Date('1958-04-15'),
      gender: 'Male',
      bloodGroup: 'B+',
      height: 172.0,
      weight: 76.5,
      allergies: ['Penicillin', 'Amoxicillin'],
      conditions: ['Essential Hypertension', 'Type 2 Diabetes Mellitus', 'Dyslipidemia'],
      emergencyContact: 'Priya Sharma (Daughter)',
      emergencyPhone: '+919876543210',
      notes: 'Monitored under Remote Patient Monitoring (RPM) Chronic Care Program. High risk for missed anti-hypertensive doses.',
    },
    create: {
      userId: patient.id,
      firstName: 'Ramesh',
      lastName: 'Sharma',
      dateOfBirth: new Date('1958-04-15'),
      gender: 'Male',
      bloodGroup: 'B+',
      height: 172.0,
      weight: 76.5,
      allergies: ['Penicillin', 'Amoxicillin'],
      conditions: ['Essential Hypertension', 'Type 2 Diabetes Mellitus', 'Dyslipidemia'],
      emergencyContact: 'Priya Sharma (Daughter)',
      emergencyPhone: '+919876543210',
      notes: 'Monitored under Remote Patient Monitoring (RPM) Chronic Care Program. High risk for missed anti-hypertensive doses.',
    },
  });

  // 2. Upsert Demo Caregiver: Priya Sharma (Daughter & Primary Caregiver)
  const caregiverEmail = 'priya.sharma@meditrack.ai';
  const caregiver = await prisma.user.upsert({
    where: { email: caregiverEmail },
    update: {
      isActive: true,
      isVerified: true,
      role: UserRole.CAREGIVER,
      passwordHash,
    },
    create: {
      email: caregiverEmail,
      phone: '+919876543211',
      passwordHash,
      role: UserRole.CAREGIVER,
      isActive: true,
      isVerified: true,
    },
  });

  await prisma.patientProfile.upsert({
    where: { userId: caregiver.id },
    update: {
      firstName: 'Priya',
      lastName: 'Sharma',
      gender: 'Female',
    },
    create: {
      userId: caregiver.id,
      firstName: 'Priya',
      lastName: 'Sharma',
      gender: 'Female',
    },
  });

  // 3. Establish Care Relationship with Full RPM Permissions
  await prisma.careRelationship.upsert({
    where: {
      patientId_caregiverId: {
        patientId: patient.id,
        caregiverId: caregiver.id,
      },
    },
    update: {
      status: CareRelationshipStatus.ACTIVE,
      permissions: [
        CarePermission.VIEW_ADHERENCE,
        CarePermission.VIEW_MEDICATIONS,
        CarePermission.VIEW_MEDICATION_SAFETY,
        CarePermission.VIEW_REFILLS,
        CarePermission.RECEIVE_MISSED_DOSE_ALERTS,
        CarePermission.RECEIVE_DOSE_HELP_REQUESTS,
      ],
    },
    create: {
      patientId: patient.id,
      caregiverId: caregiver.id,
      status: CareRelationshipStatus.ACTIVE,
      permissions: [
        CarePermission.VIEW_ADHERENCE,
        CarePermission.VIEW_MEDICATIONS,
        CarePermission.VIEW_MEDICATION_SAFETY,
        CarePermission.VIEW_REFILLS,
        CarePermission.RECEIVE_MISSED_DOSE_ALERTS,
        CarePermission.RECEIVE_DOSE_HELP_REQUESTS,
      ],
      consentVersion: 'v1.0',
      patientConsentedAt: new Date(Date.now() - 30 * 86400000),
      caregiverAcknowledgedAt: new Date(Date.now() - 30 * 86400000),
    },
  });

  // 4. Upsert Chronic RPM Medicines
  const medicinesData = [
    {
      name: 'Telmisartan 40mg',
      genericName: 'Telmisartan',
      brandName: 'Telma 40',
      form: MedicineForm.TABLET,
      strength: '40mg',
      instructions: 'Take 1 tablet every morning with water before breakfast',
      totalQuantity: 30,
      remainingQuantity: 18,
      unit: 'tablets',
      refillThreshold: 5,
      frequency: ScheduleFrequency.DAILY,
      times: ['08:00'],
      color: '#3B82F6',
    },
    {
      name: 'Metformin 500mg',
      genericName: 'Metformin Hydrochloride',
      brandName: 'Glycomet 500',
      form: MedicineForm.TABLET,
      strength: '500mg',
      instructions: 'Take 1 tablet twice daily with or after meals',
      totalQuantity: 60,
      remainingQuantity: 38,
      unit: 'tablets',
      refillThreshold: 10,
      frequency: ScheduleFrequency.TWICE_DAILY,
      times: ['08:30', '20:30'],
      color: '#10B981',
    },
    {
      name: 'Atorvastatin 10mg',
      genericName: 'Atorvastatin Calcium',
      brandName: 'Atorva 10',
      form: MedicineForm.TABLET,
      strength: '10mg',
      instructions: 'Take 1 tablet at night after dinner',
      totalQuantity: 30,
      remainingQuantity: 21,
      unit: 'tablets',
      refillThreshold: 5,
      frequency: ScheduleFrequency.DAILY,
      times: ['21:00'],
      color: '#8B5CF6',
    },
    {
      name: 'Dolo 650',
      genericName: 'Paracetamol',
      brandName: 'Dolo 650',
      form: MedicineForm.TABLET,
      strength: '650mg',
      instructions: 'SOS 1 tablet for fever or headache (Max 3/day)',
      totalQuantity: 15,
      remainingQuantity: 12,
      unit: 'tablets',
      refillThreshold: 3,
      frequency: ScheduleFrequency.AS_NEEDED,
      times: ['14:00'],
      color: '#F59E0B',
    },
  ];

  const createdMedicines: Array<{ med: any; schedule: any }> = [];

  for (const item of medicinesData) {
    let medicine = await prisma.medicine.findFirst({
      where: { userId: patient.id, name: item.name },
    });

    if (!medicine) {
      medicine = await prisma.medicine.create({
        data: {
          userId: patient.id,
          name: item.name,
          genericName: item.genericName,
          brandName: item.brandName,
          form: item.form,
          strength: item.strength,
          instructions: item.instructions,
          totalQuantity: item.totalQuantity,
          remainingQuantity: item.remainingQuantity,
          unit: item.unit,
          refillThreshold: item.refillThreshold,
          color: item.color,
        },
      });
    }

    let schedule = await prisma.medicineSchedule.findFirst({
      where: { medicineId: medicine.id },
    });

    if (!schedule) {
      schedule = await prisma.medicineSchedule.create({
        data: {
          userId: patient.id,
          medicineId: medicine.id,
          frequency: item.frequency,
          timesOfDay: item.times,
          startDate: new Date(Date.now() - 30 * 86400000),
          isActive: true,
        },
      });
    }

    createdMedicines.push({ med: medicine, schedule });
  }

  // 5. Seed 30 Days of Historical Dose Logs & Vitals with Realistic Correlation
  console.log('📊 Seeding 30 days of physiological vitals & adherence cross-correlation telemetry...');

  // Clean existing dose logs and metrics for this patient to prevent duplicate collisions
  await prisma.doseLog.deleteMany({ where: { userId: patient.id } });
  await prisma.healthMetric.deleteMany({ where: { userId: patient.id } });

  const now = new Date();

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const targetDate = new Date(now.getTime() - dayOffset * 86400000);

    // Day 4 and Day 11 were missed anti-hypertensive days (to prove the BP spike correlation!)
    const isMissedAntiHypertensiveDay = dayOffset === 4 || dayOffset === 11;

    // Create Dose Logs for each medicine
    for (const { med, schedule } of createdMedicines) {
      for (const timeStr of (schedule.timesOfDay as string[])) {
        const [hh, mm] = timeStr.split(':').map(Number);
        const scheduledAt = new Date(targetDate);
        scheduledAt.setHours(hh, mm, 0, 0);

        let status: DoseStatus = DoseStatus.TAKEN;
        let barrierReason: DoseBarrierReason | null = null;
        let notes: string | null = null;

        if (dayOffset === 0) {
          // Today's doses
          if (hh < now.getHours()) {
            status = DoseStatus.TAKEN;
          } else {
            status = DoseStatus.PENDING;
          }
        } else if (med.name.includes('Telmisartan') && isMissedAntiHypertensiveDay) {
          status = DoseStatus.MISSED;
          barrierReason = dayOffset === 4 ? DoseBarrierReason.SIDE_EFFECT_CONCERN : DoseBarrierReason.AWAY_FROM_HOME;
          notes = dayOffset === 4 ? 'Patient reported mild morning dizziness' : 'Patient traveled out of town';
        } else if (Math.random() < 0.05) {
          status = DoseStatus.SKIPPED;
          barrierReason = DoseBarrierReason.FORGOT;
        }

        await prisma.doseLog.create({
          data: {
            userId: patient.id,
            medicineId: med.id,
            scheduleId: schedule.id,
            scheduledAt,
            actionAt: status === DoseStatus.TAKEN ? new Date(scheduledAt.getTime() + 15 * 60000) : null,
            status,
            barrierReason,
            notes,
            actionSource: DoseActionSource.APP,
          },
        });
      }
    }

    // Physiological Vitals Generation:
    // Normal baseline: BP 120/80, HR 74, SpO2 98%, Glucose 115
    // On missed anti-hypertensive days: BP spikes to 148/95 mmHg!
    const systolic = isMissedAntiHypertensiveDay ? 148 + Math.floor(Math.random() * 6) : 118 + Math.floor(Math.random() * 8);
    const diastolic = isMissedAntiHypertensiveDay ? 94 + Math.floor(Math.random() * 5) : 78 + Math.floor(Math.random() * 5);
    const heartRate = 72 + Math.floor(Math.random() * 8);
    const spo2 = 97 + Math.floor(Math.random() * 3);
    const glucose = 110 + Math.floor(Math.random() * 20);

    const morningTime = new Date(targetDate);
    morningTime.setHours(8, 15, 0, 0);

    // 1. Blood Pressure
    await prisma.healthMetric.create({
      data: {
        userId: patient.id,
        metricType: MetricType.BLOOD_PRESSURE,
        value: { systolic, diastolic, pulse: heartRate },
        unit: 'mmHg',
        recordedAt: morningTime,
        source: MetricSource.HEALTH_CONNECT,
        quality: MetricQuality.DEVICE_REPORTED,
        safetyAssessment: isMissedAntiHypertensiveDay
          ? { severity: 'WARNING', reasonCode: 'ELEVATED_BP_MISSED_DOSE', isDiagnosis: false }
          : { severity: 'NORMAL', reasonCode: 'WITHIN_GOAL', isDiagnosis: false },
      },
    });

    // 2. Heart Rate
    await prisma.healthMetric.create({
      data: {
        userId: patient.id,
        metricType: MetricType.HEART_RATE,
        value: { heartRate },
        unit: 'bpm',
        recordedAt: morningTime,
        source: MetricSource.HEALTH_CONNECT,
        quality: MetricQuality.DEVICE_REPORTED,
      },
    });

    // 3. Oxygen Saturation (SpO2)
    await prisma.healthMetric.create({
      data: {
        userId: patient.id,
        metricType: MetricType.OXYGEN_SATURATION,
        value: { oxygenSaturation: spo2 },
        unit: '%',
        recordedAt: morningTime,
        source: MetricSource.HEALTH_CONNECT,
        quality: MetricQuality.DEVICE_REPORTED,
      },
    });

    // 4. Blood Glucose
    await prisma.healthMetric.create({
      data: {
        userId: patient.id,
        metricType: MetricType.BLOOD_GLUCOSE,
        value: { glucose, mealStatus: 'FASTING' },
        unit: 'mg/dL',
        recordedAt: morningTime,
        source: MetricSource.HEALTH_CONNECT,
        quality: MetricQuality.DEVICE_REPORTED,
      },
    });
  }

  // 6. Seed Active Allergy & Medication Safety Finding
  await prisma.allergyIntolerance.deleteMany({ where: { userId: patient.id } });
  await prisma.allergyIntolerance.create({
    data: {
      userId: patient.id,
      substanceRaw: 'Penicillin',
      normalizedSubstance: 'penicillin',
      category: AllergyCategory.ALLERGY,
      criticality: AllergyCriticality.HIGH,
      reaction: 'Severe urticaria and mild bronchospasm',
      clinicalStatus: AllergyClinicalStatus.ACTIVE,
      verificationStatus: SafetyVerificationStatus.CONFIRMED,
      source: SafetyRecordSource.CLINICIAN,
    },
  });

  await prisma.medicationSafetyFinding.deleteMany({ where: { userId: patient.id } });
  await prisma.medicationSafetyFinding.create({
    data: {
      userId: patient.id,
      fingerprint: `demo-finding-${patient.id}-penicillin-allergy`,
      rule: MedicationSafetyRule.ALLERGY_CONFLICT,
      severity: MedicationSafetySeverity.HIGH,
      status: MedicationSafetyFindingStatus.OPEN,
      title: 'High Criticality Penicillin Allergy Profile Active',
      summary: 'Patient has confirmed severe hypersensitivity to beta-lactam penicillins. Cross-reactive prescriptions will be intercepted.',
      triggerIngredients: ['penicillin', 'amoxicillin', 'ampicillin'],
      evidence: { source: 'CLINICAL_ALLERGY_RECORD', reaction: 'Anaphylactoid / Bronchospasm' },
    },
  });

  // 7. Seed Pre-Generated Doctor Visit Report
  await prisma.doctorVisitReport.deleteMany({ where: { userId: patient.id } });
  await prisma.doctorVisitReport.create({
    data: {
      userId: patient.id,
      title: '30-Day Comprehensive RPM Adherence & Physiological Correlation Report',
      rangeStart: new Date(now.getTime() - 30 * 86400000),
      rangeEnd: now,
      sections: [
        DoctorReportSection.MEDICATIONS,
        DoctorReportSection.ADHERENCE,
        DoctorReportSection.VITALS,
        DoctorReportSection.ALLERGIES,
        DoctorReportSection.SAFETY,
      ],
      snapshot: {
        overallAdherence: 91.5,
        totalDoses: 120,
        takenDoses: 110,
        missedDoses: 6,
        skippedDoses: 4,
        adherenceByMedicine: [
          { name: 'Telmisartan 40mg', adherence: 86.6, missedDays: ['Day -4', 'Day -11'], barrier: 'Side-effect / Nausea' },
          { name: 'Metformin 500mg', adherence: 95.0 },
          { name: 'Atorvastatin 10mg', adherence: 93.3 },
        ],
        vitalsSummary: {
          averageBP: '124/82 mmHg',
          maxBP: '152/96 mmHg (Correlating with Day -4 Telmisartan omission)',
          averageHeartRate: '75 bpm',
          averageSpO2: '98%',
          averageFastingGlucose: '118 mg/dL',
        },
        clinicalConclusion: 'Patient demonstrates strong overall compliance (91.5%). Blood pressure elevation directly coincides with missed Telmisartan doses. Recommended: Maintain current regimen with caregiver check-in support.',
      },
    },
  });

  // 8. Seed Realistic Caregiver Notification Logs for Priya Sharma
  await prisma.notificationLog.deleteMany({ where: { userId: caregiver.id } });
  
  await prisma.notificationLog.createMany({
    data: [
      {
        userId: caregiver.id,
        title: '🚨 MISSED DOSE ESCALATION: Ramesh Sharma',
        body: 'Ramesh has not confirmed his 08:00 AM Telmisartan 40mg (Blood Pressure) dose within the 30-minute window. Please check in with him.',
        channel: 'LOCAL',
        isRead: false,
        sentAt: new Date(now.getTime() - 2 * 3600000), // 2 hours ago
        metadata: { patientId: patient.id, type: 'MISSED_DOSE_ESCALATION', medicineName: 'Telmisartan 40mg' },
      },
      {
        userId: caregiver.id,
        title: '⚠️ ELEVATED BLOOD PRESSURE TELEMETRY',
        body: 'Wearable Health Connect reported an elevated BP reading (148/95 mmHg) for Ramesh following a missed morning dose.',
        channel: 'LOCAL',
        isRead: false,
        sentAt: new Date(now.getTime() - 1 * 86400000), // Yesterday
        metadata: { patientId: patient.id, type: 'VITAL_ANOMALY', systolic: 148, diastolic: 95 },
      },
      {
        userId: caregiver.id,
        title: '🛡️ CARE CIRCLE PERMISSIONS ACTIVE',
        body: 'Ramesh Sharma granted you Primary Caregiver monitoring access: View Adherence, Medications, Vitals Telemetry, and Missed Dose Alerts.',
        channel: 'LOCAL',
        isRead: true,
        sentAt: new Date(now.getTime() - 7 * 86400000),
        metadata: { patientId: patient.id, type: 'CARE_INVITATION_ACCEPTED' },
      },
      {
        userId: caregiver.id,
        title: '📦 LOW REFILL THRESHOLD ADVISORY',
        body: 'Ramesh’s Metformin 500mg prescription has reached 10 remaining tablets. Consider reordering soon.',
        channel: 'LOCAL',
        isRead: true,
        sentAt: new Date(now.getTime() - 3 * 86400000),
        metadata: { patientId: patient.id, type: 'LOW_STOCK_ALERT', medicineName: 'Metformin 500mg' },
      },
    ],
  });

  // 9. Seed Realistic Patient Notification Logs for Ramesh Sharma (Dose Reminders with Strip Verification)
  await prisma.notificationLog.deleteMany({ where: { userId: patient.id } });
  await prisma.notificationLog.createMany({
    data: [
      {
        userId: patient.id,
        title: '⏰ Time to take your medicine',
        body: 'Telmisartan 40mg - 1 tablet scheduled for 08:00 AM. Please verify your blister strip before taking.',
        channel: 'LOCAL',
        isRead: false,
        sentAt: new Date(now.getTime() - 15 * 60000), // 15 mins ago
        metadata: {
          type: 'DOSE_REMINDER',
          medicineName: 'Telmisartan 40mg',
          strength: '40mg',
          doseTime: '08:00 AM',
          scheduleId: createdMedicines[0]?.schedule?.id,
        },
      },
      {
        userId: patient.id,
        title: '💊 Time to take your medicine',
        body: 'Metformin 500mg - 1 tablet scheduled for 01:00 PM with or after lunch.',
        channel: 'LOCAL',
        isRead: false,
        sentAt: new Date(now.getTime() - 60 * 60000), // 1 hour ago
        metadata: {
          type: 'DOSE_REMINDER',
          medicineName: 'Metformin 500mg',
          strength: '500mg',
          doseTime: '01:00 PM',
          scheduleId: createdMedicines[1]?.schedule?.id,
        },
      },
      {
        userId: patient.id,
        title: '🌙 Upcoming Night Medication',
        body: 'Atorvastatin 10mg - 1 tablet scheduled for 09:00 PM before bedtime.',
        channel: 'LOCAL',
        isRead: true,
        sentAt: new Date(now.getTime() - 8 * 3600000),
        metadata: {
          type: 'DOSE_REMINDER',
          medicineName: 'Atorvastatin 10mg',
          strength: '10mg',
          doseTime: '09:00 PM',
          scheduleId: createdMedicines[2]?.schedule?.id,
        },
      },
      {
        userId: patient.id,
        title: '📦 Low Stock Alert: Dolo 650',
        body: 'Your stock for Dolo 650 is at 4 tablets. Tap to reorder via Apollo Pharmacy.',
        channel: 'LOCAL',
        isRead: true,
        sentAt: new Date(now.getTime() - 24 * 3600000),
        metadata: {
          type: 'LOW_STOCK_ALERT',
          medicineName: 'Dolo 650',
          actionUrl: '/refills',
        },
      },
    ],
  });

  console.log('✅ Demo RPM Patient & Caregiver successfully seeded:');
  console.log(`   👤 Patient Email:   ${patientEmail}`);
  console.log(`   🔑 Patient Password: Password@123`);
  console.log(`   👩‍👧 Caregiver Email: ${caregiverEmail}`);
  console.log(`   🔑 Caregiver Pass:   Password@123`);
  console.log(`   📊 Vitals Seeded:   30 Days continuous BP, SpO2, HR, Glucose via Health Connect`);
  console.log(`   🔔 Caregiver Alerts: Real in-app alerts populated for Priya Sharma in Caregiver Portal!`);
  console.log(`   📄 Doctor Report:   Pre-compiled with Adherence vs. Vital spike correlation ready for demo!`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding demo patient:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

