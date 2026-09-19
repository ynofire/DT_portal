import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  setDoc,
  getDocs,
  where,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { DentalTriageQueueItem } from './types';
import appletConfig from '../firebase-applet-config.json';

// ============================================================================
// 🏥 [치과병원 스마트 예진 시스템 Firebase 설정 안내]
// 본인의 Firebase 콘솔 설정 객체를 아래 userFirebaseConfig 자리에 붙여넣으시면 됩니다.
// 키를 넣지 않거나 로컬 테스트 중이어도 안전한 로컬스토리지 Fallback을 통해
// Step 5 접수증 및 길안내까지 100% 정상 작동합니다.
// ============================================================================
const userFirebaseConfig = {
  apiKey: "AIzaSyBDNJX7LSuFwQedhDIELacjowLKbQM37_w",
  authDomain: "dentaltouch.firebaseapp.com",
  projectId: "dentaltouch",
  storageBucket: "dentaltouch.firebasestorage.app",
  messagingSenderId: "746377691718",
  appId: "1:746377691718:web:1c8b2e9ecc7e58b19c8047",
  measurementId: "G-2JZP3RW0NJ",
  firestoreDatabaseId: "(default)",
};

const activeConfig = {
  apiKey: userFirebaseConfig.apiKey || appletConfig.apiKey || '',
  authDomain: userFirebaseConfig.authDomain || appletConfig.authDomain || '',
  projectId: userFirebaseConfig.projectId || appletConfig.projectId || '',
  storageBucket: userFirebaseConfig.storageBucket || appletConfig.storageBucket || '',
  messagingSenderId: userFirebaseConfig.messagingSenderId || appletConfig.messagingSenderId || '',
  appId: userFirebaseConfig.appId || appletConfig.appId || '',
  measurementId: userFirebaseConfig.measurementId || (appletConfig as any).measurementId || '',
  firestoreDatabaseId: userFirebaseConfig.firestoreDatabaseId || appletConfig.firestoreDatabaseId || '(default)',
};

export const QUEUE_COLLECTION = 'dental_triage_queue';
export const FIREBASE_PROJECT_ID = activeConfig.projectId || 'dentaltouch';
const LOCAL_STORAGE_KEY = 'dental_triage_queue_local';

let app: FirebaseApp | null = null;
export let db: Firestore | null = null;

/**
 * Firestore는 객체나 중첩 필드에 `undefined`가 있을 경우 setDoc/updateDoc 호출 시 예외를 발생시킵니다.
 * 이 함수는 모든 undefined 필드를 재귀적으로 안전하게 제거 또는 null로 변환합니다.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) {
    return null as any;
  }
  if (data === null || typeof data !== 'object') {
    return data;
  }
  if (data instanceof Date) {
    return data;
  }
  // Firestore FieldValue 객체(예: serverTimestamp()) 보호
  if ('_methodName' in (data as any)) {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as any;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result[key] = sanitizeForFirestore(value);
    }
  }
  return result as T;
}

// Firebase 초기화 시도 (유효한 apiKey가 있을 때만 연결)
if (activeConfig.apiKey && activeConfig.apiKey.length > 5 && !activeConfig.apiKey.includes('YOUR_')) {
  try {
    app = !getApps().length ? initializeApp(activeConfig) : getApp();
    db = activeConfig.firestoreDatabaseId && activeConfig.firestoreDatabaseId !== '(default)'
      ? getFirestore(app, activeConfig.firestoreDatabaseId)
      : getFirestore(app);
    console.info('🏥 Firebase Firestore 연결 성공:', activeConfig.projectId);
  } catch (err) {
    console.warn('⚠️ Firebase 초기화 실패 (로컬 스토리지 모드로 자동 전환):', err);
    db = null;
  }
} else {
  console.info('💡 Firebase 설정 대기 중 (안전한 로컬 브라우저 저장소 Fallback 활성화됨)');
}

/**
 * 로컬 스토리지 큐 관리 헬퍼
 */
function getLocalQueue(): DentalTriageQueueItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalQueue(items: DentalTriageQueueItem[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('dental_queue_updated'));
  } catch (e) {
    console.warn('로컬 스토리지 저장 실패:', e);
  }
}

