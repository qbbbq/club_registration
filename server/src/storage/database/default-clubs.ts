export interface DefaultClubSeed {
  name: string;
  description: string;
  grade: string;
  total_quota: number;
  remaining_quota: number;
}

export const DEFAULT_CLUBS: readonly DefaultClubSeed[] = [
  { name: '编程社', description: '学习编程技术，参加竞赛', grade: '初一,初二,初三', total_quota: 50, remaining_quota: 50 },
  { name: '篮球社', description: '篮球爱好者的聚集地', grade: '初一,初二', total_quota: 50, remaining_quota: 50 },
  { name: '足球社', description: '足球爱好者的聚集地', grade: '初二,初三', total_quota: 40, remaining_quota: 40 },
  { name: '音乐社', description: '音乐爱好者的聚集地', grade: '初一,初二,初三', total_quota: 30, remaining_quota: 30 },
  { name: '摄影社', description: '学习摄影技术', grade: '初一,初二,初三', total_quota: 25, remaining_quota: 25 },
  { name: '舞蹈社', description: '舞蹈爱好者的聚集地', grade: '初一,初二', total_quota: 35, remaining_quota: 35 },
  { name: '书法社', description: '传承书法艺术', grade: '初一,初二,初三', total_quota: 20, remaining_quota: 20 },
  { name: '绘画社', description: '绘画爱好者的聚集地', grade: '初一,初二,初三', total_quota: 25, remaining_quota: 25 },
];
