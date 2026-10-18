import type { Locale } from './index';

const en = {
  heading: 'Is Claude down?',
  intro: 'Anthropic’s service status. Your account’s usage limits are separate.',
  loading: 'Checking the official status…',
  unavailable: 'Couldn’t check service status',
  unavailableHint: 'Open the official status page for the latest report.',
  stale: 'This status check is out of date. Check again for the latest report.',
  checked: 'Checked {time} · Refreshes every minute',
  refresh: 'Check again',
  source: 'Official status page',
  incidents: 'Active reports from Anthropic (original titles)',
  noJs: 'Open the official status page to check for an outage.',
  overall: { operational: 'No problems reported', issues: 'Problems reported', maintenance: 'Maintenance reported', unknown: 'Status not confirmed' },
  states: { operational: 'Working', degraded_performance: 'Running slowly', partial_outage: 'Some requests failing', major_outage: 'Service outage', under_maintenance: 'Maintenance', unknown: 'Not confirmed' },
  services: { claude: 'Claude', code: 'Claude Code', api: 'API' },
};
type Messages = { [K in keyof typeof en]: typeof en[K] extends string ? string : { [P in keyof typeof en[K]]: string } };
export const claudeStatusMessages: Record<Locale, Messages> = {
  en,
  'zh-CN': {
    heading: 'Claude 出故障了吗？', intro: 'Anthropic 公布的服务状态。你账户的用量限制另行计算。', loading: '正在查询官方状态…', unavailable: '暂时无法查询服务状态', unavailableHint: '请打开官方状态页查看最新报告。', stale: '此状态已过时，请重新查询最新报告。', checked: '查询于 {time} · 每分钟刷新', refresh: '重新查询', source: '官方状态页', incidents: 'Anthropic 的当前故障报告（原标题）', noJs: '请打开官方状态页查看是否有故障。',
    overall: { operational: '未报告服务故障', issues: '已报告服务故障', maintenance: '已报告维护', unknown: '状态尚未确认' },
    states: { operational: '正常运行', degraded_performance: '运行缓慢', partial_outage: '部分请求失败', major_outage: '服务中断', under_maintenance: '维护中', unknown: '尚未确认' }, services: { claude: 'Claude', code: 'Claude Code', api: 'API' },
  },
  'zh-TW': {
    heading: 'Claude 發生故障了嗎？', intro: 'Anthropic 公布的服務狀態。你帳戶的用量限制另行計算。', loading: '正在查詢官方狀態…', unavailable: '暫時無法查詢服務狀態', unavailableHint: '請開啟官方狀態頁查看最新報告。', stale: '此狀態已過時，請重新查詢最新報告。', checked: '查詢於 {time} · 每分鐘重新整理', refresh: '重新查詢', source: '官方狀態頁', incidents: 'Anthropic 的目前故障報告（原始標題）', noJs: '請開啟官方狀態頁查看是否有故障。',
    overall: { operational: '未通報服務故障', issues: '已通報服務故障', maintenance: '已通報維護', unknown: '狀態尚未確認' },
    states: { operational: '正常運作', degraded_performance: '執行緩慢', partial_outage: '部分請求失敗', major_outage: '服務中斷', under_maintenance: '維護中', unknown: '尚未確認' }, services: { claude: 'Claude', code: 'Claude Code', api: 'API' },
  },
  ja: {
    heading: 'Claude で障害が起きている？', intro: 'Anthropic が公表するサービス状況です。アカウントの利用上限とは別です。', loading: '公式の稼働状況を確認中…', unavailable: '稼働状況を確認できませんでした', unavailableHint: '最新情報は公式ステータスページで確認してください。', stale: 'この情報は古くなっています。再確認してください。', checked: '確認時刻：{time} · 1分ごとに更新', refresh: '再確認', source: '公式ステータスページ', incidents: 'Anthropic の対応中の報告（原文のタイトル）', noJs: '障害の有無は公式ステータスページで確認してください。',
    overall: { operational: '障害の報告はありません', issues: '障害が報告されています', maintenance: 'メンテナンスが報告されています', unknown: '状況を確認できません' },
    states: { operational: '正常に稼働', degraded_performance: '動作が遅い', partial_outage: '一部のリクエストが失敗', major_outage: 'サービス障害', under_maintenance: 'メンテナンス中', unknown: '未確認' }, services: { claude: 'Claude', code: 'Claude Code', api: 'API' },
  },
  ko: {
    heading: 'Claude에 장애가 있나요?', intro: 'Anthropic이 공개한 서비스 상태입니다. 계정의 사용량 제한과는 별개입니다.', loading: '공식 상태를 확인하는 중…', unavailable: '서비스 상태를 확인하지 못했습니다', unavailableHint: '공식 상태 페이지에서 최신 정보를 확인하세요.', stale: '오래된 상태 정보입니다. 다시 확인해 주세요.', checked: '확인 시각: {time} · 1분마다 새로고침', refresh: '다시 확인', source: '공식 상태 페이지', incidents: 'Anthropic의 진행 중인 장애 보고 (원문 제목)', noJs: '공식 상태 페이지에서 장애 여부를 확인하세요.',
    overall: { operational: '보고된 장애 없음', issues: '장애 보고됨', maintenance: '점검 보고됨', unknown: '상태 확인 안 됨' },
    states: { operational: '정상 작동', degraded_performance: '속도 저하', partial_outage: '일부 요청 실패', major_outage: '서비스 장애', under_maintenance: '점검 중', unknown: '확인 안 됨' }, services: { claude: 'Claude', code: 'Claude Code', api: 'API' },
  },
};