/**
 * 환자 등록번호(차트번호) 및 Firestore 문서 ID 생성 규칙
 *
 * 1. 환자 등록번호 (Patient ID / 차트번호):
 *    - 형식: DEN-YYYY-NNNNN (예: DEN-2026-01992)
 *    - 환자 개인에게 영구적으로 부여되는 순수 차트 번호입니다.
 *    - 환자 카드, 진료 차트, 관리자 화면, 접수증 표기 시에는 이 앞부분만 사용됩니다.
 *
 * 2. 내원 일자 (Visit Date):
 *    - YYYYMMDD (예: 20260917)
 *    - 해당 환자가 병원에 내원하여 접수한 날짜입니다.
 *
 * 3. 진료 접수 세션 난수 (Session ID):
 *    - 4자리 난수 (예: 3598)
 *    - 재내원(재진)이나 동일 환자/동명이인의 다중 접수 시 문서 ID가 충돌하여 기존 차트가 덮어씌워지는 것을 방지합니다.
 *
 * 4. Firestore 문서 ID (Document ID):
 *    - [환자등록번호]_[내원일자]_[접수고유번호]
 *    - 예: DEN-2026-01992_20260917_3598
 *    - 개별 진료 이력(Visit Record)을 독립된 문서로 온전히 보존하여 과거 진료 히스토리를 유지합니다.
 */
export async function generatePatientVisitIdentifiers(
  existingPatientId?: string,
  targetDate?: Date
): Promise<{
  patientId: string;        // 순수 차트번호 (예: DEN-2026-01992)
  visitDateStr: string;     // 내원일자 (예: 20260917)
  sessionCode: string;      // 접수 세션 난수 (예: 3598)
  visitDocId: string;       // Firestore 문서 ID (예: DEN-2026-01992_20260917_3598)
  waitingOrder: number;     // 당일 접수 순번
  dateStr: string;          // YYYY-MM-DD
  timeStr: string;          // HH:mm
  createdAtFormatted: string; // YYYY.MM.DD HH:mm
}> {
  const now = targetDate || new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const visitDateStr = `${year}${mm}${dd}`; // 20260917
  const dateStr = `${year}-${mm}-${dd}`;
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  const createdAtFormatted = `${year}.${mm}.${dd} ${timeStr}`;

  // 1. 환자 등록번호(차트번호) 결정
  let patientChartId = '';
  // 기존 등록번호가 유효한 형식인 경우 그대로 유지 (재진 환자 히스토리 보존)
  if (existingPatientId && /^DEN-\d{4}-\d{3,5}$/.test(existingPatientId.trim())) {
    patientChartId = existingPatientId.trim();
  } else {
    // 신규 환자: DEN-YYYY-NNNNN 채번 (기존 DB 내 최대 번호 기준 순차 증가)
    let maxChartSeq = 1992; // 기본 베이스라인

    // 1-1. Firestore에서 기존 차트번호 탐색
    if (db) {
      try {
        const snap = await getDocs(collection(db, QUEUE_COLLECTION));
        snap.forEach((docSnap) => {
          const docId = docSnap.id;
          const pDataId = docSnap.data()?.patient?.patientId;
          [docId, pDataId].forEach((idCandidate) => {
            if (!idCandidate) return;
            const match = String(idCandidate).match(/DEN-(\d{4})-(\d+)/);
            if (match) {
              const docYear = parseInt(match[1], 10);
              const seq = parseInt(match[2], 10);
              if (docYear === year && !isNaN(seq) && seq > maxChartSeq) {
                maxChartSeq = seq;
              }
            }
          });
        });
      } catch (err) {
        console.warn('Firestore 차트번호 탐색 경고:', err);
      }
    }

    // 1-2. 로컬 스토리지 확인
    const localList = getLocalQueue();
    localList.forEach((item) => {
      [item.id, item.patient?.patientId].forEach((idCandidate) => {
        if (!idCandidate) return;
        const match = String(idCandidate).match(/DEN-(\d{4})-(\d+)/);
        if (match) {
          const docYear = parseInt(match[1], 10);
          const seq = parseInt(match[2], 10);
          if (docYear === year && !isNaN(seq) && seq > maxChartSeq) {
            maxChartSeq = seq;
          }
        }
      });
    });

    const nextSeq = maxChartSeq + 1;
    patientChartId = `DEN-${year}-${String(nextSeq).padStart(5, '0')}`;
  }

  // 2. 당일 접수 세션 난수 생성 (4자리: 1000~9999)
  const sessionCode = Math.floor(1000 + Math.random() * 9000).toString();

  // 3. Firestore 고유 문서 ID 생성: DEN-YYYY-NNNNN_YYYYMMDD_XXXX
  const visitDocId = `${patientChartId}_${visitDateStr}_${sessionCode}`;

  // 4. 당일 대기 순번(Waiting Order) 산출
  let todayCount = 0;
  if (db) {
    try {
      const q = query(
        collection(db, QUEUE_COLLECTION),
        where('date', '==', dateStr)
      );
      const snap = await getDocs(q);
      todayCount = snap.size;
    } catch (e) {
      console.warn('당일 순번 조회 경고:', e);
    }
  }
  const localTodayCount = localListCountToday(dateStr);
  const waitingOrder = Math.max(todayCount, localTodayCount) + 1;

  return {
    patientId: patientChartId,
    visitDateStr,
    sessionCode,
    visitDocId,
    waitingOrder,
    dateStr,
    timeStr,
    createdAtFormatted,
  };
}

