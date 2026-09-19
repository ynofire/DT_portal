export type TriageAreaType = 'teeth' | 'gum' | 'implant_denture' | 'jaw_mucosa' | 'unknown_general';

export type TriageLevel = 'Routine' | 'Urgent' | 'Emergency';

export interface PatientInfo {
  name: string;
  age: number;
  gender: '남성' | '여성';
  phone: string;
  patientId: string;
  rrnFront: string;
  rrnBack: string;
  // Foreigner / International Patient support
  isForeigner?: boolean;
  birthDate?: string; // YYYY-MM-DD
  passportOrArc?: string; // Passport number or Alien Registration Card (ARC)
  nationality?: string;
}

export interface DentalChairUnit {
  id: string;
  chairName: string;
  clinicRoom: string;
  unitPurpose: string;
  equippedTools: string[];
}

export interface DentalTriageQueueItem {
  id?: string;
  patient: PatientInfo;
  createdAt: string; // "YYYY.MM.DD HH:mm"
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  areaType: TriageAreaType;
  selectedAreas?: TriageAreaType[];
  selectedSymptoms?: string[];
  areaTitle: string;
  locationTitle: string;
  chiefComplaint: string; // 의료진용 표준 C.C
  historyOfPresentIllness: string; // 의료진용 표준 Hx
  suspectedConditions: string[];
  recommendedDepartment: string;
  recommendedRoom: string;
  assignedChair: string;
  assignedChairUnit?: DentalChairUnit;
  triageLevel: TriageLevel;
  seniorPatientMessage: string;
  careInstructions: string[];
  mcmRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH'; // NHS Mouth Care Matters 위험군 분류
  redFlags?: string[]; // 의료진 즉시 확인 경고 (구강암 의심 궤양, 기도 흡인, 심내막염, 악골괴사 등)
  clinicalRecommendations?: string[]; // 의료진 처방/간호 권고사항 (고농도 불소, SLS-Free 치약, 인공타액, 항진균제 등)
  status: '진료대기' | '진료중' | '진료완료';
  waitingOrder: number;
  doctorDiagnosisNote: string;
  treatmentPlan: string;
  prescriptions: string;
  onsetPeriod?: string;
  painScale?: number;
  painType?: string;
  dailyImpact?: string;
  medicalAlerts?: string[];
  // 상세 복용 약물 및 알러지 문진 (치과의사 수술/마취/처방 필수 사전 확인)
  medicationsList?: string[]; // 복용 중인 약물 목록 (고혈압, 당뇨, 아스피린, 골다공증, 스테로이드, 신장질환 등)
  otherMedicationText?: string; // 환자 직접 기재 기타 복용약
  drugAllergies?: string[]; // 약물 알러지 목록 (항생제/페니실린, 소염진통제/NSAIDs, 치과국소마취제 등)
  otherAllergyText?: string; // 환자 직접 기재 기타 알러지/부작용
  hasNoMedications?: boolean;
  hasNoAllergies?: boolean;
}

export interface AreaCategory {
  id: TriageAreaType;
  title: string;
  subtitle: string;
  description: string;
  iconName: string;
  color: string;
  bgGradient: string;
  targetDepartment: string;
  commonSymptoms: string[];
}

export interface QuadrantLocation {
  id: string;
  title: string;
  koreanName: string;
  seniorExplanation: string;
  shortLabel: string;
}

export interface SurveyState {
  step: number;
  patient: PatientInfo;
  selectedArea: TriageAreaType | null;
  selectedAreas?: TriageAreaType[];
  selectedLocation: string; // 'UR' | 'UL' | 'LR' | 'LL' | 'ALL'
  onsetPeriod: string;
  painType: string;
  selectedSymptoms?: string[];
  dailyImpact: string;
  painScale: number; // 1 to 5
  medicalAlerts: string[]; // 종합 알러지/약물 태그 목록

  // 상세 복용 약물 및 알러지 문진
  medicationsList: string[]; // 복용 약물 (고혈압, 당뇨, 아스피린, 골다공증, 스테로이드, 신장질환 등)
  otherMedicationText: string; // 기타 복용 약물 직접 기재
  drugAllergies: string[]; // 약물 알러지 (항생제/페니실린, 소염진통제/NSAIDs, 치과국소마취제 등)
  otherAllergyText: string; // 기타 약물 알러지 직접 기재
  hasNoMedications: boolean; // 복용 중인 약 없음
  hasNoAllergies: boolean; // 약물 알러지 없음

  // === 🦷 치과의사/치위생사 전문 상세 문진 필드 (NHS Mouth Care Matters 임상 가이드라인 반영) ===
  // 1) 동적 부위별 심층 증상
  specificSymptomDetail: string;

  // 2) 연조직 및 구강 점막 위험 징후 (MCM Red Flag Screening)
  ulcerDuration: 'none' | 'under_2weeks' | 'over_2weeks'; // 2주 이상 비치유성 궤양 (구강암/악성종양 감별 의무)
  hasWhiteOrRedPatches: boolean; // 혓바닥/입천장 닦이지 않는 백태 또는 붉은 반점 (구강 칸디다증 / 전암병소)
  hasAngularCheilitis: boolean; // 입꼬리 짓무름 및 갈라짐 (구각구순염 - 틀니 교합고경 저하 및 칸디다/세균 복합감염)
  hasSevereToothMobility: boolean; // 치아가 심하게 흔들림 (기도 흡인 질식 위험 - Aspiration Risk)

  // 3) 삼킴 곤란 및 연하 장애 (MCM Dysphagia & Aspiration Pneumonia)
  hasDysphagia: boolean; // 물이나 음식 섭취 시 잦은 기침/사레들림 (흡인성 폐렴 위험 - SLS-free 치약 및 흡인 세정 필요)

  // 4) 보철물 및 치과 시술 이력 (틀니, 임플란트)
  dentureStatus: 'none' | 'partial' | 'complete'; // 틀니 미사용 / 부분틀니 / 전체틀니
  dentureWornAtNight: boolean; // 틀니를 밤에 착용한 채 수면 (의치성 구내염 Denture Stomatitis 주원인)
  dentureComplaint?: string; // 헐거움, 잇몸 짓무름/눌림, 파손
  implantStatus: 'none' | 'completed' | 'in_progress'; // 없음 / 식립 완료 / 치료 진행 중
  implantComplaint?: string; // 잇몸 출혈/흔들림/나사풀림

  // 5) 종양학 & 방사선 치료 이력 (치과의사 핵심 확인 사항)
  cancerTreatmentHistory: 'none' | 'radiation_past' | 'radiation_current' | 'chemo_other';
  hasDryMouth: boolean; // 방사선 치료 후 타액선 파괴 및 구강건조증 (다발성 우식/악골괴사 위험인자)
  dryMouthSeverity?: 'mild' | 'severe'; // 심한 구강건조 (물 없이 식사 불가)

  // 6) 치아 산식증 및 전신 질환 (MCM Systemic link)
  hasAcidReflux: boolean; // 역류성 식도염 / 잦은 구토로 인한 치아 부식증(Erosion)
  hasHeartCondition: boolean; // 인공 심장 판막 / 심내막염 병력 (침습 시술 전 예방적 항생제 Prophylaxis 필수 확인)
}
