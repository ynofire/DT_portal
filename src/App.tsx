import React, { useState } from 'react';
import { KioskHeader } from './components/KioskHeader';
import { KioskCoverPage } from './components/KioskCoverPage';
import { Step1PatientAuth } from './components/Step1PatientAuth';
import { Step2PainCategory } from './components/Step2PainCategory';
import { Step3MouthLocation } from './components/Step3MouthLocation';
import { Step4DetailedSurvey } from './components/Step4DetailedSurvey';
import { Step5CompletionRoute } from './components/Step5CompletionRoute';
import { StaffCallModal } from './components/StaffCallModal';
import { StaffQueueMonitor } from './components/StaffQueueMonitor';
import { TriageLoadingModal } from './components/TriageLoadingModal';
import { PatientInfo, SurveyState, DentalTriageQueueItem, TriageAreaType } from './types';
import { buildClinicalTriage, AREA_CATEGORIES, QUADRANT_LOCATIONS } from './lib/triageData';
import { addTriageRecord, generatePatientVisitIdentifiers } from './firebase';
import { stopSpeech, speakText } from './lib/tts';
import { Language } from './lib/i18n';

const INITIAL_PATIENT: PatientInfo = {
  name: '',
  age: 72,
  gender: '남성',
  phone: '',
  patientId: '',
  rrnFront: '',
  rrnBack: '',
  isForeigner: false,
  birthDate: '',
  passportOrArc: '',
  nationality: '대한민국',
};

const INITIAL_SURVEY: SurveyState = {
  step: 1,
  patient: INITIAL_PATIENT,
  selectedArea: null,
  selectedAreas: [],
  selectedSymptoms: [],
  selectedLocation: 'UR',
  onsetPeriod: '2~3일 전부터 시작됨',
  painType: '음식을 씹을 때 깜짝 놀랄 정도로 아픔',
  dailyImpact: '아픈 쪽으로는 전혀 씹지 못함',
  painScale: 4,
  medicalAlerts: [],

  // 상세 복용 약물 및 알러지 문진
  medicationsList: [],
  otherMedicationText: '',
  drugAllergies: [],
  otherAllergyText: '',
  hasNoMedications: false,
  hasNoAllergies: false,

  // 전문 상세 문진 필드 (NHS Mouth Care Matters 반영)
  specificSymptomDetail: '',
  dentureStatus: 'none',
  dentureWornAtNight: false,
  dentureComplaint: '',
  implantStatus: 'none',
  implantComplaint: '',
  cancerTreatmentHistory: 'none',
  hasDryMouth: false,
  dryMouthSeverity: 'mild',
  ulcerDuration: 'none',
  hasWhiteOrRedPatches: false,
  hasAngularCheilitis: false,
  hasSevereToothMobility: false,
  hasDysphagia: false,
  hasAcidReflux: false,
  hasHeartCondition: false,
};