function localListCountToday(dateStr: string): number {
  const localList = getLocalQueue();
  return localList.filter((it) => it.date === dateStr).length;
}

/**
 * 하위 호환성을 위한 getNextPatientId 별칭 함수
 */
export async function getNextPatientId(targetDate?: Date): Promise<{
  patientId: string;
  orderNumber: number;
  dateStr: string;
  timeStr: string;
  createdAtFormatted: string;
  visitDocId: string;
}> {
  const result = await generatePatientVisitIdentifiers(undefined, targetDate);
  return {
    patientId: result.patientId,
    orderNumber: result.waitingOrder,
    dateStr: result.dateStr,
    timeStr: result.timeStr,
    createdAtFormatted: result.createdAtFormatted,
    visitDocId: result.visitDocId,
  };
}

/**
 * 날짜 / 타임스탬프 필드를 일관된 포맷 문자열로 변환
 */
export function formatTimestampOrString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && typeof val.toDate === 'function') {
    const dt = val.toDate();
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    return `${yy}.${mm}.${dd} ${hh}:${min}`;
  }
  return String(val);
}

/**
 * 예진 접수 기록 저장 (DEN-YYYY-NNNNN_YYYYMMDD_XXXX 고유 문서 ID 및 순수 차트번호 분리 동기화)
 */
export async function addTriageRecord(
  record: Omit<DentalTriageQueueItem, 'id'>,
  customDocId?: string
): Promise<{ id: string; waitingOrder: number; patientId: string }> {
  // 1. 환자 등록번호(차트번호) 및 Firestore 개별 내원 이력 문서 ID(Visit Record Doc ID) 확인/생성
  let visitDocId = customDocId;
  let chartId = record.patient?.patientId;
  let orderNumber = record.waitingOrder;

  if (!visitDocId || !visitDocId.includes('_')) {
    const ids = await generatePatientVisitIdentifiers(chartId);
    chartId = ids.patientId;
    visitDocId = ids.visitDocId;
    orderNumber = orderNumber && orderNumber > 0 ? orderNumber : ids.waitingOrder;
  } else {
    // customDocId가 이미 DEN-YYYY-NNNNN_YYYYMMDD_XXXX 형태인 경우
    if (!chartId || !/^DEN-\d{4}-\d{3,5}$/.test(chartId)) {
      chartId = visitDocId.split('_')[0];
    }
    if (!orderNumber || orderNumber <= 0) {
      orderNumber = 1;
    }
  }

  const updatedPatient = {
    ...record.patient,
    patientId: chartId,
  };

  const finalRecord: DentalTriageQueueItem = {
    ...record,
    id: visitDocId,
    waitingOrder: orderNumber,
    patient: updatedPatient,
  };

  // 2. 브라우저 로컬 저장소 즉시 동기화 (환자 대기시간 0초)
  const localList = getLocalQueue();
  saveLocalQueue([finalRecord, ...localList.filter((i) => i.id !== visitDocId).slice(0, 49)]);

  // 3. Firebase Firestore 클라우드 실시간 동기화
  if (db) {
    try {
      const docRef = doc(db, QUEUE_COLLECTION, visitDocId);
      const cleanRecord = sanitizeForFirestore(finalRecord);
      const payload = {
        ...cleanRecord,
        id: visitDocId,
        serverTime: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(docRef, payload);
      console.log('✅ Firestore 클라우드 동기화 완료 (문서ID):', visitDocId, '차트번호:', chartId);
    } catch (firestoreError) {
      console.error('⚠️ Firestore 동기화 오류 (로컬 복사본 정상 유지):', firestoreError);
    }
  }

  console.info('⚡ 접수 완료 및 데이터베이스 반영 완료 (문서ID:', visitDocId, '차트번호:', chartId, ')');
  return {
    id: visitDocId,
    waitingOrder: orderNumber,
    patientId: chartId,
  };
}

/**
 * 실시간 대기열 구독 (Firestore onSnapshot + LocalStorage 이벤트 동시 감지)
 */
export function subscribeToQueue(
  callback: (items: DentalTriageQueueItem[]) => void
): () => void {
  let unsubFirestore: (() => void) | null = null;

  const notifyWithMerged = (firestoreItems: DentalTriageQueueItem[] = []) => {
    const localItems = getLocalQueue();
    // 중복 제거 및 시간순 병합
    const map = new Map<string, DentalTriageQueueItem>();
    firestoreItems.forEach((it) => it.id && map.set(it.id, it));
    localItems.forEach((it) => it.id && !map.has(it.id) && map.set(it.id, it));

    const merged = Array.from(map.values()).sort((a, b) => {
      const timeA = formatTimestampOrString(a.createdAt);
      const timeB = formatTimestampOrString(b.createdAt);
      if (timeB !== timeA) return timeB.localeCompare(timeA);
      // 문서ID 역순 정렬
      return (b.id || '').localeCompare(a.id || '');
    });

    callback(merged);
  };

  // 로컬 저장소 즉시 반영
  notifyWithMerged([]);

  // Firestore 리스너 연결
  if (db) {
    try {
      const q = query(
        collection(db, QUEUE_COLLECTION),
        orderBy('createdAt', 'desc'),
        limit(50)
      );

      unsubFirestore = onSnapshot(
        q,
        (snapshot) => {
          const items: DentalTriageQueueItem[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const createdAtStr = formatTimestampOrString(data.createdAt);

            // 순수 차트번호 (Patient ID: DEN-YYYY-NNNNN) 추출
            const rawPatientId = data.patient?.patientId;
            let chartId = rawPatientId;
            if (!chartId || !/^DEN-\d{4}-\d{3,5}$/.test(chartId)) {
              if (docSnap.id.includes('_')) {
                chartId = docSnap.id.split('_')[0];
              } else {
                chartId = docSnap.id;
              }
            }

            const orderNum =
              data.waitingOrder ||
              (docSnap.id.includes('_') ? parseInt(docSnap.id.split('_')[2], 10) : 0) ||
              (docSnap.id.startsWith('DEN-') ? parseInt(docSnap.id.slice(-3), 10) : 0);

            items.push({
              id: docSnap.id,
              ...data,
              createdAt: createdAtStr,
              waitingOrder: orderNum,
              patient: {
                ...data.patient,
                patientId: chartId,
              },
            } as DentalTriageQueueItem);
          });
          notifyWithMerged(items);
        },
        (err) => {
          console.warn('Firestore 리스너 예외 (로컬 데이터 유지):', err);
          notifyWithMerged([]);
        }
      );
    } catch (e) {
      console.warn('Firestore 구독 초기화 실패 (로컬 모드 진행):', e);
    }
  }

  // 로컬 이벤트 리스너
  const handleLocalUpdate = () => {
    notifyWithMerged([]);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('dental_queue_updated', handleLocalUpdate);
    window.addEventListener('storage', handleLocalUpdate);
  }

  return () => {
    if (unsubFirestore) unsubFirestore();
    if (typeof window !== 'undefined') {
      window.removeEventListener('dental_queue_updated', handleLocalUpdate);
      window.removeEventListener('storage', handleLocalUpdate);
    }
  };
}

/**
 * 환자 상태 변경 (대기 / 진료중 / 진료완료)
 */
export async function updatePatientStatus(
  docId: string,
  status: '진료대기' | '진료중' | '진료완료'
): Promise<void> {
  return updatePatientRecord(docId, { status });
}

/**
 * 환자 레코드 전체/부분 갱신 (상태, 진단소견, 처방, 치료계획 등 Firestore 및 로컬 즉시 동기화)
 */
export async function updatePatientRecord(
  docId: string,
  updates: Partial<DentalTriageQueueItem>
): Promise<void> {
  const sanitized = sanitizeForFirestore(updates);

  // Firestore 업데이트
  if (db && !docId.startsWith('loc_')) {
    try {
      const docRef = doc(db, QUEUE_COLLECTION, docId);
      await updateDoc(docRef, sanitized);
      console.log('✅ Firestore 환자 레코드 업데이트 완료:', docId, updates);
    } catch (err) {
      console.error('⚠️ Firestore 상태 업데이트 실패:', err);
    }
  }

  // 로컬 스토리지 업데이트
  const localList = getLocalQueue();
  const updated = localList.map((item) => (item.id === docId ? { ...item, ...updates } : item));
  saveLocalQueue(updated);
}