export default function App() {
  const [survey, setSurvey] = useState<SurveyState>(INITIAL_SURVEY);
  const [language, setLanguage] = useState<Language>('ko');
  const [isZoom120, setIsZoom120] = useState<boolean>(false);
  const [isStaffCallOpen, setIsStaffCallOpen] = useState<boolean>(false);
  const [isQueueMonitorOpen, setIsQueueMonitorOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCoverPage, setIsCoverPage] = useState<boolean>(true);
  const [completedRecord, setCompletedRecord] = useState<DentalTriageQueueItem | null>(null);
  const [firestoreDocId, setFirestoreDocId] = useState<string>('');


  const toggleZoom120 = () => {
    const next = !isZoom120;
    setIsZoom120(next);
    if (next) {
      speakText(
        language === 'en'
          ? 'Magnifier mode enabled. Text size increased by 120%.'
          : '돋보기 모드가 켜졌습니다. 글자와 화면이 120% 확대되었습니다.',
        undefined,
        language
      );
    } else {
      speakText(
        language === 'en' ? 'Magnifier mode disabled.' : '돋보기 모드가 해제되었습니다.',
        undefined,
        language
      );
    }
  };

  // Handle step updates
  const handleUpdatePatient = (patient: PatientInfo) => {
    setSurvey((prev) => ({ ...prev, patient }));
  };

  const handleSelectArea = (selectedArea: TriageAreaType) => {
    setSurvey((prev) => ({
      ...prev,
      selectedArea,
      selectedAreas: [selectedArea],
    }));
  };

  const handleToggleArea = (area: TriageAreaType) => {
    setSurvey((prev) => {
      const currentAreas = prev.selectedAreas && prev.selectedAreas.length > 0
        ? prev.selectedAreas
        : (prev.selectedArea ? [prev.selectedArea] : []);
      let nextAreas: TriageAreaType[] = [];

      if (area === 'unknown_general') {
        nextAreas = currentAreas.includes('unknown_general') ? [] : ['unknown_general'];
      } else {
        const cleaned = currentAreas.filter((a) => a !== 'unknown_general');
        if (cleaned.includes(area)) {
          nextAreas = cleaned.filter((a) => a !== area);
        } else {
          nextAreas = [...cleaned, area];
        }
      }

      return {
        ...prev,
        selectedAreas: nextAreas,
        selectedArea: nextAreas[0] || null,
      };
    });
  };

  const handleSelectLocation = (selectedLocation: string) => {
    setSurvey((prev) => ({ ...prev, selectedLocation }));
  };

  const handleToggleMedicalAlert = (alertId: string) => {
    setSurvey((prev) => {
      let nextAlerts = [...prev.medicalAlerts];
      if (alertId === '해당없음') {
        nextAlerts = ['해당없음'];
      } else {
        nextAlerts = nextAlerts.filter((a) => a !== '해당없음');
        if (nextAlerts.includes(alertId)) {
          nextAlerts = nextAlerts.filter((a) => a !== alertId);
        } else {
          nextAlerts.push(alertId);
        }
      }
      return { ...prev, medicalAlerts: nextAlerts };
    });
  };

  const handleToggleMedication = (med: string) => {
    setSurvey((prev) => {
      const current = prev.medicationsList || [];
      const next = current.includes(med)
        ? current.filter((m) => m !== med)
        : [...current, med];

      let nextAlerts = [...prev.medicalAlerts];
      if (next.includes(med) && !nextAlerts.includes(med)) {
        nextAlerts.push(med);
      } else if (!next.includes(med)) {
        nextAlerts = nextAlerts.filter((a) => a !== med);
      }

      return {
        ...prev,
        medicationsList: next,
        medicalAlerts: nextAlerts,
        hasNoMedications: false,
      };
    });
  };

  const handleToggleDrugAllergy = (allergy: string) => {
    setSurvey((prev) => {
      const current = prev.drugAllergies || [];
      const next = current.includes(allergy)
        ? current.filter((m) => m !== allergy)
        : [...current, allergy];

      let nextAlerts = [...prev.medicalAlerts];
      const alertTag = `알러지:${allergy}`;
      if (next.includes(allergy) && !nextAlerts.includes(alertTag)) {
        nextAlerts.push(alertTag);
      } else if (!next.includes(allergy)) {
        nextAlerts = nextAlerts.filter((a) => a !== alertTag);
      }

      return {
        ...prev,
        drugAllergies: next,
        medicalAlerts: nextAlerts,
        hasNoAllergies: false,
      };
    });
  };

  const handleSelectNoMedications = () => {
    setSurvey((prev) => ({
      ...prev,
      medicationsList: [],
      otherMedicationText: '',
      hasNoMedications: true,
      medicalAlerts: prev.medicalAlerts.filter((a) => a.startsWith('알러지:')),
    }));
  };

  const handleSelectNoAllergies = () => {
    setSurvey((prev) => ({
      ...prev,
      drugAllergies: [],
      otherAllergyText: '',
      hasNoAllergies: true,
      medicalAlerts: prev.medicalAlerts.filter((a) => !a.startsWith('알러지:')),
    }));
  };

  // Submit triage upon finishing Step 4
  const handleSubmitTriage = async () => {
    const primaryArea = survey.selectedArea || (survey.selectedAreas && survey.selectedAreas[0]) || 'unknown_general';
    setIsSubmitting(true);
    stopSpeech();

    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');

      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hours}:${minutes}`;
      const createdAt = `${year}.${month}.${day} ${timeStr}`;

      const areaObj = AREA_CATEGORIES.find((a) => a.id === primaryArea) || AREA_CATEGORIES[0];
      const locObj = QUADRANT_LOCATIONS.find((q) => q.id === survey.selectedLocation) || QUADRANT_LOCATIONS[0];

      // Build clinical diagnosis & department route
      const clinicalResult = buildClinicalTriage({
        areaType: primaryArea,
        selectedAreas: survey.selectedAreas && survey.selectedAreas.length > 0 ? survey.selectedAreas : [primaryArea],
        selectedSymptoms: survey.selectedSymptoms || [],
        locationId: survey.selectedLocation,
        onsetPeriod: survey.onsetPeriod,
        painType: survey.painType,
        dailyImpact: survey.dailyImpact,
        painScale: survey.painScale,
        medicalAlerts: survey.medicalAlerts,
        patientName: survey.patient.name,
        patientAge: survey.patient.age,
        patientGender: survey.patient.gender,
        medicationsList: survey.medicationsList || [],
        otherMedicationText: survey.otherMedicationText || '',
        drugAllergies: survey.drugAllergies || [],
        otherAllergyText: survey.otherAllergyText || '',
        specificSymptomDetail: survey.specificSymptomDetail,
        dentureStatus: survey.dentureStatus,
        dentureWornAtNight: survey.dentureWornAtNight,
        dentureComplaint: survey.dentureComplaint,
        implantStatus: survey.implantStatus,
        implantComplaint: survey.implantComplaint,
        cancerTreatmentHistory: survey.cancerTreatmentHistory,
        hasDryMouth: survey.hasDryMouth,
        dryMouthSeverity: survey.dryMouthSeverity,
        ulcerDuration: survey.ulcerDuration,
        hasWhiteOrRedPatches: survey.hasWhiteOrRedPatches,
        hasAngularCheilitis: survey.hasAngularCheilitis,
        hasSevereToothMobility: survey.hasSevereToothMobility,
        hasDysphagia: survey.hasDysphagia,
        hasAcidReflux: survey.hasAcidReflux,
        hasHeartCondition: survey.hasHeartCondition,
      });

      // 🏥 환자 등록번호(차트번호 DEN-YYYY-NNNNN), 내원일자(YYYYMMDD), 접수 세션 난수(4자리), Firestore 문서 ID 생성
      const nextInfo = await generatePatientVisitIdentifiers(survey.patient?.patientId);
      const assignedPatientId = nextInfo.patientId; // 순수 차트번호 (예: DEN-2026-01993)
      const assignedDocId = nextInfo.visitDocId;   // Firestore 문서 ID (예: DEN-2026-01993_20260916_4821)
      const waitingOrder = nextInfo.waitingOrder;  // 당일 접수 대기번호

      const newRecord: Omit<DentalTriageQueueItem, 'id'> = {
        patient: {
          ...survey.patient,
          patientId: assignedPatientId,
          isForeigner: Boolean(survey.patient.isForeigner),
          birthDate: survey.patient.birthDate || '',
          passportOrArc: survey.patient.passportOrArc || '',
          nationality: survey.patient.nationality || (survey.patient.isForeigner ? 'Foreigner' : '대한민국'),
        },
        createdAt: nextInfo.createdAtFormatted,
        date: nextInfo.dateStr,
        time: nextInfo.timeStr,
        areaType: primaryArea,
        selectedAreas: survey.selectedAreas && survey.selectedAreas.length > 0 ? survey.selectedAreas : [primaryArea],
        selectedSymptoms: survey.selectedSymptoms || [],
        areaTitle: areaObj.title,
        locationTitle: locObj.title,
        chiefComplaint: clinicalResult.chiefComplaint || '',
        historyOfPresentIllness: clinicalResult.historyOfPresentIllness || '',
        suspectedConditions: clinicalResult.suspectedConditions || [],
        recommendedDepartment: clinicalResult.recommendedDepartment || '보존과',
        recommendedRoom: clinicalResult.recommendedRoom || '본관 2층 제 1 진료실',
        assignedChair: clinicalResult.assignedChair || '1번 체어',
        assignedChairUnit: clinicalResult.assignedChairUnit,
        triageLevel: clinicalResult.triageLevel || 'Routine',
        mcmRiskLevel: clinicalResult.mcmRiskLevel || 'LOW',
        redFlags: clinicalResult.redFlags || [],
        clinicalRecommendations: clinicalResult.clinicalRecommendations || [],
        seniorPatientMessage: clinicalResult.seniorPatientMessage || '',
        careInstructions: clinicalResult.careInstructions || [],
        status: '진료대기',
        waitingOrder,
        doctorDiagnosisNote: '',
        treatmentPlan: '',
        prescriptions: '',
        onsetPeriod: survey.onsetPeriod || '',
        painScale: survey.painScale || 3,
        painType: survey.painType || '',
        dailyImpact: survey.dailyImpact || '',
        medicalAlerts: survey.medicalAlerts || [],
        medicationsList: survey.medicationsList || [],
        otherMedicationText: survey.otherMedicationText || '',
        drugAllergies: survey.drugAllergies || [],
        otherAllergyText: survey.otherAllergyText || '',
        hasNoMedications: survey.hasNoMedications || false,
        hasNoAllergies: survey.hasNoAllergies || false,
      };

      // Save to Firebase Firestore / LocalStorage (Firestore 문서 ID: DEN-YYYY-NNNNN_YYYYMMDD_XXXX)
      const res = await addTriageRecord(newRecord, assignedDocId);

      setFirestoreDocId(res.id);
      setCompletedRecord({
        ...newRecord,
        id: res.id,
        patient: {
          ...newRecord.patient,
          patientId: assignedPatientId, // 환자 차트 표기에는 순수 차트번호 사용
        },
        waitingOrder: res.waitingOrder,
      });

      // 5-second realistic clinical analysis loading modal
      setIsAnalyzing(true);
    } catch (err) {
      console.error('Triage submission failed:', err);
      setIsSubmitting(false);
    }
  };

  const handleAnalysisComplete = () => {
    setIsAnalyzing(false);
    setIsSubmitting(false);
    setSurvey((prev) => ({ ...prev, step: 5 }));
  };

  const handleResetKiosk = () => {
    stopSpeech();
    setSurvey(INITIAL_SURVEY);
    setCompletedRecord(null);
    setFirestoreDocId('');
    setIsAnalyzing(false);
    setIsCoverPage(true);
  };

  // Determine current speech text for replay
  const getCurrentSpeechText = () => {
    if (language === 'en') {
      if (survey.step === 1) {
        return 'Step 1. Patient check-in. Please enter your name, 6-digit date of birth, and select your gender.';
      } else if (survey.step === 2) {
        return 'Step 2. Please choose your main dental discomfort from the four cards.';
      } else if (survey.step === 3) {
        return 'Step 3. Please tap your pain location on the dental chart.';
      } else if (survey.step === 4) {
        return 'Step 4. Detailed questionnaire. Please answer the questions for your appointment.';
      } else if (survey.step === 5 && completedRecord) {
        return `Check-in complete for ${completedRecord.patient.name}. You are assigned to ${completedRecord.recommendedDepartment}, room ${completedRecord.recommendedRoom}.`;
      }
    } else {
      if (survey.step === 1) {
        return '1단계 본인 확인입니다. 성함과 생년월일 6자리, 성별을 확인해 주세요.';
      } else if (survey.step === 2) {
        return '2단계입니다. 가장 불편하신 부위를 화면의 네 가지 큰 카드 중에서 골라 눌러주세요.';
      } else if (survey.step === 3) {
        return '3단계입니다. 아픈 치아나 잇몸의 위치를 골라주세요.';
      } else if (survey.step === 4) {
        return '4단계 상세 문진입니다. 언제부터 불편하셨는지, 어떤 느낌의 통증이신지 선택해 주세요.';
      } else if (survey.step === 5 && completedRecord) {
        return completedRecord.seniorPatientMessage;
      }
    }
    return '';
  };

  // 🌟 1. Cover Page Display (User requested touch-to-start front cover screen)
  if (isCoverPage) {
    return (
      <>
        <KioskCoverPage
          onStart={() => setIsCoverPage(false)}
          language={language}
          onToggleLanguage={setLanguage}
          onOpenStaffCall={() => setIsStaffCallOpen(true)}
        />

        {/* Staff Call Modal */}
        {isStaffCallOpen && (
          <StaffCallModal onClose={() => setIsStaffCallOpen(false)} />
        )}

        {/* Staff Real-time Queue Monitor Modal */}
        {isQueueMonitorOpen && (
          <StaffQueueMonitor onClose={() => setIsQueueMonitorOpen(false)} />
        )}
      </>
    );
  }

  return (
    <div
      className={`min-h-screen w-full bg-[#F8FAFC] text-slate-900 flex flex-col justify-between transition-all duration-200 select-none ${
        isZoom120 ? 'text-[20px]' : 'text-[17px]'
      }`}
    >
      {/* Top Accessible Header (Compact Tablet Strip + 돋보기 + TTS + Steps + Language Switcher) */}
      <KioskHeader
        step={survey.step}
        isZoom120={isZoom120}
        onToggleZoom120={toggleZoom120}
        onReset={handleResetKiosk}
        onOpenStaffCall={() => setIsStaffCallOpen(true)}
        onOpenQueueMonitor={() => setIsQueueMonitorOpen(true)}
        currentSpeechText={getCurrentSpeechText()}
        language={language}
        onToggleLanguage={setLanguage}
      />

      {/* Main Tablet Step Content (Scrollable, High-Legibility) */}
      <main className="flex-1 flex flex-col py-3 sm:py-6 px-3 sm:px-6 w-full max-w-7xl mx-auto">
        {survey.step === 1 && (
          <Step1PatientAuth
            patient={survey.patient}
            onUpdatePatient={handleUpdatePatient}
            onNext={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 2 }));
            }}
            language={language}
          />
        )}

        {survey.step === 2 && (
          <Step2PainCategory
            selectedArea={survey.selectedArea}
            selectedAreas={survey.selectedAreas && survey.selectedAreas.length > 0 ? survey.selectedAreas : (survey.selectedArea ? [survey.selectedArea] : [])}
            onSelectArea={handleSelectArea}
            onToggleArea={handleToggleArea}
            onNext={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 3 }));
            }}
            onPrev={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 1 }));
            }}
            language={language}
          />
        )}

        {survey.step === 3 && (
          <Step3MouthLocation
            selectedLocation={survey.selectedLocation}
            onSelectLocation={handleSelectLocation}
            onNext={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 4 }));
            }}
            onPrev={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 2 }));
            }}
            language={language}
          />
        )}

        {survey.step === 4 && (
          <Step4DetailedSurvey
            selectedArea={survey.selectedArea}
            onsetPeriod={survey.onsetPeriod}
            onChangeOnset={(val) => setSurvey((prev) => ({ ...prev, onsetPeriod: val }))}
            painType={survey.painType}
            onChangePainType={(val) => setSurvey((prev) => ({ ...prev, painType: val }))}
            selectedSymptoms={survey.selectedSymptoms || []}
            onChangeSelectedSymptoms={(val) => setSurvey((prev) => ({ ...prev, selectedSymptoms: val }))}
            dailyImpact={survey.dailyImpact}
            onChangeDailyImpact={(val) => setSurvey((prev) => ({ ...prev, dailyImpact: val }))}
            painScale={survey.painScale}
            onChangePainScale={(val) => setSurvey((prev) => ({ ...prev, painScale: val }))}
            medicalAlerts={survey.medicalAlerts}
            onToggleMedicalAlert={handleToggleMedicalAlert}
            medicationsList={survey.medicationsList || []}
            onToggleMedication={handleToggleMedication}
            otherMedicationText={survey.otherMedicationText || ''}
            onChangeOtherMedicationText={(val) =>
              setSurvey((prev) => ({ ...prev, otherMedicationText: val }))
            }
            drugAllergies={survey.drugAllergies || []}
            onToggleDrugAllergy={handleToggleDrugAllergy}
            otherAllergyText={survey.otherAllergyText || ''}
            onChangeOtherAllergyText={(val) =>
              setSurvey((prev) => ({ ...prev, otherAllergyText: val }))
            }
            hasNoMedications={survey.hasNoMedications}
            onSelectNoMedications={handleSelectNoMedications}
            hasNoAllergies={survey.hasNoAllergies}
            onSelectNoAllergies={handleSelectNoAllergies}
            specificSymptomDetail={survey.specificSymptomDetail}
            onChangeSpecificSymptomDetail={(val) =>
              setSurvey((prev) => ({ ...prev, specificSymptomDetail: val }))
            }
            ulcerDuration={survey.ulcerDuration || 'none'}
            onChangeUlcerDuration={(val) => setSurvey((prev) => ({ ...prev, ulcerDuration: val }))}
            hasWhiteOrRedPatches={!!survey.hasWhiteOrRedPatches}
            onChangeHasWhiteOrRedPatches={(val) =>
              setSurvey((prev) => ({ ...prev, hasWhiteOrRedPatches: val }))
            }
            hasAngularCheilitis={!!survey.hasAngularCheilitis}
            onChangeHasAngularCheilitis={(val) =>
              setSurvey((prev) => ({ ...prev, hasAngularCheilitis: val }))
            }
            hasSevereToothMobility={!!survey.hasSevereToothMobility}
            onChangeHasSevereToothMobility={(val) =>
              setSurvey((prev) => ({ ...prev, hasSevereToothMobility: val }))
            }
            hasDysphagia={!!survey.hasDysphagia}
            onChangeHasDysphagia={(val) => setSurvey((prev) => ({ ...prev, hasDysphagia: val }))}
            dentureStatus={survey.dentureStatus}
            onChangeDentureStatus={(val) => setSurvey((prev) => ({ ...prev, dentureStatus: val }))}
            dentureWornAtNight={!!survey.dentureWornAtNight}
            onChangeDentureWornAtNight={(val) =>
              setSurvey((prev) => ({ ...prev, dentureWornAtNight: val }))
            }
            dentureComplaint={survey.dentureComplaint || ''}
            onChangeDentureComplaint={(val) =>
              setSurvey((prev) => ({ ...prev, dentureComplaint: val }))
            }
            implantStatus={survey.implantStatus}
            onChangeImplantStatus={(val) => setSurvey((prev) => ({ ...prev, implantStatus: val }))}
            cancerTreatmentHistory={survey.cancerTreatmentHistory}
            onChangeCancerTreatmentHistory={(val) =>
              setSurvey((prev) => ({ ...prev, cancerTreatmentHistory: val }))
            }
            hasDryMouth={survey.hasDryMouth}
            onChangeHasDryMouth={(val) => setSurvey((prev) => ({ ...prev, hasDryMouth: val }))}
            dryMouthSeverity={survey.dryMouthSeverity || 'mild'}
            onChangeDryMouthSeverity={(val) =>
              setSurvey((prev) => ({ ...prev, dryMouthSeverity: val }))
            }
            hasAcidReflux={!!survey.hasAcidReflux}
            onChangeHasAcidReflux={(val) => setSurvey((prev) => ({ ...prev, hasAcidReflux: val }))}
            hasHeartCondition={!!survey.hasHeartCondition}
            onChangeHasHeartCondition={(val) =>
              setSurvey((prev) => ({ ...prev, hasHeartCondition: val }))
            }
            onNext={handleSubmitTriage}
            onPrev={() => {
              stopSpeech();
              setSurvey((prev) => ({ ...prev, step: 3 }));
            }}
            isSubmitting={isSubmitting || isAnalyzing}
            language={language}
          />
        )}

        {survey.step === 5 && completedRecord && (
          <Step5CompletionRoute
            triageRecord={completedRecord}
            firestoreDocId={firestoreDocId}
            onReset={handleResetKiosk}
            language={language}
          />
        )}
      </main>

      {/* Tablet Bottom Status Footer (Zero-Scroll Height) */}
      <footer className="bg-white border-t border-slate-200 py-1.5 px-4 select-none flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-slate-500 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-bold text-slate-700">
              {language === 'en'
                ? 'OZ Dental Hospital Smart Reception System · Touch Screen Optimized'
                : '오즈치과대학교병원 대형 태블릿 스마트 예진 시스템 · 원내 전산 실시간 연동'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-500 font-semibold">
            <span>{language === 'en' ? 'Emergency Line: 02-2228-0114' : '원내 비상연락: 02-2228-0114'}</span>
            <span className="hidden sm:inline text-slate-300">|</span>
            <span className="text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200 hidden sm:inline">
              {language === 'en' ? 'Tablet Touch Mode' : '터치 입력 최적화 태블릿'}
            </span>
          </div>
        </div>
      </footer>

      {/* Staff Call Modal */}
      {isStaffCallOpen && (
        <StaffCallModal onClose={() => setIsStaffCallOpen(false)} />
      )}

      {/* Staff Real-time Queue Monitor Modal */}
      {isQueueMonitorOpen && (
        <StaffQueueMonitor onClose={() => setIsQueueMonitorOpen(false)} />
      )}

      {/* 5-second Clinical AI Analysis Loading Modal */}
      {isAnalyzing && completedRecord && (
        <TriageLoadingModal
          patientName={completedRecord.patient.name}
          chiefComplaint={completedRecord.chiefComplaint}
          recommendedDept={completedRecord.recommendedDepartment}
          onComplete={handleAnalysisComplete}
          language={language}
        />
      )}
    </div>
  );
}
